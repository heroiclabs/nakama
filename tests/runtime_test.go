package tests

import (
	"errors"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/heroiclabs/nakama/server"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

var (
	tempDir, _ = ioutil.TempDir("", "nakama")
	luaPath    = filepath.Join(tempDir, "modules")
	config     = server.NewConfig()
	logger     = server.NewConsoleLogger(os.Stdout, true)
)

func vm(t *testing.T) *server.RuntimePool {
	config.Runtime.Path = luaPath
	runtimePool, err := server.NewRuntimePool(logger, logger, nil, config, nil, nil, nil)
	if err != nil {
		t.Error("Failed initializing runtime modules", zap.Error(err))
	}

	return runtimePool
}

func writeLuaModule(name, content string) {
	os.MkdirAll(luaPath, os.ModePerm)
	ioutil.WriteFile(filepath.Join(luaPath, name), []byte(content), 0644)
}

func writeStatsModule() {
	writeLuaModule("stats.lua", `
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
	writeLuaModule("test.lua", `
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

func TestRuntimeSampleScript(t *testing.T) {
	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	l, _ := r.NewStateThread()
	defer l.Close()
	err := l.DoString(`
local example = "an example string"
for i in string.gmatch(example, "%S+") do
   print(i)
end`)

	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeDisallowStandardLibs(t *testing.T) {
	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	l, _ := r.NewStateThread()
	defer l.Close()
	err := l.DoString(`
-- Return true if file exists and is readable.
function file_exists(path)
  local file = io.open(path, "r")
  if file then file:close() end
  return file ~= nil
end
file_exists "./"`)

	if err == nil {
		t.Error(errors.New("successfully accessed IO package"))
	}
}

// This test will always pass.
// Have a look at the stdout messages to see if the module was loaded multiple times
// You should only see "Test Module Loaded" once
func TestRuntimeRequireEval(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeTestModule()
	writeLuaModule("test-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
test.printWorld()
`)

	vm(t)
}

func TestRuntimeRequireFile(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeStatsModule()
	writeLuaModule("local_test.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)
`)

	vm(t)
}

func TestRuntimeRequirePreload(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeStatsModule()
	writeLuaModule("states-invoke.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))
`)

	vm(t)
}

func TestRuntimeRegisterRPCWithPayload(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.ExecutionMode)
	return payload
end
print("Test Module Loaded")
return test
	`)
	writeLuaModule("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.RPC, "helloworld")
	payload := "Hello World"

	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterRPCWithPayloadEndToEnd(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.ExecutionMode)
	return payload
end
print("Test Module Loaded")
return test
	`)
	writeLuaModule("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	pipeline := server.NewPipeline(config, nil, nil, nil, nil, rp)
	apiServer := server.StartApiServer(logger, nil, nil, nil, config, nil, nil, pipeline, rp)
	defer apiServer.Stop()

	payload := "\"Hello World\""
	client := &http.Client{}
	request, _ := http.NewRequest("POST", "http://localhost:7351/v2/rpc/helloworld?http_key=defaultkey", strings.NewReader(payload))
	request.Header.Add("Content-Type", "Application/JSON")
	res, err := client.Do(request)
	if err != nil {
		t.Error(err)
	}

	b, err := ioutil.ReadAll(res.Body)
	if err != nil {
		t.Error(err)
		return
	}

	if string(b) != "{\"payload\":"+payload+"}" {
		t.Error("Invocation failed. Return result not expected: ", string(b))
	}
}

func TestRuntimeHTTPRequest(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	local success, code, headers, body = pcall(nakama.http_request, "http://httpbin.org/status/200", "GET", {})
	return tostring(code)
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", "")
	if err != nil {
		t.Error(err)
	}

	if m != "200" {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeJson(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.json_encode(nakama.json_decode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBase64(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base64_decode(nakama.base64_encode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBase16(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base16_decode(nakama.base16_encode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeAes128(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.aes128_decrypt(nakama.aes128_encrypt(payload, "goldenbridge_key"), "goldenbridge_key")
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if strings.TrimSpace(m) != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBcryptHash(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.bcrypt_hash(payload)
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	err = bcrypt.CompareHashAndPassword([]byte(m), []byte(payload))
	if err != nil {
		t.Error("Return result not expected", m, err)
	}
}

func TestRuntimeBcryptCompare(t *testing.T) {
	defer os.RemoveAll(luaPath)
	writeLuaModule("test.lua", `
local nakama = require("nakama")
function test(ctx, payload)
	return tostring(nakama.bcrypt_compare(payload, "something_to_encrypt"))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t)
	r := rp.Get()
	defer r.Stop()

	payload := "something_to_encrypt"
	hash, _ := bcrypt.GenerateFromPassword([]byte(payload), bcrypt.DefaultCost)
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err := r.InvokeFunctionRPC(fn, "", "", 0, "", string(hash))
	if err != nil {
		t.Error(err)
	}

	if m != "true" {
		t.Error("Return result not expected", m)
	}
}
