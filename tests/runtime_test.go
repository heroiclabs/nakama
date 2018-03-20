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

package tests

import (
	"database/sql"
	"errors"
	"io/ioutil"
	"net/http"
	"os"
	"strings"
	"testing"

	"fmt"
	"sync"

	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/server"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type DummyMessageRouter struct{}

func (d *DummyMessageRouter) SendToPresenceIDs(*zap.Logger, []*server.PresenceID, *rtapi.Envelope) {}
func (d *DummyMessageRouter) SendToStream(*zap.Logger, server.PresenceStream, *rtapi.Envelope)     {}

var (
	config = server.NewConfig()
	logger = server.NewConsoleLogger(os.Stdout, true)
)

func db(t *testing.T) *sql.DB {
	db, err := sql.Open("postgres", "postgresql://root@127.0.0.1:26257/nakama?sslmode=disable")
	if err != nil {
		t.Fatal("Error connecting to database", err)
	}
	err = db.Ping()
	if err != nil {
		t.Fatal("Error pinging database", err)
	}
	return db
}

func vm(t *testing.T, modules *sync.Map, regRPC map[string]struct{}) *server.RuntimePool {
	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   server.OpenPackage(modules),
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     server.OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
	}

	return server.NewRuntimePool(logger, logger, db(t), config, nil, nil, nil, nil, &DummyMessageRouter{}, stdLibs, modules, regRPC, &sync.Once{})
}

func writeLuaModule(modules *sync.Map, name, content string) {
	modules.Store(name, &server.RuntimeModule{
		Name:    name,
		Path:    fmt.Sprintf("%v.lua", name),
		Content: []byte(content),
	})
}

func writeStatsModule(modules *sync.Map) {
	writeLuaModule(modules, "stats", `
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

func writeTestModule(modules *sync.Map) {
	writeLuaModule(modules, "test", `
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
	rp := vm(t, new(sync.Map), make(map[string]struct{}, 0))
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
	rp := vm(t, new(sync.Map), make(map[string]struct{}, 0))
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
	modules := new(sync.Map)
	writeTestModule(modules)
	writeLuaModule(modules, "test-invoke", `
local nakama = require("nakama")
local test = require("test")
test.printWorld()
`)

	vm(t, modules, make(map[string]struct{}, 0))
}

func TestRuntimeRequireFile(t *testing.T) {
	modules := new(sync.Map)
	writeStatsModule(modules)
	writeLuaModule(modules, "local_test", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)
`)

	vm(t, modules, make(map[string]struct{}, 0))
}

func TestRuntimeRequirePreload(t *testing.T) {
	modules := new(sync.Map)
	writeStatsModule(modules)
	writeLuaModule(modules, "states-invoke", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))
`)

	vm(t, modules, make(map[string]struct{}, 0))
}

func TestRuntimeRegisterRPCWithPayload(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
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
	writeLuaModule(modules, "http-invoke", `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")
	`)

	rp := vm(t, modules, map[string]struct{}{"helloworld": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.RPC, "helloworld")
	payload := "Hello World"

	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterRPCWithPayloadEndToEnd(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
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
	writeLuaModule(modules, "http-invoke", `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")
	`)

	rp := vm(t, modules, map[string]struct{}{"helloworld": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	pipeline := server.NewPipeline(config, nil, nil, nil, nil, nil, rp)
	apiServer := server.StartApiServer(logger, logger, nil, nil, nil, config, nil, nil, nil, nil, nil, pipeline, rp)
	defer apiServer.Stop()

	payload := "\"Hello World\""
	client := &http.Client{}
	request, _ := http.NewRequest("POST", "http://localhost:7349/v2/rpc/helloworld?http_key=defaultkey", strings.NewReader(payload))
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
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	local success, code, headers, body = pcall(nakama.http_request, "http://httpbin.org/status/200", "GET", {})
	return tostring(code)
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", "")
	if err != nil {
		t.Error(err)
	}

	if m != "200" {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeJson(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.json_encode(nakama.json_decode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBase64(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base64_decode(nakama.base64_encode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBase16(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base16_decode(nakama.base16_encode(payload))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if m != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeAes128(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.aes128_decrypt(nakama.aes128_encrypt(payload, "goldenbridge_key"), "goldenbridge_key")
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if strings.TrimSpace(m) != payload {
		t.Error("Invocation failed. Return result not expected", m)
	}
}

func TestRuntimeBcryptHash(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.bcrypt_hash(payload)
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	err = bcrypt.CompareHashAndPassword([]byte(m), []byte(payload))
	if err != nil {
		t.Error("Return result not expected", m, err)
	}
}

func TestRuntimeBcryptCompare(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function test(ctx, payload)
	return tostring(nakama.bcrypt_compare(payload, "something_to_encrypt"))
end
nakama.register_rpc(test, "test")
	`)

	rp := vm(t, modules, map[string]struct{}{"test": struct{}{}})
	r := rp.Get()
	defer r.Stop()

	payload := "something_to_encrypt"
	hash, _ := bcrypt.GenerateFromPassword([]byte(payload), bcrypt.DefaultCost)
	fn := r.GetRuntimeCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunctionRPC(fn, "", "", 0, "", string(hash))
	if err != nil {
		t.Error(err)
	}

	if m != "true" {
		t.Error("Return result not expected", m)
	}
}

func TestRuntimeNotificationsSend(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nk = require("nakama")

local subject = "You've unlocked level 100!"
local content = {
  reward_coins = 1000
}
local user_id = "4c2ae592-b2a7-445e-98ec-697694478b1c" -- who to send
local code = 1

local new_notifications = {
  { subject = subject, content = content, user_id = user_id, code = code, persistent = false}
}
nk.notifications_send(new_notifications)
`)

	rp := vm(t, modules, make(map[string]struct{}, 0))
	r := rp.Get()
	defer r.Stop()
}

func TestRuntimeNotificationSend(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nk = require("nakama")

local subject = "You've unlocked level 100!"
local content = {
  reward_coins = 1000
}
local user_id = "4c2ae592-b2a7-445e-98ec-697694478b1c" -- who to send
local code = 1

nk.notification_send(user_id, subject, content, code, "", false)
`)

	rp := vm(t, modules, make(map[string]struct{}, 0))
	r := rp.Get()
	defer r.Stop()
}

func TestRuntimeWalletWrite(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nk = require("nakama")

local content = {
  reward_coins = 1000
}
local user_id = "95f05d94-cc66-445a-b4d1-9e262662cf79" -- who to send

nk.wallet_write(user_id, content)
`)

	rp := vm(t, modules, make(map[string]struct{}, 0))
	r := rp.Get()
	defer r.Stop()
}

func TestRuntimeStorageWrite(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test.lua", `
local nk = require("nakama")

local new_objects = {
	{collection = "settings", key = "a", user_id = nil, value = {}},
	{collection = "settings", key = "b", user_id = nil, value = {}},
	{collection = "settings", key = "c", user_id = nil, value = {}}
}

nk.storage_write(new_objects)
`)

	rp := vm(t, modules, make(map[string]struct{}, 0))
	r := rp.Get()
	defer r.Stop()
}

func TestRuntimeStorageRead(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test.lua", `
local nk = require("nakama")
local object_ids = {
  {collection = "settings", key = "a", user_id = nil},
  {collection = "settings", key = "b", user_id = nil},
  {collection = "settings", key = "c", user_id = nil}
}
local objects = nk.storage_read(object_ids)
for i, r in ipairs(objects)
do
  assert(#r.value == 0, "'r.value' must be '{}'")
end
`)

	rp := vm(t, modules, make(map[string]struct{}, 0))
	r := rp.Get()
	defer r.Stop()
}
