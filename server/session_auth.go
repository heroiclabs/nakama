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

	"nakama/pkg/social"

	"github.com/dgrijalva/jwt-go"
	"github.com/gogo/protobuf/jsonpb"
	"github.com/gogo/protobuf/proto"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/satori/go.uuid"
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
	runtime           *Runtime
	mux               *mux.Router
	hmacSecretByte    []byte
	upgrader          *websocket.Upgrader
	socialClient      *social.Client
	random            *rand.Rand
	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler
}

// NewAuthenticationService creates a new AuthenticationService
func NewAuthenticationService(logger *zap.Logger, config Config, db *sql.DB, statService StatsService, registry *SessionRegistry, socialClient *social.Client, pipeline *pipeline, runtime *Runtime) *authenticationService {
	a := &authenticationService{
		logger:         logger,
		config:         config,
		db:             db,
		statsService:   statService,
		registry:       registry,
		pipeline:       pipeline,
		runtime:        runtime,
		socialClient:   socialClient,
		random:         rand.New(rand.NewSource(time.Now().UnixNano())),
		hmacSecretByte: []byte(config.GetSession().EncryptionKey),
		upgrader: &websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
		jsonpbMarshaler: &jsonpb.Marshaler{
			EnumsAsInts:  true,
			EmitDefaults: false,
			Indent:       "",
			OrigName:     false,
		},
		jsonpbUnmarshaler: &jsonpb.Unmarshaler{
			AllowUnknownFields: false,
		},
	}

	a.configure()
	return a
}

func (a *authenticationService) configure() {
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

		conn, err := a.upgrader.Upgrade(w, r, nil)
		if err != nil {
			// http.Error is invoked automatically from within the Upgrade func
			a.logger.Warn("Could not upgrade to websockets", zap.Error(err))
			return
		}

		a.registry.add(uid, handle, lang, exp, conn, a.pipeline.processRequest)
	}).Methods("GET", "OPTIONS")

	a.mux.HandleFunc("/runtime/{path}", func(w http.ResponseWriter, r *http.Request) {
		accept := r.Header.Get("accept")
		if accept != "" && accept != "application/json" {
			http.Error(w, "Runtime function only accept JSON data", 400)
			return
		}

		contentType := r.Header.Get("content-type")
		if contentType != "" && contentType != "application/json" {
			http.Error(w, "Runtime function expects JSON data", 400)
			return
		}

		key := r.URL.Query().Get("key")
		if key != a.config.GetRuntime().HTTPKey {
			http.Error(w, "Invalid runtime key", 401)
			return
		}

		if r.Method == "OPTIONS" {
			//TODO(mo): Do we need to return non-200 for path that don't exist?
			return
		}

		path := strings.ToLower(mux.Vars(r)["path"])
		fn := a.runtime.GetRuntimeCallback(HTTP, path)
		if fn == nil {
			a.logger.Warn("HTTP invocation failed as path was not found", zap.String("path", path))
			http.Error(w, "Runtime function could not be invoked. Path not found.", 404)
			return
		}

		payload := make(map[string]interface{})
		defer r.Body.Close()
		err := json.NewDecoder(r.Body).Decode(&payload)
		switch {
		case err == io.EOF:
			payload = nil
		case err != nil:
			a.logger.Error("Could not decode request data", zap.Error(err))
			http.Error(w, "Bad request data", 400)
			return
		}

		responseData, funError := a.runtime.InvokeFunctionHTTP(fn, uuid.Nil, "", 0, payload)
		if funError != nil {
			a.logger.Error("Runtime function caused an error", zap.String("path", path), zap.Error(funError))
			http.Error(w, fmt.Sprintf("Runtime function caused an error: %s", funError.Error()), 500)
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
}

func (a *authenticationService) StartServer(logger *zap.Logger) {
	go func() {
		CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type"})
		CORSOrigins := handlers.AllowedOrigins([]string{"*"})

		handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins)(a.mux)
		err := http.ListenAndServe(fmt.Sprintf(":%d", a.config.GetPort()), handlerWithCORS)
		if err != nil {
			logger.Fatal("Client listener failed", zap.Error(err))
		}
	}()
	logger.Info("Client", zap.Int("port", a.config.GetPort()))
}

func (a *authenticationService) handleAuth(w http.ResponseWriter, r *http.Request,
	retrieveUserID func(authReq *AuthenticateRequest) ([]byte, string, string, int)) {

	w.Header().Set("Content-Type", "application/octet-stream")

	username, _, ok := r.BasicAuth()
	if !ok {
		a.sendAuthError(w, r, "Missing or invalid authentication header", 400, nil)
		return
	} else if username != a.config.GetTransport().ServerKey {
		a.sendAuthError(w, r, "Invalid server key", 401, nil)
		return
	}

	data, err := ioutil.ReadAll(http.MaxBytesReader(w, r.Body, a.config.GetTransport().MaxMessageSizeBytes))
	if err != nil {
		a.logger.Warn("Could not read body", zap.Error(err))
		a.sendAuthError(w, r, "Could not read request body", 400, nil)
		return
	}

	contentType := r.Header.Get("content-type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		a.logger.Warn("Could not decode content type header", zap.Error(err))
		a.sendAuthError(w, r, "Could not decode content type header", 400, nil)
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
		a.sendAuthError(w, r, "Could not decode body", 400, nil)
		return
	}

	messageType := fmt.Sprintf("%T", authReq.Id)
	a.logger.Debug("Received message", zap.String("type", messageType))
	authReq, fnErr := RuntimeBeforeHookAuthentication(a.runtime, a.jsonpbMarshaler, a.jsonpbUnmarshaler, authReq)
	if fnErr != nil {
		a.logger.Error("Runtime before function caused an error", zap.String("message", messageType), zap.Error(fnErr))
		a.sendAuthError(w, r, "Runtime before function caused an error", 500, authReq)
		return
	}

	userID, handle, errString, errCode := retrieveUserID(authReq)
	if errString != "" {
		a.logger.Debug("Could not retrieve user ID", zap.String("error", errString), zap.Int("code", errCode))
		a.sendAuthError(w, r, errString, errCode, authReq)
		return
	}

	uid, _ := uuid.FromBytes(userID)
	exp := time.Now().UTC().Add(time.Duration(a.config.GetSession().TokenExpiryMs) * time.Millisecond).Unix()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid": uid.String(),
		"exp": exp,
		"han": handle,
	})
	signedToken, _ := token.SignedString(a.hmacSecretByte)

	authResponse := &AuthenticateResponse{CollationId: authReq.CollationId, Id: &AuthenticateResponse_Session_{&AuthenticateResponse_Session{Token: signedToken}}}
	a.sendAuthResponse(w, r, 200, authResponse)

	RuntimeAfterHookAuthentication(a.logger, a.runtime, a.jsonpbMarshaler, authReq, uid, handle, exp)
}

func (a *authenticationService) sendAuthError(w http.ResponseWriter, r *http.Request, error string, errorCode int, authRequest *AuthenticateRequest) {
	var collationID string
	if authRequest != nil {
		collationID = authRequest.CollationId
	}
	authResponse := &AuthenticateResponse{CollationId: collationID, Id: &AuthenticateResponse_Error_{&AuthenticateResponse_Error{
		Code:    int32(AUTH_ERROR),
		Message: error,
		Request: authRequest,
	}}}
	a.sendAuthResponse(w, r, errorCode, authResponse)
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

func (a *authenticationService) login(authReq *AuthenticateRequest) ([]byte, string, string, int) {
	// Route to correct login handler
	var loginFunc func(authReq *AuthenticateRequest) ([]byte, string, int64, string, int)
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
		return nil, "", errorInvalidPayload, 400
	}

	userID, handle, disabledAt, message, status := loginFunc(authReq)

	if disabledAt != 0 {
		return nil, "", "ID disabled", 401
	}

	return userID, handle, message, status
}

func (a *authenticationService) loginDevice(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	deviceID := authReq.GetDevice()
	if deviceID == "" {
		return nil, "", 0, "Device ID is required", 400
	} else if invalidCharsRegex.MatchString(deviceID) {
		return nil, "", 0, "Invalid device ID, no spaces or control characters allowed", 400
	} else if len(deviceID) < 10 || len(deviceID) > 64 {
		return nil, "", 0, "Invalid device ID, must be 10-64 bytes", 400
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err := a.db.QueryRow("SELECT u.id, u.handle, u.disabled_at FROM users u, user_device ud WHERE ud.id = $1 AND u.id = ud.user_id",
		deviceID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn(errorCouldNotLogin, zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginFacebook(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	accessToken := authReq.GetFacebook()
	if accessToken == "" {
		return nil, "", 0, errorAccessTokenIsRequired, 400
	} else if invalidCharsRegex.MatchString(accessToken) {
		return nil, "", 0, "Invalid Facebook access token, no spaces or control characters allowed", 400
	}

	fbProfile, err := a.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Facebook profile", zap.Error(err))
		return nil, "", 0, errorCouldNotLogin, 401
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE facebook_id = $1",
		fbProfile.ID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn("Could not login with Facebook profile", zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginGoogle(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	accessToken := authReq.GetGoogle()
	if accessToken == "" {
		return nil, "", 0, errorAccessTokenIsRequired, 400
	} else if invalidCharsRegex.MatchString(accessToken) {
		return nil, "", 0, "Invalid Google access token, no spaces or control characters allowed", 400
	}

	googleProfile, err := a.socialClient.GetGoogleProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Google profile", zap.Error(err))
		return nil, "", 0, errorCouldNotLogin, 401
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE google_id = $1",
		googleProfile.ID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn("Could not login with Google profile", zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginGameCenter(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	gc := authReq.GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		return nil, "", 0, errorInvalidPayload, 400
	}

	_, err := a.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		a.logger.Warn("Could not check Game Center profile", zap.Error(err))
		return nil, "", 0, errorCouldNotLogin, 401
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE gamecenter_id = $1",
		gc.PlayerId).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn("Could not login with Game Center profile", zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginSteam(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	if a.config.GetSocial().Steam.PublisherKey == "" || a.config.GetSocial().Steam.AppID == 0 {
		return nil, "", 0, "Steam login not available", 401
	}

	ticket := authReq.GetSteam()
	if ticket == "" {
		return nil, "", 0, "Steam ticket is required", 400
	} else if invalidCharsRegex.MatchString(ticket) {
		return nil, "", 0, "Invalid Steam ticket, no spaces or control characters allowed", 400
	}

	steamProfile, err := a.socialClient.GetSteamProfile(a.config.GetSocial().Steam.PublisherKey, a.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		a.logger.Warn("Could not check Steam profile", zap.Error(err))
		return nil, "", 0, errorCouldNotLogin, 401
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err = a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE steam_id = $1",
		strconv.FormatUint(steamProfile.SteamID, 10)).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn("Could not login with Steam profile", zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginEmail(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	email := authReq.GetEmail()
	if email == nil {
		return nil, "", 0, errorInvalidPayload, 400
	} else if email.Email == "" {
		return nil, "", 0, "Email address is required", 400
	} else if invalidCharsRegex.MatchString(email.Email) {
		return nil, "", 0, "Invalid email address, no spaces or control characters allowed", 400
	} else if !emailRegex.MatchString(email.Email) {
		return nil, "", 0, "Invalid email address format", 400
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		return nil, "", 0, "Invalid email address, must be 10-255 bytes", 400
	}

	var userID []byte
	var handle string
	var hashedPassword []byte
	var disabledAt int64
	err := a.db.QueryRow("SELECT id, handle, password, disabled_at FROM users WHERE email = $1",
		strings.ToLower(email.Email)).
		Scan(&userID, &handle, &hashedPassword, &disabledAt)
	if err != nil {
		a.logger.Warn(errorCouldNotLogin, zap.Error(err))
		return nil, "", 0, "Invalid credentials", 401
	}

	err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(email.Password))
	if err != nil {
		a.logger.Warn("Invalid credentials", zap.Error(err))
		return nil, "", 0, "Invalid credentials", 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) loginCustom(authReq *AuthenticateRequest) ([]byte, string, int64, string, int) {
	customID := authReq.GetCustom()
	if customID == "" {
		return nil, "", 0, "Custom ID is required", 400
	} else if invalidCharsRegex.MatchString(customID) {
		return nil, "", 0, "Invalid custom ID, no spaces or control characters allowed", 400
	} else if len(customID) < 10 || len(customID) > 64 {
		return nil, "", 0, "Invalid custom ID, must be 10-64 bytes", 400
	}

	var userID []byte
	var handle string
	var disabledAt int64
	err := a.db.QueryRow("SELECT id, handle, disabled_at FROM users WHERE custom_id = $1",
		customID).
		Scan(&userID, &handle, &disabledAt)
	if err != nil {
		a.logger.Warn(errorCouldNotLogin, zap.Error(err))
		return nil, "", 0, errorIDNotFound, 401
	}

	return userID, handle, disabledAt, "", 200
}

func (a *authenticationService) register(authReq *AuthenticateRequest) ([]byte, string, string, int) {
	// Route to correct register handler
	var registerFunc func(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int)
	var registerHook func(authReq *AuthenticateRequest, userID []byte, handle string)

	switch authReq.Id.(type) {
	case *AuthenticateRequest_Device:
		registerFunc = a.registerDevice
	case *AuthenticateRequest_Facebook:
		registerFunc = a.registerFacebook
		registerHook = func(authReq *AuthenticateRequest, userID []byte, handle string) {
			l := a.logger.With(zap.String("user_id", uuid.FromBytesOrNil(userID).String()))
			a.pipeline.addFacebookFriends(l, userID, authReq.GetFacebook())
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
		return nil, "", errorInvalidPayload, 400
	}

	tx, err := a.db.Begin()
	if err != nil {
		a.logger.Warn("Could not register, transaction begin error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 500
	}

	userID, handle, errorMessage, errorCode := registerFunc(tx, authReq)

	if errorCode != 200 {
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
		return nil, "", errorCouldNotRegister, 500
	}

	// Run any post-registration steps outside the main registration transaction.
	// Errors here should not cause registration to fail.
	if registerHook != nil {
		registerHook(authReq, userID, handle)
	}

	a.logger.Info("Registration complete", zap.String("uid", uuid.FromBytesOrNil(userID).String()))
	return userID, handle, errorMessage, errorCode
}

func (a *authenticationService) addUserEdgeMetadata(tx *sql.Tx, userID []byte, updatedAt int64) error {
	_, err := tx.Exec("INSERT INTO user_edge_metadata (source_id, count, state, updated_at) VALUES ($1, 0, 0, $2)", userID, updatedAt)
	return err
}

func (a *authenticationService) registerDevice(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	deviceID := authReq.GetDevice()
	if deviceID == "" {
		return nil, "", "Device ID is required", 400
	} else if invalidCharsRegex.MatchString(deviceID) {
		return nil, "", "Invalid device ID, no spaces or control characters allowed", 400
	} else if len(deviceID) < 10 || len(deviceID) > 64 {
		return nil, "", "Invalid device ID, must be 10-64 bytes", 400
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
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
     WHERE id = $3)`,
		userID, handle, deviceID, updatedAt)
	if err != nil {
		a.logger.Warn("Could not register new device profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new device profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	res, err = tx.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, userID)
	if err != nil {
		a.logger.Warn("Could not register, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return nil, "", errorCouldNotRegister, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerFacebook(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	accessToken := authReq.GetFacebook()
	if accessToken == "" {
		return nil, "", errorAccessTokenIsRequired, 400
	} else if invalidCharsRegex.MatchString(accessToken) {
		return nil, "", "Invalid Facebook access token, no spaces or control characters allowed", 400
	}

	fbProfile, err := a.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Facebook profile", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
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
 WHERE facebook_id = $3)`,
		userID, handle, fbProfile.ID, updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Facebook profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new Facebook profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerGoogle(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	accessToken := authReq.GetGoogle()
	if accessToken == "" {
		return nil, "", errorAccessTokenIsRequired, 400
	} else if invalidCharsRegex.MatchString(accessToken) {
		return nil, "", "Invalid Google access token, no spaces or control characters allowed", 400
	}

	googleProfile, err := a.socialClient.GetGoogleProfile(accessToken)
	if err != nil {
		a.logger.Warn("Could not get Google profile", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
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
 WHERE google_id = $3)`,
		userID,
		handle,
		googleProfile.ID,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Google profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new Google profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerGameCenter(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	gc := authReq.GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		return nil, "", errorInvalidPayload, 400
	}

	_, err := a.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		a.logger.Warn("Could not get Game Center profile", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
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
 WHERE gamecenter_id = $3)`,
		userID,
		handle,
		gc.PlayerId,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Game Center profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new Game Center profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerSteam(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	if a.config.GetSocial().Steam.PublisherKey == "" || a.config.GetSocial().Steam.AppID == 0 {
		return nil, "", "Steam registration not available", 401
	}

	ticket := authReq.GetSteam()
	if ticket == "" {
		return nil, "", "Steam ticket is required", 400
	} else if invalidCharsRegex.MatchString(ticket) {
		return nil, "", "Invalid Steam ticket, no spaces or control characters allowed", 400
	}

	steamProfile, err := a.socialClient.GetSteamProfile(a.config.GetSocial().Steam.PublisherKey, a.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		a.logger.Warn("Could not get Steam profile", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
	handle := a.generateHandle()
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
 WHERE steam_id = $3)`,
		userID,
		handle,
		strconv.FormatUint(steamProfile.SteamID, 10),
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new Steam profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new Steam profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerEmail(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	email := authReq.GetEmail()
	if email == nil {
		return nil, "", errorInvalidPayload, 400
	} else if email.Email == "" {
		return nil, "", "Email address is required", 400
	} else if invalidCharsRegex.MatchString(email.Email) {
		return nil, "", "Invalid email address, no spaces or control characters allowed", 400
	} else if len(email.Password) < 8 {
		return nil, "", "Password must be longer than 8 characters", 400
	} else if !emailRegex.MatchString(email.Email) {
		return nil, "", "Invalid email address format", 400
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		return nil, "", "Invalid email address, must be 10-255 bytes", 400
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(email.Password), bcrypt.DefaultCost)

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
	handle := a.generateHandle()
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
 WHERE email = $3)`,
		userID,
		handle,
		strings.ToLower(email.Email),
		hashedPassword,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new email profile, query error", zap.Error(err))
		return nil, "", "Email already in use", 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new email profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		return nil, "", "Email already in use", 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) registerCustom(tx *sql.Tx, authReq *AuthenticateRequest) ([]byte, string, string, int) {
	customID := authReq.GetCustom()
	if customID == "" {
		return nil, "", "Custom ID is required", 400
	} else if invalidCharsRegex.MatchString(customID) {
		return nil, "", "Invalid custom ID, no spaces or control characters allowed", 400
	} else if len(customID) < 10 || len(customID) > 64 {
		return nil, "", "Invalid custom ID, must be 10-64 bytes", 400
	}

	updatedAt := nowMs()
	userID := uuid.NewV4().Bytes()
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
 WHERE custom_id = $3)`,
		userID,
		handle,
		customID,
		updatedAt)

	if err != nil {
		a.logger.Warn("Could not register new custom profile, query error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		a.logger.Warn("Could not register new custom profile, rows affected error")
		return nil, "", errorIDAlreadyInUse, 401
	}

	err = a.addUserEdgeMetadata(tx, userID, updatedAt)
	if err != nil {
		a.logger.Error("Could not register new custom profile, user edge metadata error", zap.Error(err))
		return nil, "", errorCouldNotRegister, 401
	}

	return userID, handle, "", 200
}

func (a *authenticationService) generateHandle() string {
	b := make([]byte, 10)
	for i := range b {
		b[i] = letters[a.random.Intn(len(letters))]
	}
	return string(b)
}

func (a *authenticationService) authenticateToken(tokenString string) (uuid.UUID, string, int64, bool) {
	if tokenString == "" {
		a.logger.Warn("Token missing")
		return uuid.Nil, "", 0, false
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("Unexpected signing method: %v", token.Header["alg"])
		}
		return a.hmacSecretByte, nil
	})

	if err == nil {
		if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
			uid, uerr := uuid.FromString(claims["uid"].(string))
			if uerr != nil {
				a.logger.Warn("Invalid user ID in token", zap.String("token", tokenString), zap.Error(uerr))
				return uuid.Nil, "", 0, false
			}
			return uid, claims["han"].(string), int64(claims["exp"].(float64)), true
		}
	}

	a.logger.Warn("Token invalid", zap.String("token", tokenString), zap.Error(err))
	return uuid.Nil, "", 0, false
}

func (a *authenticationService) Stop() {
	// TODO stop incoming net connections
	a.registry.stop()
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
