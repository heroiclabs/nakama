package tests

import (
	"errors"
	"io/ioutil"
	"os"
	"path/filepath"
	"testing"

	"nakama/server"

	"encoding/json"

	"bytes"

	"reflect"

	"database/sql"
	"fmt"
	"net/url"

	"github.com/gogo/protobuf/jsonpb"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

const DATA_PATH = "/tmp/nakama/data/"

var db *sql.DB

func setupDB() {
	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", "root@localhost:26257/nakama")
	url, _ := url.Parse(rawurl)
	db, _ = sql.Open("postgres", url.String())
}

func newRuntime() (*server.Runtime, error) {
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))
	return server.NewRuntime(logger, logger, db, server.NewRuntimeConfig(DATA_PATH))
}

func writeStatsModule() {
	writeFile("stats.lua", `
stats={}

-- Get the mean value of a table
function stats.mean( t )
  local sum = 0
  local count= 0

  for k,v in pairs(t) do
    if type(v) == 'number' then
      sum = sum + v
      count = count + 1
    end
  end

  return (sum / count)
end
print("Stats Module Loaded")
return stats`)
}

func writeTestModule() {
	writeFile("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld()
	print("Hello World")
	return {["message"]="Hello World"}
end

print("Test Module Loaded")
return test
`)
}

func writeFile(name, content string) {
	os.MkdirAll(filepath.Join(DATA_PATH, "modules"), os.ModePerm)
	ioutil.WriteFile(filepath.Join(DATA_PATH, "/modules/"+name), []byte(content), 0644)
}

func TestRuntimeSampleScript(t *testing.T) {
	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	l, _ := r.NewStateThread()
	defer l.Close()
	err = l.DoString(`
local example = "an example string"
for i in string.gmatch(example, "%S+") do
   print(i)
end`)

	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeDisallowStandardLibs(t *testing.T) {
	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	l, _ := r.NewStateThread()
	defer l.Close()
	err = l.DoString(`
-- Return true if file exists and is readable.
function file_exists(path)
  local file = io.open(path, "r")
  if file then file:close() end
  return file ~= nil
end
file_exists "./"`)

	if err == nil {
		t.Error(errors.New("Successfully accessed IO package"))
	}
}

// This test will always pass.
// Have a look at the stdout messages to see if the module was loaded multiple times
// You should only see "Test Module Loaded" once
func TestRuntimeRequireEval(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeTestModule()
	writeFile("test-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
test.printWorld()
`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRequireFile(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeStatsModule()
	writeFile("local_test.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)
`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRequirePreload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeStatsModule()
	writeFile("states-invoke.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))
`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeKeepChangesBetweenStates(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("var.lua", `
var={}
var.count = 1
return var
	`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	l, _ := r.NewStateThread()
	defer l.Close()

	err = l.DoString(`
local var = require("var")
var.count = 2`)

	if err != nil {
		t.Error(err)
	}

	err = l.DoString(`
local var = require("var")
assert(var.count == 2)`)

	if err != nil {
		t.Error(err)
	}

	l2, _ := r.NewStateThread()
	defer l2.Close()
	err = l2.DoString(`
local var = require("var")
assert(var.count == 2)`)

	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRegisterHTTP(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeTestModule()
	writeFile("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_http(test.printWorld, "/test/helloworld")
	`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	fn := r.GetRuntimeCallback(server.HTTP, "/test/helloworld")
	m, err := r.InvokeFunctionHTTP(fn, uuid.Nil, "", 0, nil)
	if err != nil {
		t.Error(err)
	}

	msg := m["message"]
	if msg != "Hello World" {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterHTTPNoResponse(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx)
	print("Hello World")
end

print("Test Module Loaded")
return test
	`)
	writeFile("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_http(test.printWorld, "/test/helloworld")
	`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	fn := r.GetRuntimeCallback(server.HTTP, "/test/helloworld")
	_, err = r.InvokeFunctionHTTP(fn, uuid.Nil, "", 0, nil)
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRegisterHTTPWithPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.execution_mode)
	return payload
end

print("Test Module Loaded")
return test
	`)
	writeFile("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_http(test.printWorld, "/test/helloworld")
	`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	fn := r.GetRuntimeCallback(server.HTTP, "/test/helloworld")
	payload := make(map[string]interface{})
	payload["message"] = "Hello World"

	m, err := r.InvokeFunctionHTTP(fn, uuid.Nil, "", 0, payload)
	if err != nil {
		t.Error(err)
	}

	msg := m["message"]
	if msg != "Hello World" {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterRPCWithPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.execution_mode)
	return payload
end

print("Test Module Loaded")
return test
	`)
	writeFile("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")
	`)

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	fn := r.GetRuntimeCallback(server.RPC, "helloworld")
	payload := []byte("Hello World")

	m, err := r.InvokeFunctionRPC(fn, uuid.Nil, "", 0, payload)
	if err != nil {
		t.Error(err)
	}

	if string(m) != "Hello World" {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterBeforeWithPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.execution_mode)
	return payload
end

print("Test Module Loaded")
return test
	`)
	writeFile("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_before(test.printWorld, "SelfFetch")
	`)

	jsonpbMarshaler := &jsonpb.Marshaler{
		EnumsAsInts:  true,
		EmitDefaults: false,
		Indent:       "",
		OrigName:     false,
	}
	jsonpbUnmarshaler := &jsonpb.Unmarshaler{
		AllowUnknownFields: false,
	}

	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}

	fn := r.GetRuntimeCallback(server.BEFORE, "SelfFetch")
	envelope := &server.Envelope{
		CollationId: "123",
		Payload: &server.Envelope_SelfFetch{
			SelfFetch: &server.TSelfFetch{},
		}}

	strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		t.Error(err)
	}

	var jsonEnvelope map[string]interface{}
	if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
		t.Error(err)
	}

	result, err := r.InvokeFunctionBefore(fn, uuid.Nil, "", 0, jsonEnvelope)
	if err != nil {
		t.Error(err)
	}

	bytesEnvelope, err := json.Marshal(result)
	if err != nil {
		t.Error(err)
	}

	resultEnvelope := &server.Envelope{}
	if err = jsonpbUnmarshaler.Unmarshal(bytes.NewReader(bytesEnvelope), resultEnvelope); err != nil {
		t.Error(err)
	}

	if !reflect.DeepEqual(envelope, resultEnvelope) {
		t.Error("Input Proto is not the same as Output proto.")
	}

}

func TestRuntimeUserId(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("userid.lua", `
local nk = require("nakama")

local user_ids = {
  "fd09791f-3297-40bd-b411-1afe316fd2e8",
  "fd8db1fc-6f79-4302-a54c-5960c99601a1"
}

local users = nk.user_fetch_id(user_ids)
	`)

	setupDB()
	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeLeaderboardCreate(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeFile("userid.lua", `
local nk = require("nakama")
local nkx = require("nakamax")

leaderboard_id = nkx.uuid_v4()
local metadata = {
  weather_conditions = "rain"
}

nk.leaderboard_create(leaderboard_id, "desc", "0 0 * * 1", metadata, false)
	`)

	setupDB()
	r, err := newRuntime()
	defer r.Stop()
	if err != nil {
		t.Error(err)
	}
}
