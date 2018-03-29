// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"math/rand"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nakama/pkg/httputil"
	"nakama/pkg/multicode"
	"nakama/pkg/social"

	"encoding/base64"
	"net"

	"github.com/dgrijalva/jwt-go"
	"github.com/gogo/protobuf/jsonpb"
	"github.com/gogo/protobuf/proto"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/satori/go.uuid"
	"github.com/wirepair/netcode"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const (
	letters                    = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	errorInvalidPayload        = "Invalid payload"
	errorIDNotFound            = "ID not found"
	errorAccessTokenIsRequired = "Access token is required"
	errorCouldNotLogin         = "Could not login"
	errorCouldNotRegister      = "Could not register"
	errorIDAlreadyInUse        = "ID already in use"
)

var (
	invalidCharsRegex = regexp.MustCompilePOSIX("([[:cntrl:]]|[[:space:]])+")
	emailRegex        = regexp.MustCompile("^.+@.+\\..+$")
)

type authenticationService struct {
	logger            *zap.Logger
	config            Config
	db                *sql.DB
	statsService      StatsService
	registry          *SessionRegistry
	pipeline          *pipeline
	runtimePool       *RuntimePool
	httpServer        *http.Server
	udpServer         *multicode.Server
	mux               *mux.Router
	hmacSecretByte    []byte
	udpProtocolId     uint64
	udpListenAddr     net.UDPAddr
	udpPublicAddr     net.UDPAddr
	udpKeyByte        []byte
	upgrader          *websocket.Upgrader
	socialClient      *social.Client
	random            *rand.Rand
	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler
}

// NewAuthenticationService creates a new AuthenticationService
func NewAuthenticationService(logger *zap.Logger, config Config, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, statService StatsService, registry *SessionRegistry, socialClient *social.Client, pipeline *pipeline, runtimePool *RuntimePool) *authenticationService {
	a := &authenticationService{
		logger:         logger,
		config:         config,
		db:             db,
		statsService:   statService,
		registry:       registry,
		pipeline:       pipeline,
		runtimePool:    runtimePool,
		socialClient:   socialClient,
		random:         rand.New(rand.NewSource(time.Now().UnixNano())),
		hmacSecretByte: []byte(config.GetSession().EncryptionKey),
		udpProtocolId:  uint64(1),
		udpListenAddr:  net.UDPAddr{IP: net.ParseIP(config.GetSocket().ListenAddress), Port: config.GetSocket().Port},
		udpPublicAddr:  net.UDPAddr{IP: net.ParseIP(config.GetSocket().PublicAddress), Port: config.GetSocket().Port},
		udpKeyByte:     []byte(config.GetSession().UdpKey),
		upgrader: &websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
		jsonpbMarshaler:   jsonpbMarshaler,
		jsonpbUnmarshaler: jsonpbUnmarshaler,
	}

	a.configure()
	return a
}

func (a *authenticationService) configure() {
	udpTimeoutMs := int64(a.config.GetSocket().PingPeriodMs + a.config.GetSocket().PongWaitMs)
	udpOnConnectFn := func(clientInstance *multicode.ClientInstance) {
		// Expects to be called on a separate goroutine.

		userID := string(bytes.Trim(clientInstance.UserData[:128], "\x00"))
		handle := string(bytes.Trim(clientInstance.UserData[128:], "\x00"))

		// TODO pass lang through token user data or other medium.
		a.registry.addUDP(userID, handle, "en", clientInstance.ExpiresAt, clientInstance, a.pipeline.processRequest)
	}
	var err error
	a.udpServer, err = multicode.NewServer(a.logger, &a.udpListenAddr, &a.udpPublicAddr, a.udpKeyByte, a.udpProtocolId, a.config.GetSocket().MaxMessageSizeBytes, udpOnConnectFn, udpTimeoutMs)
	if err != nil {
		a.logger.Fatal("UDP client listener init failed", zap.Error(err))
	}

	a.mux = mux.NewRouter()

	a.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		healthScore := a.statsService.GetHealthStatus()
		status := 200
		if healthScore > 0 {
			status = 500
		}
		w.WriteHeader(status)

	}).Methods("GET")

	a.mux.HandleFunc("/user/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			return
		}
		a.handleAuth(w, r, a.login)
	}).Methods("POST", "OPTIONS")

	a.mux.HandleFunc("/user/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			return
		}
		a.handleAuth(w, r, a.register)
	}).Methods("POST", "OPTIONS")

	a.mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			return
		}

		token := r.URL.Query().Get("token")
		uid, handle, exp, auth := a.authenticateToken(token)
		if !auth {
			http.Error(w, "Missing or invalid token", 401)
			return
		}

		// TODO validate BCP 47 lang format
		lang := r.URL.Query().Get("lang")
		if lang == "" {
			lang = "en"
		}

		sformat := SessionFormatProtobuf
		format := r.URL.Query().Get("format")
		if format == "json" {
			sformat = SessionFormatJson
		}

		conn, err := a.upgrader.Upgrade(w, r, nil)
		if err != nil {
			// http.Error is invoked automatically from within the Upgrade func
			a.logger.Warn("Could not upgrade to WebSocket", zap.Error(err))
			return
		}

		a.registry.addWS(uid, handle, lang, sformat, exp, conn, a.jsonpbMarshaler, a.jsonpbUnmarshaler, a.pipeline.processRequest)
	}).Methods("GET", "OPTIONS")

	a.mux.HandleFunc("/runtime/{path}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("accept") == "" {
			// If no Accept header is provided, assume the client can handle application/json.
			r.Header.Add("accept", "application/json")
		}
		acceptSpecs := httputil.ParseAccept(r.Header, "Accept")
		acceptable := false
		for _, acceptSpec := range acceptSpecs {
			if acceptSpec.Value == "application/json" || acceptSpec.Value == "*/*" {
				acceptable = true
				break
			}
		}
		if !acceptable {
			http.Error(w, fmt.Sprintf("Runtime function received invalid accept header: \"%s\", expected at least: \"application/json\"", r.Header.Get("accept")), 400)
			return
		}

		contentType := r.Header.Get("content-type")
		if contentType == "" {
			contentType = "application/json"
		}
		contentMediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil {
			a.logger.Warn("Could not decode content-type header", zap.Error(err))
			http.Error(w, fmt.Sprintf("Runtime function handler was unable to parse content-type header: %s ", contentType), 400)
			return
		}
		if contentMediaType != "application/json" {
			http.Error(w, fmt.Sprintf("Runtime function received invalid content-type header: \"%s\", expected: \"application/json\"", contentType), 400)
			return
		}

		key := r.URL.Query().Get("key")
		if key != a.config.GetRuntime().HTTPKey {
			http.Error(w, fmt.Sprintf("Invalid runtime key: %s", key), 401)
			return
		}

		if r.Method == "OPTIONS" {
			//TODO(mo): Do we need to return non-200 for path that don't exist?
			return
		}

		path := strings.ToLower(mux.Vars(r)["path"])
		if !a.runtimePool.HasHTTP(path) {
			a.logger.Warn("HTTP invocation failed as path was not found", zap.String("path", path))
			http.Error(w, fmt.Sprintf("Runtime function could not be invoked. Path: \"%s\", was not found.", path), 404)
			return
		}

		runtime := a.runtimePool.Get()
		fn := runtime.GetRuntimeCallback(HTTP, path)
		if fn == nil {
			a.runtimePool.Put(runtime)
			a.logger.Warn("HTTP invocation failed as path was not found", zap.String("path", path))
			http.Error(w, fmt.Sprintf("Runtime function could not be invoked. Path: \"%s\", was not found.", path), 404)
			return
		}

		payload := make(map[string]interface{})
		defer r.Body.Close()
		err = json.NewDecoder(r.Body).Decode(&payload)
		switch {
		case err == io.EOF:
			payload = nil
		case err != nil:
			a.runtimePool.Put(runtime)
			a.logger.Error("Could not decode request data", zap.Error(err))
			http.Error(w, "Bad request data", 400)
			return
		}

		responseData, funError := runtime.InvokeFunctionHTTP(fn, "", "", 0, payload)
		a.runtimePool.Put(runtime)
		if funError != nil {
			a.logger.Error("Runtime function caused an error", zap.String("path", path), zap.Error(funError))
			if apiErr, ok := funError.(*lua.ApiError); ok && !a.config.GetLog().Verbose {
				msg := apiErr.Object.String()
				if strings.HasPrefix(msg, fn.Proto.SourceName) {
					msg = msg[len(fn.Proto.SourceName):]
					msgParts := strings.SplitN(msg, ": ", 2)
					if len(msgParts) == 2 {
						msg = msgParts[1]
					} else {
						msg = msgParts[0]
					}
				}
				http.Error(w, msg, 500)
			} else {
				http.Error(w, funError.Error(), 500)
			}
			return
		}

		responseBytes, err := json.Marshal(responseData)
		if err != nil {
			a.logger.Error("Could not marshal function response data", zap.Error(err))
			http.Error(w, "Runtime function caused an error", 500)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write(responseBytes)

	}).Methods("POST", "OPTIONS")

	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})

	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins)(a.mux)

	a.httpServer = &http.Server{Addr: fmt.Sprintf(":%d", a.config.GetSocket().Port), Handler: handlerWithCORS}

	sockConfig := a.config.GetSocket()
	if len(sockConfig.SSLCertificate) > 0 && len(sockConfig.SSLPrivateKey) > 0 {
		cer, err := tls.LoadX509KeyPair(sockConfig.SSLCertificate, sockConfig.SSLPrivateKey)
		if err != nil {
			a.logger.Fatal("Loading SSL certs failed", zap.Error(err))
		} else {
			a.logger.Info("SSL mode enabled")
			a.httpServer.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cer}}
		}
	}
}

func (a *authenticationService) StartServer(logger *zap.Logger) {
	// Start UDP client listener first.
	// Avoids the race condition where we issue tokens via login/register but UDP connections aren't available yet.
	if err := a.udpServer.Listen(); err != nil {
		logger.Fatal("UDP client listener failed", zap.Error(err))
	}

	// Start HTTP and WebSocket client listener.
	go func() {
		if a.httpServer.TLSConfig != nil {
			if err := a.httpServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				logger.Fatal("WebSocket client listener failed", zap.Error(err))
			}

		} else {
			if err := a.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				logger.Fatal("WebSocket client listener failed", zap.Error(err))
			}
		}
	}()

	logger.Info("Client", zap.Int("port", a.config.GetSocket().Port))
}

func (a *authenticationService) handleAuth(w http.ResponseWriter, r *http.Request,
	retrieveUserID func(authReq *AuthenticateRequest) (string, string, string, Error_Code)) {

	w.Header().Set("Content-Type", "application/octet-stream")

	username, _, ok := r.BasicAuth()
	if !ok {
		a.sendAuthError(w, r, "Missing or invalid authentication header", AUTH_ERROR, nil)
		return
	} else if username != a.config.GetSocket().ServerKey {
		a.sendAuthError(w, r, "Invalid server key", AUTH_ERROR, nil)
		return
	}

	data, err := ioutil.ReadAll(http.MaxBytesReader(w, r.Body, a.config.GetSocket().MaxMessageSizeBytes))
	if err != nil {
		a.logger.Warn("Could not read body", zap.Error(err))
		a.sendAuthError(w, r, "Could not read request body", AUTH_ERROR, nil)
		return
	}

	contentType := r.Header.Get("content-type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		a.logger.Warn("Could not decode content type header", zap.Error(err))
		a.sendAuthError(w, r, "Could not decode content type header", AUTH_ERROR, nil)
		return
	}

	authReq := &AuthenticateRequest{}
	switch mediaType {
	case "application/json":
		err = a.jsonpbUnmarshaler.Unmarshal(bytes.NewReader(data), authReq)
	default:
		err = proto.Unmarshal(data, authReq)
	}
	if err != nil {
		a.logger.Warn("Could not decode body", zap.Error(err))
		a.sendAuthError(w, r, "Could not decode body", AUTH_ERROR, nil)
		return
	}

	messageType := fmt.Sprintf("%T", authReq.Id)
	a.logger.Debug("Received message", zap.String("type", messageType))
	authReq, fnErr := RuntimeBeforeHookAuthentication(a.runtimePool, a.jsonpbMarshaler, a.jsonpbUnmarshaler, authReq)
	if fnErr != nil {
		a.logger.Error("Runtime before function caused an error", zap.String("message", messageType), zap.Error(fnErr))
		a.sendAuthError(w, r, "Runtime before function caused an error", RUNTIME_FUNCTION_EXCEPTION, authReq)
		return
	}

	userID, handle, errString, errCode := retrieveUserID(authReq)
	if errString != "" {
		a.logger.Debug("Could not retrieve user ID", zap.String("error", errString), zap.Int("code", int(errCode)))
		a.sendAuthError(w, r, errString, errCode, authReq)
		return
	}

	exp := time.Now().UTC().Add(time.Duration(a.config.GetSession().TokenExpiryMs) * time.Millisecond).Unix()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid": userID,
		"exp": exp,
		"han": handle,
	})
	signedToken, _ := token.SignedString(a.hmacSecretByte)

	udpToken := netcode.NewConnectToken()
	// User data is always a fixed length.
	userData := make([]byte, netcode.USER_DATA_BYTES)
	copy(userData, []byte(userID))
	copy(userData[128:], []byte(handle))
	if err := udpToken.Generate(1, []net.UDPAddr{a.udpPublicAddr}, netcode.VERSION_INFO, a.udpProtocolId, uint64(a.config.GetSession().TokenExpiryMs/1000), int32(a.config.GetSocket().WriteWaitMs/1000), 0, userData, a.udpKeyByte); err != nil {
		a.logger.Error("UDP token generate error", zap.Error(fnErr))
		a.sendAuthError(w, r, "UDP token generate error", AUTH_ERROR, authReq)
		return
	}
	udpTokenBytes, err := udpToken.Write()
	if err != nil {
		a.logger.Error("UDP token write error", zap.Error(fnErr))
		a.sendAuthError(w, r, "UDP token write error", AUTH_ERROR, authReq)
		return
	}

	authResponse := &AuthenticateResponse{CollationId: authReq.CollationId, Id: &AuthenticateResponse_Session_{&AuthenticateResponse_Session{
		Token:    signedToken,
		UdpToken: base64.StdEncoding.EncodeToString(udpTokenBytes),
	}}}
	a.sendAuthResponse(w, r, 200, authResponse)

	RuntimeAfterHookAuthentication(a.logger, a.runtimePool, a.jsonpbMarshaler, authReq, userID, handle, exp)
}

func (a *authenticationService) sendAuthError(w http.ResponseWriter, r *http.Request, error string, errorCode Error_Code, authRequest *AuthenticateRequest) {
	var collationID string
	if authRequest != nil {
		collationID = authRequest.CollationId
	}
	authResponse := &AuthenticateResponse{CollationId: collationID, Id: &AuthenticateResponse_Error_{&AuthenticateResponse_Error{
		Code:    int32(errorCode),
		Message: error,
		Request: authRequest,
	}}}
	httpCode := 500
	switch errorCode {
	case RUNTIME_EXCEPTION:
		httpCode = 500
	case AUTH_ERROR:
		httpCode = 401
	case RUNTIME_FUNCTION_EXCEPTION:
		httpCode = 500
	case BAD_INPUT:
		httpCode = 400
	case USER_NOT_FOUND:
		httpCode = 401
	case USER_REGISTER_INUSE:
		httpCode = 401
	default:
		httpCode = 500
	}
	a.sendAuthResponse(w, r, httpCode, authResponse)
}

func (a *authenticationService) sendAuthResponse(w http.ResponseWriter, r *http.Request, code int, response *AuthenticateResponse) {
	accept := r.Header.Get("accept")
	if accept == "" {
		accept = "application/octet-stream"
	}
	mediaType, _, err := mime.ParseMediaType(accept)
	if err != nil {
		a.logger.Warn("Could not decode accept header, defaulting to Protobuf output", zap.Error(err))
		err = nil
	}

	var payload []byte
	switch mediaType {
	case "application/json":
		payloadString, err := a.jsonpbMarshaler.MarshalToString(response)
		if err == nil {
			payload = []byte(payloadString)
			w.Header().Set("Content-Type", "application/json")
		}
	default:
		payload, err = proto.Marshal(response)
	}
	if err != nil {
		a.logger.Error("Could not marshal AuthenticateResponse", zap.Error(err))
		return
	}

	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	w.Write(payload)
}

func (a *authenticationService) login(authReq *AuthenticateRequest) (string, string, string, Error_Code) {
	// Route to correct login handler
	var loginFunc func(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code)
	switch authReq.Id.(type) {
	case *AuthenticateRequest_Device:
		loginFunc = a.loginDevice
	case *AuthenticateRequest_Facebook:
		loginFunc = a.loginFacebook
	case *AuthenticateRequest_Google:
		loginFunc = a.loginGoogle
	case *AuthenticateRequest_GameCenter_:
		loginFunc = a.loginGameCenter
	case *AuthenticateRequest_Steam:
		loginFunc = a.loginSteam
	case *AuthenticateRequest_Email_:
		loginFunc = a.loginEmail
	case *AuthenticateRequest_Custom:
		loginFunc = a.loginCustom
	default:
		return "", "", errorInvalidPayload, BAD_INPUT
	}

	userID, handle, disabledAt, message, errorCode := loginFunc(authReq)

	if disabledAt != 0 {
		return "", "", "ID disabled", AUTH_ERROR
	}

	return userID, handle, message, errorCode
}

func (a *authenticationService) loginDevice(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	deviceID := authReq.GetDevice()
	if deviceID == "" {
		return "", "", 0, "Device ID is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(deviceID) {
		return "", "", 0, "Invalid device ID, no spaces or control characters allowed", BAD_INPUT
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		return "", "", 0, "Invalid device ID, must be 10-128 bytes", BAD_INPUT
	}

	var userID string
	var handle string
	var disabledAt int64

	tx, err := a.db.Begin()
	if err != nil {
		a.logger.Error("Could not begin transaction in device login", zap.Error(err))
		return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
	}
	defer func() {
		if err != nil {
			if e := tx.Rollback(); e != nil {
				a.logger.Error("Could not rollback transaction in device login", zap.Error(e))
			}
		} else {
			if e := tx.Commit(); e != nil {
				a.logger.Error("Could not commit transaction in device login", zap.Error(e))
			}
		}
	}()

	// Look up user ID by device.
	err = tx.QueryRow("SELECT user_id FROM user_device WHERE id = $1", deviceID).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Error("Could not look up user ID in device login", zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	// Look up user information by ID.
	err = tx.QueryRow("SELECT handle, disabled_at FROM users WHERE id = $1", userID).Scan(&handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Error("Could not look up user data in device login", zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginFacebook(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	accessToken := authReq.GetFacebook()
	if accessToken == "" {
		return "", "", 0, errorAccessTokenIsRequired, BAD_INPUT
	} else if invalidCharsRegex.MatchString(accessToken) {
		return "", "", 0, "Invalid Facebook access token, no spaces or control characters allowed", BAD_INPUT
	}

	fbProfile, err := a.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Facebook profile", zap.Error(err))
		return "", "", 0, errorCouldNotLogin, AUTH_ERROR
	}

	var userID string
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE facebook_id = $1",
		fbProfile.ID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "facebook"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginGoogle(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	accessToken := authReq.GetGoogle()
	if accessToken == "" {
		return "", "", 0, errorAccessTokenIsRequired, BAD_INPUT
	} else if invalidCharsRegex.MatchString(accessToken) {
		return "", "", 0, "Invalid Google access token, no spaces or control characters allowed", BAD_INPUT
	}

	googleProfile, err := a.socialClient.CheckGoogleToken(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Google profile", zap.Error(err))
		return "", "", 0, errorCouldNotLogin, AUTH_ERROR
	}

	var userID string
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE google_id = $1",
		googleProfile.Sub).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "google"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginGameCenter(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	gc := authReq.GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		return "", "", 0, errorInvalidPayload, BAD_INPUT
	}

	_, err := a.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		a.logger.Warn("Could not check Game Center profile", zap.Error(err))
		return "", "", 0, errorCouldNotLogin, AUTH_ERROR
	}

	var userID string
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE gamecenter_id = $1",
		gc.PlayerId).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "game center"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginSteam(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	if a.config.GetSocial().Steam.PublisherKey == "" || a.config.GetSocial().Steam.AppID == 0 {
		return "", "", 0, "Steam login not available", AUTH_ERROR
	}

	ticket := authReq.GetSteam()
	if ticket == "" {
		return "", "", 0, "Steam ticket is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(ticket) {
		return "", "", 0, "Invalid Steam ticket, no spaces or control characters allowed", BAD_INPUT
	}

	steamProfile, err := a.socialClient.GetSteamProfile(a.config.GetSocial().Steam.PublisherKey, a.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		a.logger.Warn("Could not check Steam profile", zap.Error(err))
		return "", "", 0, errorCouldNotLogin, AUTH_ERROR
	}

	var userID string
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE steam_id = $1",
		strconv.FormatUint(steamProfile.SteamID, 10)).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "steam"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginEmail(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	email := authReq.GetEmail()
	if email == nil {
		return "", "", 0, errorInvalidPayload, BAD_INPUT
	} else if email.Email == "" {
		return "", "", 0, "Email address is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(email.Email) {
		return "", "", 0, "Invalid email address, no spaces or control characters allowed", BAD_INPUT
	} else if !emailRegex.MatchString(email.Email) {
		return "", "", 0, "Invalid email address format", BAD_INPUT
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		return "", "", 0, "Invalid email address, must be 10-255 bytes", BAD_INPUT
	}

	var userID string
	var handle string
	var hashedPassword []byte
	var disabledAt int64
	err := a.db.QueryRow("SELECT id, handle, password, disabled_at FROM users WHERE email = $1",
		strings.ToLower(email.Email)).
		Scan(&userID, &handle, &hashedPassword, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "email"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(email.Password))
	if err != nil {
		return "", "", 0, "Invalid credentials", AUTH_ERROR
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) loginCustom(authReq *AuthenticateRequest) (string, string, int64, string, Error_Code) {
	customID := authReq.GetCustom()
	if customID == "" {
		return "", "", 0, "Custom ID is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(customID) {
		return "", "", 0, "Invalid custom ID, no spaces or control characters allowed", BAD_INPUT
	} else if len(customID) < 10 || len(customID) > 128 {
		return "", "", 0, "Invalid custom ID, must be 10-128 bytes", BAD_INPUT
	}

	var userID string
	var handle string
	var disabledAt int64
	err := a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE custom_id = $1",
		customID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", 0, errorIDNotFound, USER_NOT_FOUND
		} else {
			a.logger.Warn(errorCouldNotLogin, zap.String("profile", "custom"), zap.Error(err))
			return "", "", 0, errorCouldNotLogin, RUNTIME_EXCEPTION
		}
	}

	return userID, handle, disabledAt, "", 0
}

func (a *authenticationService) register(authReq *AuthenticateRequest) (string, string, string, Error_Code) {
	// Route to correct register handler
	var registerFunc func(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code)
	var registerHook func(authReq *AuthenticateRequest, userID string, handle string, identifier string)

	switch authReq.Id.(type) {
	case *AuthenticateRequest_Device:
		registerFunc = a.registerDevice
	case *AuthenticateRequest_Facebook:
		registerFunc = a.registerFacebook
		registerHook = func(authReq *AuthenticateRequest, userID string, handle string, identifier string) {
			l := a.logger.With(zap.String("user_id", userID))
			a.pipeline.addFacebookFriends(l, userID, handle, identifier, authReq.GetFacebook())
		}
	case *AuthenticateRequest_Google:
		registerFunc = a.registerGoogle
	case *AuthenticateRequest_GameCenter_:
		registerFunc = a.registerGameCenter
	case *AuthenticateRequest_Steam:
		registerFunc = a.registerSteam
	case *AuthenticateRequest_Email_:
		registerFunc = a.registerEmail
	case *AuthenticateRequest_Custom:
		registerFunc = a.registerCustom
	default:
		return "", "", errorInvalidPayload, BAD_INPUT
	}

	tx, err := a.db.Begin()
	if err != nil {
		a.logger.Warn("Could not register, transaction begin error", zap.Error(err))
		return "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	// The userID and handle that have been assigned to the user.
	// `identifier` represents the identity token that was just registered: social ID, email, device etc
	userID, handle, identifier, errorMessage, errorCode := registerFunc(tx, authReq)

	if errorMessage != "" {
		if tx != nil {
			err = tx.Rollback()
			if err != nil {
				a.logger.Error("Could not rollback transaction", zap.Error(err))
			}
		}
		return userID, handle, errorMessage, errorCode
	}

	err = tx.Commit()
	if err != nil {
		a.logger.Error("Could not commit transaction", zap.Error(err))
		return "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	// Run any post-registration steps outside the main registration transaction.
	// Errors here should not cause registration to fail.
	if registerHook != nil {
		registerHook(authReq, userID, handle, identifier)
	}

	a.logger.Info("Registration complete", zap.String("uid", userID))
	return userID, handle, errorMessage, errorCode
}

func (a *authenticationService) addUserEdgeMetadata(tx *sql.Tx, userID string, updatedAt int64) error {
	_, err := tx.Exec("INSERT INTO user_edge_metadata (source_id, count, state, updated_at) VALUES ($1, 0, 0, $2)", userID, updatedAt)
	return err
}

func (a *authenticationService) registerDevice(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	deviceID := authReq.GetDevice()
	if deviceID == "" {
		return "", "", "", "Device ID is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(deviceID) {
		return "", "", "", "Invalid device ID, no spaces or control characters allowed", BAD_INPUT
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		return "", "", "", "Invalid device ID, must be 10-128 bytes", BAD_INPUT
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	res, err := tx.Exec(`
INSERT INTO users (id, handle, created_at, updated_at)
SELECT $1 AS id,
			 $2 AS handle,
       $4 AS created_at,
       $4 AS updated_at
WHERE NOT EXISTS
    (SELECT id
     FROM user_device
     WHERE id = $3::VARCHAR)`,
		userID, handle, deviceID, updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new device profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	res, err = tx.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, userID)
	if err != nil {
		a.logger.Warn("Could not register, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, deviceID, "", 0
}

func (a *authenticationService) registerFacebook(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	accessToken := authReq.GetFacebook()
	if accessToken == "" {
		return "", "", "", errorAccessTokenIsRequired, BAD_INPUT
	} else if invalidCharsRegex.MatchString(accessToken) {
		return "", "", "", "Invalid Facebook access token, no spaces or control characters allowed", BAD_INPUT
	}

	fbProfile, err := a.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Facebook profile", zap.Error(err))
		return "", "", "", errorCouldNotRegister, AUTH_ERROR
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	res, err := tx.Exec(`
INSERT INTO users (id, handle, facebook_id, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS facebook_id,
	 $4 AS created_at,
	 $4 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE facebook_id = $3::VARCHAR)`,
		userID, handle, fbProfile.ID, updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Facebook profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, fbProfile.ID, "", 0
}

func (a *authenticationService) registerGoogle(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	accessToken := authReq.GetGoogle()
	if accessToken == "" {
		return "", "", "", errorAccessTokenIsRequired, BAD_INPUT
	} else if invalidCharsRegex.MatchString(accessToken) {
		return "", "", "", "Invalid Google access token, no spaces or control characters allowed", BAD_INPUT
	}

	googleProfile, err := a.socialClient.CheckGoogleToken(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Google profile", zap.Error(err))
		return "", "", "", errorCouldNotRegister, AUTH_ERROR
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	res, err := tx.Exec(`
INSERT INTO users (id, handle, google_id, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS google_id,
	 $4 AS created_at,
	 $4 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE google_id = $3::VARCHAR)`,
		userID,
		handle,
		googleProfile.Sub,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Google profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, googleProfile.Sub, "", 0
}

func (a *authenticationService) registerGameCenter(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	gc := authReq.GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		return "", "", "", errorInvalidPayload, BAD_INPUT
	}

	_, err := a.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		a.logger.Warn("Could not get Game Center profile", zap.Error(err))
		return "", "", "", errorCouldNotRegister, AUTH_ERROR
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	res, err := tx.Exec(`
INSERT INTO users (id, handle, gamecenter_id, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS gamecenter_id,
	 $4 AS created_at,
	 $4 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE gamecenter_id = $3::VARCHAR)`,
		userID,
		handle,
		gc.PlayerId,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Game Center profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, gc.PlayerId, "", 0
}

func (a *authenticationService) registerSteam(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	if a.config.GetSocial().Steam.PublisherKey == "" || a.config.GetSocial().Steam.AppID == 0 {
		return "", "", "", "Steam registration not available", AUTH_ERROR
	}

	ticket := authReq.GetSteam()
	if ticket == "" {
		return "", "", "", "Steam ticket is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(ticket) {
		return "", "", "", "Invalid Steam ticket, no spaces or control characters allowed", BAD_INPUT
	}

	steamProfile, err := a.socialClient.GetSteamProfile(a.config.GetSocial().Steam.PublisherKey, a.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		a.logger.Warn("Could not get Steam profile", zap.Error(err))
		return "", "", "", errorCouldNotRegister, AUTH_ERROR
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	steamID := strconv.FormatUint(steamProfile.SteamID, 10)
	res, err := tx.Exec(`
INSERT INTO users (id, handle, steam_id, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS steam_id,
	 $4 AS created_at,
	 $4 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE steam_id = $3::VARCHAR)`,
		userID,
		handle,
		steamID,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Steam profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, steamID, "", 0
}

func (a *authenticationService) registerEmail(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	email := authReq.GetEmail()
	if email == nil {
		return "", "", "", errorInvalidPayload, BAD_INPUT
	} else if email.Email == "" {
		return "", "", "", "Email address is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(email.Email) {
		return "", "", "", "Invalid email address, no spaces or control characters allowed", BAD_INPUT
	} else if len(email.Password) < 8 {
		return "", "", "", "Password must be longer than 8 characters", BAD_INPUT
	} else if !emailRegex.MatchString(email.Email) {
		return "", "", "", "Invalid email address format", BAD_INPUT
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		return "", "", "", "Invalid email address, must be 10-255 bytes", BAD_INPUT
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(email.Password), bcrypt.DefaultCost)

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	cleanEmail := strings.ToLower(email.Email)
	res, err := tx.Exec(`
INSERT INTO users (id, handle, email, password, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS email,
	 $4 AS password,
	 $5 AS created_at,
	 $5 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE email = $3::VARCHAR)`,
		userID,
		handle,
		cleanEmail,
		hashedPassword,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new email profile, query error", zap.Error(err))
		return "", "", "", "Email already in use", RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return "", "", "", "Email already in use", RUNTIME_EXCEPTION
	}

	return userID, handle, cleanEmail, "", 0
}

func (a *authenticationService) registerCustom(tx *sql.Tx, authReq *AuthenticateRequest) (string, string, string, string, Error_Code) {
	customID := authReq.GetCustom()
	if customID == "" {
		return "", "", "", "Custom ID is required", BAD_INPUT
	} else if invalidCharsRegex.MatchString(customID) {
		return "", "", "", "Invalid custom ID, no spaces or control characters allowed", BAD_INPUT
	} else if len(customID) < 10 || len(customID) > 128 {
		return "", "", "", "Invalid custom ID, must be 10-128 bytes", BAD_INPUT
	}

	updatedAt := nowMs()
	userID := generateNewId()
	handle := a.generateHandle()
	res, err := tx.Exec(`
INSERT INTO users (id, handle, custom_id, created_at, updated_at)
SELECT $1 AS id,
	 $2 AS handle,
	 $3 AS custom_id,
	 $4 AS created_at,
	 $4 AS updated_at
WHERE NOT EXISTS
(SELECT id
 FROM users
 WHERE custom_id = $3::VARCHAR)`,
		userID,
		handle,
		customID,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new custom profile, query error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		return "", "", "", errorIDAlreadyInUse, USER_REGISTER_INUSE
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		a.logger.Error("Could not register new custom profile, user edge metadata error", zap.Error(err))
		return "", "", "", errorCouldNotRegister, RUNTIME_EXCEPTION
	}

	return userID, handle, customID, "", 0
}

func (a *authenticationService) generateHandle() string {
	b := make([]byte, 10)
	for i := range b {
		b[i] = letters[a.random.Intn(len(letters))]
	}
	return string(b)
}

func (a *authenticationService) authenticateToken(tokenString string) (string, string, int64, bool) {
	if tokenString == "" {
		a.logger.Warn("Token missing")
		return "", "", 0, false
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("Unexpected signing method: %v", token.Header["alg"])
		}
		return a.hmacSecretByte, nil
	})

	if err == nil {
		if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
			uid, ok := claims["uid"].(string)
			if !ok {
				a.logger.Warn("Invalid user ID in token", zap.String("token", tokenString))
				return "", "", 0, false
			}
			return uid, claims["han"].(string), int64(claims["exp"].(float64)), true
		}
	}

	a.logger.Warn("Token invalid", zap.String("token", tokenString), zap.Error(err))
	return "", "", 0, false
}

func (a *authenticationService) Stop() {
	c := make(chan struct{})
	a.udpServer.Stop()
	go func() {
		// Run this in parallel because it's a blocking call. It will:
		// 1. Stop accepting new connections.
		// 2. Wait until current connections are closed.
		// 3. Return once registry shutdown (below) has closed current connections.
		if err := a.httpServer.Shutdown(nil); err != nil {
			a.logger.Error("WebSocket client listener shutdown failed", zap.Error(err))
		}
		close(c)
	}()
	a.registry.stop()
	<-c
}

func now() time.Time {
	return time.Now().UTC()
}

func nowMs() int64 {
	return timeToMs(now())
}

func timeToMs(t time.Time) int64 {
	return int64(time.Nanosecond) * t.UnixNano() / int64(time.Millisecond)
}

func generateNewId() string {
	return base64.RawURLEncoding.EncodeToString(uuid.NewV4().Bytes())
}
