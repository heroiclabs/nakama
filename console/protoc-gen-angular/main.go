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

package main

import (
	"bytes"
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"text/template"

	"github.com/golang/protobuf/proto"
	pbdescriptor "github.com/golang/protobuf/protoc-gen-go/descriptor"
	plugin "github.com/golang/protobuf/protoc-gen-go/plugin"
	"github.com/grpc-ecosystem/grpc-gateway/codegenerator"
	"github.com/grpc-ecosystem/grpc-gateway/protoc-gen-grpc-gateway/descriptor"
	swagger_options "github.com/grpc-ecosystem/grpc-gateway/protoc-gen-swagger/options"
)

type EnumDefinitions map[string]*EnumDefinition
type MsgDefinitions map[string]MsgFields
type RPCDefinitions map[string]*RPCDefinition
type EnumFields []*EnumField
type MsgFields []*MsgField

type EnumDefinition struct {
	Fields        EnumFields
	ProtoLocation string
}

type Definitions struct {
	Config          *Config
	EnumDefinitions EnumDefinitions
	MsgDefinitions  MsgDefinitions
	RPCDefinitions  RPCDefinitions
}

type Config struct {
	ClassName   string
	DefaultHost string
}

type RPCDefinition struct {
	EndpointPath string
	HttpMethod   string
	InputType    string
	OutputType   string
	Arguments    []*Argument
	Auth         []string
}

type EnumField struct {
	Label     string
	Number    int32
	Namespace string
}

type MsgField struct {
	Namespace string
	FieldName string
	FieldType string
	Repeated  bool
}

type Argument struct {
	In        string
	Name      string
	Type      string
	Namespace string
	Repeated  bool // For query parameters that can be repeated
}

var (
	serviceName = flag.String("service_name", "HttpService", "Class name of the angular generated service.")
	filename    = flag.String("filename", "http.service.ts", "Output filename.")
	defaultHost = flag.String("default_host", "http://127.0.0.1:7120", "Default host.")
)
var PackageName string

func main() {
	parsedReq, err := codegenerator.ParseRequest(os.Stdin)
	if err != nil {
		log.Fatal(err)
	}
	parseReqParameters(parsedReq)

	reg := descriptor.NewRegistry()

	if err := reg.Load(parsedReq); err != nil {
		log.Fatal(err)
	}

	var targets []*descriptor.File
	for _, target := range parsedReq.FileToGenerate {
		f, err := reg.LookupFile(target)
		if err != nil {
			log.Fatal(err)
		}
		targets = append(targets, f)
	}

	var protoFile *pbdescriptor.FileDescriptorProto
	for _, pf := range parsedReq.ProtoFile {
		if pf.GetName() == parsedReq.FileToGenerate[0] {
			protoFile = pf
		}
	}
	if protoFile == nil {
		log.Fatal("Couldn't retrieve FileDescriptorProto to extract swagger options")
	}

	PackageName = protoFile.GetPackage()

	spb, err := extractSwaggerOptionFromFileDescriptor(protoFile)
	defaultSecDef := getSecurityDefinitions(spb.Security)

	enumDefinitions := make(EnumDefinitions)
	msgDefinitions := make(MsgDefinitions)
	rpcDefinitions := make(RPCDefinitions)

	for _, target := range targets {
		for _, service := range target.Services {
			for _, m := range service.Methods {
				inputMsg, err := reg.LookupMsg("", m.GetInputType())
				if err != nil {
					log.Fatal(err)
				}
				findMessagesAndEnumerations(reg, inputMsg, m.GetInputType(), msgDefinitions, enumDefinitions)

				outputMsg, err := reg.LookupMsg("", m.GetOutputType())
				if err != nil {
					log.Fatal(err)
				}
				findMessagesAndEnumerations(reg, outputMsg, m.GetOutputType(), msgDefinitions, enumDefinitions)

				inputType := m.GetInputType()
				convertedInType, found := protobufToJsonTypes[inputType]
				if found {
					inputType = convertedInType
				}
				outputType := m.GetOutputType()
				convertedOutType, found := protobufToJsonTypes[outputType]
				if found {
					outputType = convertedOutType
				}
				opts, err := extractOperationOptionFromMethodDescriptor(m.MethodDescriptorProto)
				if err != nil {
					log.Fatal(err)
				}

				var authDef []string
				if opts != nil {
					authDef = getSecurityDefinitions(opts.Security)
				} else {
					authDef = defaultSecDef
				}

				arguments := getArgumentsFromBindings(m.Bindings[0], inputType, msgDefinitions)
				rpcDefinitions[m.GetName()] = &RPCDefinition{
					EndpointPath: m.Bindings[0].PathTmpl.Template,
					HttpMethod:   strings.ToLower(m.Bindings[0].HTTPMethod),
					InputType:    inputType,
					OutputType:   outputType,
					Arguments:    arguments,
					Auth:         authDef,
				}
			}
		}
	}

	cleanupUnusedFieldsAndMessages(msgDefinitions, rpcDefinitions)
	code := applyTemplate("ts-angular-template", tsAngularTemplate, &Definitions{
		EnumDefinitions: enumDefinitions,
		MsgDefinitions:  msgDefinitions,
		RPCDefinitions:  rpcDefinitions,
		Config: &Config{
			ClassName:   *serviceName,
			DefaultHost: *defaultHost,
		},
	})
	var files []*plugin.CodeGeneratorResponse_File
	files = append(files, &plugin.CodeGeneratorResponse_File{
		Name:    proto.String(*filename),
		Content: proto.String(code),
	})
	emitFiles(files)
}

// Parses generator request params from the protoc toolchain
func parseReqParameters(req *plugin.CodeGeneratorRequest) {
	if req.Parameter != nil {
		for _, p := range strings.Split(req.GetParameter(), ",") {
			spec := strings.SplitN(p, "=", 2)
			if len(spec) == 1 {
				if err := flag.CommandLine.Set(spec[0], ""); err != nil {
					log.Fatalf("Cannot set flag %s", p)
				}
				continue
			}
			name, value := spec[0], spec[1]
			if err := flag.CommandLine.Set(name, value); err != nil {
				log.Fatalf("Cannot set flag %s", p)
			}
		}
	}
}

// Extracts the arguments using the rules specified in https://github.com/googleapis/googleapis/blob/master/google/api/http.proto#L45
func getArgumentsFromBindings(b *descriptor.Binding, inputType string, m MsgDefinitions) []*Argument {
	args := make([]*Argument, 0)
	pathArgs := make(map[string]bool)
	for _, f := range b.PathTmpl.Fields {
		args = append(args, &Argument{
			In:   "path",
			Name: f,
			Type: "string",
		})
		pathArgs[f] = true
	}

	if b.Body == nil {
		for _, msgField := range m[inputType] {
			if _, found := pathArgs[msgField.FieldName]; found {
				continue
			}
			namespace := msgField.Namespace
			fType := msgField.FieldType
			if jType, found := protobufToJsonTypes[namespace]; found {
				namespace = ""
				fType = jType
			}
			args = append(args, &Argument{
				Namespace: namespace,
				In:        "query",
				Name:      msgField.FieldName,
				Type:      fType,
				Repeated:  msgField.Repeated,
			})
		}
	} else if b.Body.FieldPath.String() == "*" || b.Body.FieldPath.String() == "" {
		args = append(args, &Argument{
			In:   "body",
			Name: "body",
			Type: inputType,
		})
	} else if b.Body.FieldPath.String() != "*" {
		for _, bodyArg := range m[inputType] {
			if bodyArg.FieldName == b.Body.FieldPath.String() {
				args = append(args, &Argument{
					Namespace: bodyArg.Namespace,
					In:        "body",
					Name:      b.Body.FieldPath.String(),
					Type:      bodyArg.FieldType,
				})
			}
		}
	}
	return args
}

func getSecurityDefinitions(options []*swagger_options.SecurityRequirement) []string {
	defaultSecRequirements := make([]string, 0)
	for _, secReq := range options {
		for key, _ := range secReq.SecurityRequirement {
			defaultSecRequirements = append(defaultSecRequirements, key)
		}
	}
	return defaultSecRequirements
}

// Recursively look for nested messages and enumeration declarations within the message
func findMessagesAndEnumerations(reg *descriptor.Registry, message *descriptor.Message, namespace string, m MsgDefinitions, e EnumDefinitions) {
	msgFields := make([]*MsgField, 0)
	_, foundProtoType := protobufToJsonTypes[namespace]
	if _, found := m[namespace]; foundProtoType || found {
		return
	}
	for _, f := range message.Fields {
		switch f.GetType().String() {
		case "TYPE_ENUM":
			enum, err := reg.LookupEnum("", f.GetTypeName())
			if err != nil {
				return
			}
			enumFields := make(EnumFields, 0)
			for _, enumField := range enum.Value {
				enumFields = append(enumFields, &EnumField{
					Label:  enumField.GetName(),
					Number: enumField.GetNumber(),
				})
			}
			e[f.GetTypeName()] = &EnumDefinition{
				Fields:        enumFields,
				ProtoLocation: f.GetTypeName(),
			}
			msgFields = append(msgFields, &MsgField{
				Namespace: f.GetTypeName(),
				FieldName: f.GetName(),
				FieldType: "enum",
				Repeated:  f.Label.String() == "LABEL_REPEATED",
			})
		default:
			fieldType := f.GetType().String()
			namespace := f.GetTypeName()
			if f.GetType().String() == "TYPE_MESSAGE" {
				protoType, found := protobufToJsonTypes[f.GetTypeName()]
				if found {
					fieldType = protoType
					namespace = ""
				} else {
					fieldType = f.GetTypeName()
				}
			} else {
				fieldType = primitiveToJson(f.GetType().String())
			}
			msgFields = append(msgFields, &MsgField{
				Namespace: namespace,
				FieldName: f.GetName(),
				FieldType: fieldType,
				Repeated:  f.Label.String() == "LABEL_REPEATED",
			})
			msg, err := reg.LookupMsg("", f.GetTypeName())
			if err != nil {
				continue
			}
			findMessagesAndEnumerations(reg, msg, f.GetTypeName(), m, e)
		}
	}
	m[namespace] = msgFields
}

//Extract swagger options from file
func extractSwaggerOptionFromFileDescriptor(file *pbdescriptor.FileDescriptorProto) (*swagger_options.Swagger, error) {
	if file.Options == nil {
		return nil, nil
	}
	if !proto.HasExtension(file.Options, swagger_options.E_Openapiv2Swagger) {
		return nil, nil
	}
	ext, err := proto.GetExtension(file.Options, swagger_options.E_Openapiv2Swagger)
	if err != nil {
		return nil, err
	}
	opts, ok := ext.(*swagger_options.Swagger)
	if !ok {
		return nil, fmt.Errorf("extension is %T; want a Swagger object", ext)
	}
	return opts, nil
}

//Extract swagger options from method
func extractOperationOptionFromMethodDescriptor(meth *pbdescriptor.MethodDescriptorProto) (*swagger_options.Operation, error) {
	if meth.Options == nil {
		return nil, nil
	}
	if !proto.HasExtension(meth.Options, swagger_options.E_Openapiv2Operation) {
		return nil, nil
	}
	ext, err := proto.GetExtension(meth.Options, swagger_options.E_Openapiv2Operation)
	if err != nil {
		return nil, err
	}
	opts, ok := ext.(*swagger_options.Operation)
	if !ok {
		return nil, fmt.Errorf("extension is %T; want an Operation", ext)
	}
	return opts, nil
}

func applyTemplate(templateName, templateString string, data interface{}) string {
	template, err := template.New(templateName).Funcs(template.FuncMap{
		"title":                strings.Title,
		"convertPathToJs":      convertPathToJs,
		"decapitalize":         decapitalize,
		"getTypeFromNamespace": getTypeFromNamespace,
	}).Parse(templateString)
	if err != nil {
		log.Fatal(err)
	}
	writer := bytes.NewBuffer(nil)
	if err := template.Execute(writer, data); err != nil {
		log.Fatal(err)
	}
	return writer.String()
}

// For messages that are not reused, remove any fields that are already in the path arguments of the functions
// that use said message as a parameter
func cleanupUnusedFieldsAndMessages(msgDefs MsgDefinitions, rpcDefs RPCDefinitions) {
	// Count use of messages across RPC calls
	msgUsageCount := make(map[string]int)
	for msgNamespace, _ := range msgDefs {
		msgUsageCount[msgNamespace] = 0
		for _, rpcDef := range rpcDefs {
			for _, arg := range rpcDef.Arguments {
				if msgNamespace == arg.Type {
					msgUsageCount[msgNamespace] += 1
				}
			}
		}
	}

	// Remove message fields already present in the path for a given RPC call
	for msgNamespace, usageCount := range msgUsageCount {
		if usageCount == 1 {
			msgFields, _ := msgDefs[msgNamespace]
			for _, rpcDef := range rpcDefs {
				if msgNamespace == rpcDef.InputType {
					remFields := make([]string, 0)
					for _, rpcArg := range rpcDef.Arguments {
						if rpcArg.In == "path" {
							for _, msgField := range msgFields {
								if msgField.FieldName == rpcArg.Name {
									remFields = append(remFields, msgField.FieldName)
								}
							}
						}
					}
					keepFields := make(MsgFields, 0)
				foundCheck:
					for _, field := range msgFields {
						for _, fieldToRemove := range remFields {
							if field.FieldName == fieldToRemove {
								continue foundCheck
							}
						}
						keepFields = append(keepFields, field)
					}
					msgDefs[msgNamespace] = keepFields
				}
			}
		}
	}

	// Remove body argument if its an empty message
	for _, rpcDef := range rpcDefs {
		for i, arg := range rpcDef.Arguments {
			if arg.In == "body" && arg.Type != "" {
				msgFields, _ := msgDefs[arg.Type]
				if msgFields != nil && len(msgFields) == 0 {
					rpcDef.Arguments = append(rpcDef.Arguments[:i], rpcDef.Arguments[i+1:]...)
				}
			}
		}
	}
}

func emitFiles(out []*plugin.CodeGeneratorResponse_File) {
	emitResp(&plugin.CodeGeneratorResponse{File: out})
}

func emitResp(resp *plugin.CodeGeneratorResponse) {
	buf, err := proto.Marshal(resp)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stdout.Write(buf); err != nil {
		log.Fatal(err)
	}
}

// Map of protobuf wrappers that can be converted to simple JSON types
var protobufToJsonTypes = map[string]string{
	".google.protobuf.Timestamp":   "string",
	".google.protobuf.Duration":    "string",
	".google.protobuf.StringValue": "string",
	".google.protobuf.BytesValue":  "string",
	".google.protobuf.Int32Value":  "number",
	".google.protobuf.UInt32Value": "number",
	".google.protobuf.Int64Value":  "string",
	".google.protobuf.UInt64Value": "string",
	".google.protobuf.FloatValue":  "number",
	".google.protobuf.DoubleValue": "number",
	".google.protobuf.BoolValue":   "boolean",
	".google.protobuf.Empty":       "",
	".google.protobuf.Struct":      "object",
	".google.protobuf.Value":       "object",
	".google.protobuf.NullValue":   "string",
	"Empty":                        "",
}

// Convert basic protbuf types to JSON types
func primitiveToJson(t string) string {
	switch t {
	case "TYPE_DOUBLE":
		return "number"
	case "TYPE_FLOAT":
		return "number"
	case "TYPE_INT64":
		return "string"
	case "TYPE_UINT64":
		// 64bit integer types are marshaled as string in the default JSONPb marshaler.
		// TODO(yugui) Add an option to declare 64bit integers as int64.
		//
		// NOTE: uint64 is not a predefined format of integer type in Swagger spec.
		// So we cannot expect that uint64 is commonly supported by swagger processor.
		return "string"
	case "TYPE_INT32":
		return "number"
	case "TYPE_FIXED64":
		// Ditto.
		return "string"
	case "TYPE_FIXED32":
		// Ditto.
		return "number"
	case "TYPE_BOOL":
		return "boolean"
	case "TYPE_STRING":
		return "string"
	case "TYPE_BYTES":
		return "string"
	case "TYPE_UINT32":
		// Ditto.
		return "number"
	case "TYPE_SFIXED32":
		return "number"
	case "TYPE_SFIXED64":
		return "string"
	case "TYPE_SINT32":
		return "number"
	case "TYPE_SINT64":
		return "string"
	default:
		return ""
	}
}

const tsAngularTemplate string = `// tslint:disable
/* Code generated automatically DO NOT EDIT. */
import { Injectable, Optional } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

const DEFAULT_HOST = '{{.Config.DefaultHost}}';
const DEFAULT_TIMEOUT_MS = 5000;

export class ConfigParams {
  host: string
  timeoutMs: number
}

@Injectable({providedIn: 'root'})
export class {{.Config.ClassName}} {
  private readonly config;

  constructor(private httpClient: HttpClient, @Optional() config: ConfigParams) {
    const defaultConfig: ConfigParams = {
      host: DEFAULT_HOST,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    this.config = config || defaultConfig;
  }

  {{- range $methodName, $methodData := .RPCDefinitions }}
  {{- $output := $methodData.OutputType }}
  {{- $body := false }}

  public {{ getTypeFromNamespace $methodName | decapitalize }}(
	{{- $authFunction := "" -}}
	{{- if eq (index $methodData.Auth 0) "BearerJwt" -}}{{- $authFunction = "getTokenAuthHeaders(auth_token)" -}}auth_token: string{{ end -}}
	{{- if eq (index $methodData.Auth 0) "BasicAuth" -}}{{- $authFunction = "getBasicAuthHeaders(username, password)" -}}username: string, password: string{{ end -}}
	{{- range $argument := $methodData.Arguments }}
		{{- if (ne (index $methodData.Auth 0) "") -}}{{- ", " -}}{{ end -}}
		{{- if eq $argument.In "path" -}}{{ $argument.Name }}: {{ $argument.Type }}{{- end -}}
		{{- if eq $argument.In "query" -}}{{ $argument.Name }}: {{if eq $argument.Namespace "" -}}{{ $argument.Type }}{{- else -}}{{ getTypeFromNamespace $argument.Namespace }}{{- end -}}{{- end -}}{{if $argument.Repeated -}}[]{{end}}
		{{- if eq $argument.In "body" -}}{{ $argument.Name }}: {{$body = true}}{{ getTypeFromNamespace $argument.Type }}{{- end -}}
	{{- end -}}
  ): Observable<{{- if ne $output "" }}{{ getTypeFromNamespace $output }}{{- else}}any{{- end}}> {
    const urlPath = {{ $methodData.EndpointPath | convertPathToJs -}};
    let params = new HttpParams();
	{{- range $argument := $methodData.Arguments -}}
	{{if eq $argument.In "query"}}
    if ({{$argument.Name}}) {
      {{if $argument.Repeated -}}
      {{$argument.Name}}.forEach(e => params = params.append('{{$argument.Name}}', String(e)))
      {{- else -}}
      params = params.set('{{$argument.Name}}', {{if eq $argument.Type "string" -}} {{$argument.Name}}{{else}}String({{$argument.Name}}){{- end}});
      {{- end}}
    }{{ end }}
	{{- end }}
    return this.httpClient.{{ $methodData.HttpMethod }}{{- if ne $output ""}}<{{ getTypeFromNamespace $output }}>{{- end}}(this.config.host + urlPath{{- if eq $body true}}, body{{- end}}, { params: params{{- if ne $authFunction "" }}, headers: this.{{$authFunction}}{{- end}} })
  }
{{- end }}

  private getTokenAuthHeaders(token: string): HttpHeaders {
    return new HttpHeaders().set('Authorization', 'Bearer ' + token);
  }

  private getBasicAuthHeaders(username: string, password: string): HttpHeaders {
    return new HttpHeaders().set('Authorization', 'Basic ' + btoa(username + ':' + password));
  }
}

{{- range $defname, $definitions := .MsgDefinitions }}
{{- $classname := $defname }}

export interface {{ getTypeFromNamespace $classname }} {
  {{- range $field := $definitions }}
  {{- if eq $field.FieldType "enum" }}
  {{ $field.FieldName }}?: {{ getTypeFromNamespace $field.Namespace -}}{{- if $field.Repeated }}[]{{end}}
  {{- else }}
  {{ $field.FieldName }}?: {{ if eq $field.Namespace "" }}{{ $field.FieldType -}}{{else}}{{ getTypeFromNamespace $field.FieldType -}}{{end}}{{- if $field.Repeated }}[]{{end}}
  {{- end }}
  {{- end }}
}
{{- end }}
{{- range $defname, $definitions := .EnumDefinitions }}
{{- $classname := $defname }}

export enum {{ getTypeFromNamespace $classname }} {
  {{- range $field := $definitions.Fields }}
  {{ $field.Label }} = {{ $field.Number }},
{{- end }}
}
{{- end }}
`

func decapitalize(in string) string {
	return strings.ToLower(in[:1]) + in[1:]
}

// Return the name of a package from a namespace (e.g: .api.Project returns Project).
// If the namespace is nested (it has more than 3 levels) flatten it so that there are no collisions if they're mapped to the same
// level in the output file. E.g.: .api.ProjectOperation.Status returns ProjectOperationStatus
func getTypeFromNamespace(typeName string) string {
	if !strings.HasPrefix(typeName, ".") {
		return typeName
	}
	tokens := strings.Split(strings.TrimPrefix(typeName, "."+PackageName), ".")
	level := 0
	if len(tokens) > 2 {
		level = 1
	}
	return strings.Title(strings.Join(tokens[len(tokens)-1-level:], ""))
}

// Converts a path with params to a JS interpolated string
// E.g.: "/v1/builder/{name}/user/{user_id}" becomes `/v1/builder/${name}/user/${user_id}`
func convertPathToJs(path string) string {
	// Regex to identify variables within brackets e.g.: {foo}/baz/{bar}
	findBracketVarsReg := regexp.MustCompile("{(.+?)}")
	matches := findBracketVarsReg.FindAllStringSubmatch(path, -1)
	jsPath := fmt.Sprintf("`%s`", path)
	if len(matches) > 0 {
		for _, m := range matches {
			jsPath = strings.Replace(jsPath, m[0], fmt.Sprintf("$%s", m[0]), 1)
		}
	}
	return jsPath
}
