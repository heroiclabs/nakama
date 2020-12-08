package server

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v2/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"reflect"
	"sort"
	"strings"
)

type methodReflection struct {
	method   reflect.Method
	request  reflect.Type
	response reflect.Type
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
	r, err := reflectMethod(s.api, in.Method)
	if err != nil {
		s.logger.Error("Error reflecting method.", zap.String("method", in.Method), zap.Error(err))
		return nil, status.Error(codes.InvalidArgument, "Error looking up api method.")
	}
	callCtx, err := s.extractApiCallContext(ctx, in, false)
	if err != nil {
		return nil, err
	}

	args := make([]reflect.Value, r.method.Type.NumIn())
	args[0] = reflect.ValueOf(s.api)
	args[1] = reflect.ValueOf(callCtx)

	if r.method.Type.In(2) == reflect.TypeOf(&empty.Empty{}) {
		if in.Body != "" {
			s.logger.Error("Body passed to an api call that doesn't accept any.", zap.String("method", in.Method))
			return nil, status.Error(codes.InvalidArgument, "Api method doesn't accept a request body.")
		}
		args[2] = reflect.ValueOf(&empty.Empty{})
	} else {
		request := reflect.New(r.request).Interface().(proto.Message)
		err = jsonpb.UnmarshalString(in.Body, request)
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
		var j string
		if cval != nil {
			m := new(jsonpb.Marshaler)
			j, err = m.MarshalToString(cval.(proto.Message))
			if err != nil {
				s.logger.Error("Error serializing method response body.", zap.String("method", in.Method), zap.Error(err))
				return nil, status.Error(codes.Internal, "Error serializing method response body.")
			}
		}
		return &console.CallApiEndpointResponse{
			Body: j,
		}, nil
	}

}

func (s *ConsoleServer) extractApiCallContext(ctx context.Context, in *console.CallApiEndpointRequest, userIdOptional bool) (context.Context, error) {
	var callCtx context.Context
	if strings.HasPrefix(in.Method, "Authenticate") {
		callCtx = ctx
	} else if in.UserId == "" {
		if !userIdOptional {
			s.logger.Error("Error calling a built-in RPC function without a user_id.", zap.String("method", in.Method))
			return nil, status.Error(codes.InvalidArgument, "Built-in RPC functions require a user_id.")
		} else {
			callCtx = ctx
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
		callCtx = context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userUUID), ctxUsernameKey{}, dbUsername)
	}
	return callCtx, nil

}

func (s *ConsoleServer) ListApiEndpoints(ctx context.Context, _ *empty.Empty) (*console.ApiEndpointList, error) {
	if s.methodListCache == nil {
		s.methodListCache = make([]*console.ApiEndpointDescriptor, 0)
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
			request := method.Type.In(2)
			if request.Kind() == reflect.Ptr {
				request = request.Elem()
			}
			endpoint := &console.ApiEndpointDescriptor{
				Method:       method.Name,
				BodyTemplate: reflectProtoMessageAsJsonTemplate(request),
			}

			s.methodListCache = append(s.methodListCache, endpoint)
		}
	}

	rpcs := make([]string, 0)
	for _, rpc := range s.runtimeInfo.LuaRpcFunctions {
		rpcs = append(rpcs, rpc)
	}
	for _, rpc := range s.runtimeInfo.GoRpcFunctions {
		rpcs = append(rpcs, rpc)
	}
	for _, rpc := range s.runtimeInfo.JavaScriptRpcFunctions {
		rpcs = append(rpcs, rpc)
	}
	sort.Strings(rpcs)
	rpcMethodList := make([]*console.ApiEndpointDescriptor, 0)
	for _, rpc := range rpcs {
		rpcMethodList = append(rpcMethodList, &console.ApiEndpointDescriptor{Method: rpc})
	}

	return &console.ApiEndpointList{
		Endpoints:    s.methodListCache,
		RpcEndpoints: rpcMethodList,
	}, nil

}

func reflectMethod(api *ApiServer, name string) (*methodReflection, error) {
	apiType := reflect.TypeOf(api)
	for i := 0; i < apiType.NumMethod(); i++ {
		method := apiType.Method(i)
		if method.Name == name {
			request := method.Type.In(2)
			response := method.Type.In(0)
			return &methodReflection{
				method:   method,
				request:  request.Elem(),
				response: response.Elem(),
			}, nil
		}
	}
	return nil, fmt.Errorf("API method doesn't exist: %s", name)
}

func reflectProtoMessageAsJsonTemplate(s reflect.Type) string {

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
			m.Set(reflect.ValueOf(int32(0)))
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
	m := jsonpb.Marshaler{OrigName: false, EnumsAsInts: true, EmitDefaults: true}
	j, _ := m.MarshalToString(i)
	return j
}
