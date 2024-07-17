package server

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

type MethodName string

type rpcReflectCache struct {
	endpoints map[MethodName]*methodReflection
	rpcs      map[MethodName]*console.ApiEndpointDescriptor
}

type methodReflection struct {
	method              reflect.Method
	request             reflect.Type
	requestBodyTemplate string
	response            reflect.Type
}

func (s *ConsoleServer) CallRpcEndpoint(ctx context.Context, in *console.CallApiEndpointRequest) (*console.CallApiEndpointResponse, error) {
	callCtx, err := s.extractApiCallContext(ctx, in, true)
	if err != nil {
		return nil, err
	}

	out, err := s.api.RpcFunc(callCtx, &api.Rpc{Id: in.Method, Payload: in.Body})
	if err != nil {
		return &console.CallApiEndpointResponse{
			Body:         "",
			ErrorMessage: err.Error(),
		}, nil
	}

	return &console.CallApiEndpointResponse{
		Body:         out.Payload,
		ErrorMessage: "",
	}, nil
}

func (s *ConsoleServer) CallApiEndpoint(ctx context.Context, in *console.CallApiEndpointRequest) (*console.CallApiEndpointResponse, error) {
	r, ok := s.rpcMethodCache.endpoints[MethodName(in.Method)]
	if !ok {
		return nil, fmt.Errorf("API method doesn't exist: %s", in.Method)
	}
	callCtx, err := s.extractApiCallContext(ctx, in, false)
	if err != nil {
		return nil, err
	}

	args := make([]reflect.Value, r.method.Type.NumIn())
	args[0] = reflect.ValueOf(s.api)
	args[1] = reflect.ValueOf(callCtx)

	if r.method.Type.In(2) == reflect.TypeOf(&emptypb.Empty{}) {
		if in.Body != "" {
			s.logger.Error("Body passed to an api call that doesn't accept any.", zap.String("method", in.Method))
			return nil, status.Error(codes.InvalidArgument, "Api method doesn't accept a request body.")
		}
		args[2] = reflect.ValueOf(&emptypb.Empty{})
	} else {
		request := reflect.New(r.request).Interface().(proto.Message)
		err = protojson.Unmarshal([]byte(in.Body), request)
		if err != nil {
			s.logger.Error("Error parsing method request body.", zap.String("method", in.Method), zap.Error(err))
			return nil, status.Error(codes.InvalidArgument, "Error parsing method request body.")
		}
		args[2] = reflect.ValueOf(request)
	}
	out := r.method.Func.Call(args)
	cval := out[0].Interface()
	cerr := out[1].Interface()
	if cerr != nil {
		return &console.CallApiEndpointResponse{
			Body:         "",
			ErrorMessage: cerr.(error).Error(),
		}, nil
	} else {
		var j []byte
		if cval != nil {
			m := new(protojson.MarshalOptions)
			j, err = m.Marshal(cval.(proto.Message))
			if err != nil {
				s.logger.Error("Error serializing method response body.", zap.String("method", in.Method), zap.Error(err))
				return nil, status.Error(codes.Internal, "Error serializing method response body.")
			}
		}
		return &console.CallApiEndpointResponse{
			Body: string(j),
		}, nil
	}
}

func (s *ConsoleServer) extractApiCallContext(ctx context.Context, in *console.CallApiEndpointRequest, userIdOptional bool) (context.Context, error) {
	var callCtx context.Context
	if strings.HasPrefix(in.Method, "Authenticate") {
		callCtx = context.WithValue(ctx, ctxFullMethodKey{}, "/nakama.api.Nakama/"+in.Method)
	} else if in.UserId == "" {
		if !userIdOptional {
			s.logger.Error("Error calling a built-in RPC function without a user_id.", zap.String("method", in.Method))
			return nil, status.Error(codes.InvalidArgument, "Built-in RPC functions require a user_id.")
		} else {
			callCtx = context.WithValue(ctx, ctxFullMethodKey{}, "/nakama.api.Nakama/"+in.Method)
		}
	} else {
		row := s.db.QueryRowContext(ctx, "SELECT username FROM users WHERE id = $1", in.UserId)
		var dbUsername string
		userUUID, err := uuid.FromString(in.UserId)
		if err != nil {
			s.logger.Error("Invalid user uuid.", zap.String("method", in.Method))
			return nil, status.Error(codes.InvalidArgument, "Invalid user uuid.")
		}
		err = row.Scan(&dbUsername)
		if err != nil {
			if err == sql.ErrNoRows {
				s.logger.Error("User id not found.", zap.String("method", in.Method))
				return nil, status.Error(codes.InvalidArgument, "User id not found.")
			}
			s.logger.Error("Error looking up user account.", zap.String("method", in.Method), zap.Error(err))
			return nil, status.Error(codes.Internal, "Error looking up user account.")
		}
		callCtx = context.WithValue(ctx, ctxUserIDKey{}, userUUID)
		callCtx = context.WithValue(callCtx, ctxUsernameKey{}, dbUsername)
		callCtx = context.WithValue(callCtx, ctxVarsKey{}, map[string]string{})
		callCtx = context.WithValue(callCtx, ctxExpiryKey{}, time.Now().Add(time.Duration(s.config.GetSession().TokenExpirySec)*time.Second).Unix())
		callCtx = context.WithValue(callCtx, ctxFullMethodKey{}, "/nakama.api.Nakama/"+in.Method)
		if in.SessionVars != nil {
			callCtx = context.WithValue(callCtx, ctxVarsKey{}, in.SessionVars)
		}
	}
	return callCtx, nil
}

func (s *ConsoleServer) ListApiEndpoints(ctx context.Context, _ *emptypb.Empty) (*console.ApiEndpointList, error) {
	endpointNames := make([]string, 0, len(s.rpcMethodCache.endpoints))
	for name := range s.rpcMethodCache.endpoints {
		endpointNames = append(endpointNames, string(name))
	}
	sort.Strings(endpointNames)
	endpoints := make([]*console.ApiEndpointDescriptor, 0, len(endpointNames))
	for _, name := range endpointNames {
		endpoint := s.rpcMethodCache.endpoints[MethodName(name)]
		endpoints = append(endpoints, &console.ApiEndpointDescriptor{
			Method:       name,
			BodyTemplate: endpoint.requestBodyTemplate,
		})
	}

	rpcs := make([]string, 0, len(s.rpcMethodCache.rpcs))
	for name := range s.rpcMethodCache.rpcs {
		rpcs = append(rpcs, string(name))
	}
	sort.Strings(rpcs)
	rpcEndpoints := make([]*console.ApiEndpointDescriptor, 0, len(rpcs))
	for _, name := range rpcs {
		endpoint := s.rpcMethodCache.rpcs[MethodName(name)]
		rpcEndpoints = append(rpcEndpoints, &console.ApiEndpointDescriptor{
			Method:       name,
			BodyTemplate: endpoint.BodyTemplate,
		})
	}
	return &console.ApiEndpointList{
		Endpoints:    endpoints,
		RpcEndpoints: rpcEndpoints,
	}, nil
}

func (s *ConsoleServer) initRpcMethodCache() error {
	endpoints := make(map[MethodName]*methodReflection)
	apiType := reflect.TypeOf(s.api)
	for i := 0; i < apiType.NumMethod(); i++ {
		method := apiType.Method(i)
		if method.Type.NumIn() != 3 || method.Type.NumOut() != 2 {
			continue
		}
		if method.Name == "Healthcheck" {
			continue
		}
		if method.Name == "RpcFunc" {
			continue
		}
		var bodyTemplate string
		var err error

		request := method.Type.In(2)

		if request != reflect.TypeOf(&emptypb.Empty{}) {
			if request.Kind() == reflect.Ptr {
				request = request.Elem()
			}
			bodyTemplate, err = reflectProtoMessageAsJsonTemplate(request)
			if err != nil {
				return err
			}
		}

		endpoints[MethodName(method.Name)] = &methodReflection{
			method:              method,
			request:             request,
			requestBodyTemplate: bodyTemplate,
			response:            method.Type.In(0),
		}
	}

	rpcs := make(map[MethodName]*console.ApiEndpointDescriptor)
	for _, rpc := range s.runtimeInfo.JavaScriptRpcFunctions {
		rpcs[MethodName(rpc)] = &console.ApiEndpointDescriptor{Method: rpc}
	}
	for _, rpc := range s.runtimeInfo.LuaRpcFunctions {
		rpcs[MethodName(rpc)] = &console.ApiEndpointDescriptor{Method: rpc}
	}
	for _, rpc := range s.runtimeInfo.GoRpcFunctions {
		rpcs[MethodName(rpc)] = &console.ApiEndpointDescriptor{Method: rpc}
	}

	s.rpcMethodCache = &rpcReflectCache{
		endpoints: endpoints,
		rpcs:      rpcs,
	}
	return nil
}

func reflectProtoMessageAsJsonTemplate(s reflect.Type) (string, error) {
	var populate func(m reflect.Value) reflect.Value
	populate = func(m reflect.Value) reflect.Value {
		switch m.Kind() {
		case reflect.Ptr:
			if m.IsNil() {
				m.Set(reflect.New(m.Type().Elem()))
			}
			populate(m.Elem())
		case reflect.Slice:
			m.Set(reflect.Append(m, populate(reflect.New(m.Type().Elem()).Elem())))
		case reflect.Map:
			if m.IsNil() {
				m.Set(reflect.MakeMap(m.Type()))
			}
			key := populate(reflect.New(m.Type().Key()).Elem())
			value := populate(reflect.New(m.Type().Elem()).Elem())
			m.SetMapIndex(key, value)
		case reflect.String:
			m.Set(reflect.ValueOf("<string>"))
		case reflect.Bool:
			m.Set(reflect.ValueOf(false))
		case reflect.Int:
			m.Set(reflect.ValueOf(0))
		case reflect.Int8:
			m.Set(reflect.ValueOf(int8(0)))
		case reflect.Int16:
			m.Set(reflect.ValueOf(int16(0)))
		case reflect.Int32:
			if m.Type().AssignableTo(reflect.TypeOf(int32(0))) {
				m.Set(reflect.ValueOf(int32(0)))
			} else {
				// Handle special Int32 case for proto defined Enums
				m.Set(m.Convert(m.Type()))
			}
		case reflect.Int64:
			m.Set(reflect.ValueOf(int64(0)))
		case reflect.Uint:
			m.Set(reflect.ValueOf(uint(0)))
		case reflect.Uint8:
			m.Set(reflect.ValueOf(uint8(0)))
		case reflect.Uint16:
			m.Set(reflect.ValueOf(uint16(0)))
		case reflect.Uint32:
			m.Set(reflect.ValueOf(uint32(0)))
		case reflect.Uint64:
			m.Set(reflect.ValueOf(uint64(0)))
		case reflect.Float32:
			m.Set(reflect.ValueOf(float32(0)))
		case reflect.Float64:
			m.Set(reflect.ValueOf(float64(0)))
		case reflect.Struct:
			for i := 0; i < m.NumField(); i++ {
				field := m.Field(i)
				fieldName := m.Type().Field(i).Name
				if fieldName[0] == strings.ToLower(fieldName)[0] {
					continue
				}
				populate(field)
			}
		}
		return m
	}
	i := populate(reflect.New(s)).Interface().(proto.Message)
	m := protojson.MarshalOptions{UseProtoNames: false, UseEnumNumbers: true, EmitUnpopulated: true}
	j, err := m.Marshal(i)
	if err != nil {
		return "", err
	}
	return string(j), nil
}
