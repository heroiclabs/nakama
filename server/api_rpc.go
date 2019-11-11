// Copyright 2018 The Nakama Authors
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
	"context"
	"encoding/json"
	"io/ioutil"
	"net/http"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/gorilla/mux"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

var (
	authTokenInvalidBytes    = []byte(`{"error":"Auth token invalid","message":"Auth token invalid","code":16}`)
	httpKeyInvalidBytes      = []byte(`{"error":"HTTP key invalid","message":"HTTP key invalid","code":16}`)
	noAuthBytes              = []byte(`{"error":"Auth token or HTTP key required","message":"Auth token or HTTP key required","code":16}`)
	rpcIDMustBeSetBytes      = []byte(`{"error":"RPC ID must be set","message":"RPC ID must be set","code":3}`)
	rpcFunctionNotFoundBytes = []byte(`{"error":"RPC function not found","message":"RPC function not found","code":5}`)
	internalServerErrorBytes = []byte(`{"error":"Internal Server Error","message":"Internal Server Error","code":13}`)
	badJSONBytes             = []byte(`{"error":"json: cannot unmarshal object into Go value of type string","message":"json: cannot unmarshal object into Go value of type string","code":3}`)
)

func (s *ApiServer) RpcFuncHttp(w http.ResponseWriter, r *http.Request) {
	// Check first token then HTTP key for authentication, and add user info to the context.
	queryParams := r.URL.Query()
	var tokenAuth bool
	var userID uuid.UUID
	var username string
	var vars map[string]string
	var expiry int64
	if auth := r.Header["Authorization"]; len(auth) >= 1 {
		userID, username, vars, expiry, tokenAuth = parseBearerAuth([]byte(s.config.GetSession().EncryptionKey), auth[0])
		if !tokenAuth {
			// Auth token not valid or expired.
			w.WriteHeader(http.StatusUnauthorized)
			w.Header().Set("content-type", "application/json")
			_, err := w.Write(authTokenInvalidBytes)
			if err != nil {
				s.logger.Debug("Error writing response to client", zap.Error(err))
			}
			return
		}
	} else if httpKey := queryParams.Get("http_key"); httpKey != "" {
		if httpKey != s.config.GetRuntime().HTTPKey {
			// HTTP key did not match.
			w.WriteHeader(http.StatusUnauthorized)
			w.Header().Set("content-type", "application/json")
			_, err := w.Write(httpKeyInvalidBytes)
			if err != nil {
				s.logger.Debug("Error writing response to client", zap.Error(err))
			}
			return
		}
	} else {
		// No authentication present.
		w.WriteHeader(http.StatusUnauthorized)
		w.Header().Set("content-type", "application/json")
		_, err := w.Write(noAuthBytes)
		if err != nil {
			s.logger.Debug("Error writing response to client", zap.Error(err))
		}
		return
	}

	// Check the RPC function ID.
	maybeID, ok := mux.Vars(r)["id"]
	if !ok || maybeID == "" {
		// Missing RPC function ID.
		w.WriteHeader(http.StatusBadRequest)
		w.Header().Set("content-type", "application/json")
		_, err := w.Write(rpcIDMustBeSetBytes)
		if err != nil {
			s.logger.Debug("Error writing response to client", zap.Error(err))
		}
		return
	}
	id := strings.ToLower(maybeID)

	// Find the correct RPC function.
	fn := s.runtime.Rpc(id)
	if fn == nil {
		// No function registered for this ID.
		w.WriteHeader(http.StatusNotFound)
		w.Header().Set("content-type", "application/json")
		_, err := w.Write(rpcFunctionNotFoundBytes)
		if err != nil {
			s.logger.Debug("Error writing response to client", zap.Error(err))
		}
		return
	}

	// Check if we need to mimic existing GRPC Gateway behaviour or expect to receive/send unwrapped data.
	// Any value for this query parameter, including the parameter existing with an empty value, will
	// indicate that raw behaviour is expected.
	_, unwrap := queryParams["unwrap"]

	// Prepare input to function.
	var payload string
	if r.Method == "POST" {
		b, err := ioutil.ReadAll(r.Body)
		if err != nil {
			// Error reading request body.
			w.WriteHeader(http.StatusInternalServerError)
			w.Header().Set("content-type", "application/json")
			_, err := w.Write(internalServerErrorBytes)
			if err != nil {
				s.logger.Debug("Error writing response to client", zap.Error(err))
			}
			return
		}

		// Maybe attempt to decode to a JSON string to mimic existing GRPC Gateway behaviour.
		if !unwrap {
			err = json.Unmarshal(b, &payload)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				w.Header().Set("content-type", "application/json")
				_, err := w.Write(badJSONBytes)
				if err != nil {
					s.logger.Debug("Error writing response to client", zap.Error(err))
				}
				return
			}
		} else {
			payload = string(b)
		}
	}

	queryParams.Del("http_key")

	uid := ""
	if tokenAuth {
		uid = userID.String()
	}

	clientIP, clientPort := extractClientAddressFromRequest(s.logger, r)

	// Execute the function.
	result, fnErr, code := fn(r.Context(), queryParams, uid, username, vars, expiry, "", clientIP, clientPort, payload)
	if fnErr != nil {
		response, _ := json.Marshal(map[string]interface{}{"error": fnErr, "message": fnErr.Error(), "code": code})
		w.WriteHeader(runtime.HTTPStatusFromCode(code))
		w.Header().Set("content-type", "application/json")
		_, err := w.Write(response)
		if err != nil {
			s.logger.Debug("Error writing response to client", zap.Error(err))
		}
		return
	}

	// Return the successful result.
	var response []byte
	if !unwrap {
		// GRPC Gateway equivalent behaviour.
		var err error
		response, err = json.Marshal(map[string]interface{}{"payload": result})
		if err != nil {
			// Failed to encode the wrapped response.
			s.logger.Error("Error marshaling wrapped response to client", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			w.Header().Set("content-type", "application/json")
			_, err := w.Write(internalServerErrorBytes)
			if err != nil {
				s.logger.Debug("Error writing response to client", zap.Error(err))
			}
			return
		}
	} else {
		// "Unwrapped" response.
		response = []byte(result)
	}
	w.WriteHeader(http.StatusOK)
	if contentType := r.Header["Content-Type"]; unwrap && len(contentType) > 0 {
		// Assume the request input content type is the same as the expected response.
		w.Header().Set("content-type", contentType[0])
	} else {
		// Fall back to default response content type application/json.
		w.Header().Set("content-type", "application/json")
	}
	_, err := w.Write(response)
	if err != nil {
		s.logger.Debug("Error writing response to client", zap.Error(err))
	}
}

func (s *ApiServer) RpcFunc(ctx context.Context, in *api.Rpc) (*api.Rpc, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "RPC ID must be set")
	}

	id := strings.ToLower(in.Id)

	fn := s.runtime.Rpc(id)
	if fn == nil {
		return nil, status.Error(codes.NotFound, "RPC function not found")
	}

	queryParams := make(map[string][]string, 0)
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "RPC function could not get incoming context")
	}
	for k, vs := range md {
		// Only process the keys representing custom query parameters.
		if strings.HasPrefix(k, "q_") {
			queryParams[k[2:]] = vs
		}
	}

	uid := ""
	username := ""
	var vars map[string]string
	expiry := int64(0)
	if u := ctx.Value(ctxUserIDKey{}); u != nil {
		uid = u.(uuid.UUID).String()
	}
	if u := ctx.Value(ctxUsernameKey{}); u != nil {
		username = u.(string)
	}
	if v := ctx.Value(ctxVarsKey{}); v != nil {
		vars = v.(map[string]string)
	}
	if e := ctx.Value(ctxExpiryKey{}); e != nil {
		expiry = e.(int64)
	}

	clientIP, clientPort := extractClientAddressFromContext(s.logger, ctx)

	result, fnErr, code := fn(ctx, queryParams, uid, username, vars, expiry, "", clientIP, clientPort, in.Payload)
	if fnErr != nil {
		return nil, status.Error(code, fnErr.Error())
	}

	return &api.Rpc{Payload: result}, nil
}
