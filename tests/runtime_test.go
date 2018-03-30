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
	"errors"
	"io/ioutil"
	"net/http"
	"strings"
	"testing"

	"fmt"
	"sync"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/server"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"golang.org/x/crypto/bcrypt"
)

func vm(t *testing.T, modules *sync.Map) *server.RuntimePool {
	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   server.OpenPackage(modules),
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     server.OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
	}

	db := NewDB(t)
	once := &sync.Once{}
	router := &DummyMessageRouter{}
	regCallbacks, err := server.ValidateRuntimeModules(logger, logger, db, config, nil, nil, nil, nil, router, stdLibs, modules, once)
	if err != nil {
		t.Fatalf("Failed initializing runtime modules: %s", err.Error())
	}

	return server.NewRuntimePool(logger, logger, db, config, nil, nil, nil, nil, router, stdLibs, modules, regCallbacks, once)
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
	rp := vm(t, new(sync.Map))
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
	rp := vm(t, new(sync.Map))
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

	vm(t, modules)
}

func TestRuntimeRequireFile(t *testing.T) {
	modules := new(sync.Map)
	writeStatsModule(modules)
	writeLuaModule(modules, "local_test", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)
`)

	vm(t, modules)
}

func TestRuntimeRequirePreload(t *testing.T) {
	modules := new(sync.Map)
	writeStatsModule(modules)
	writeLuaModule(modules, "states-invoke", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))
`)

	vm(t, modules)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	fn := r.GetCallback(server.RPC, "helloworld")
	payload := "Hello World"

	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
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

	rp := vm(t, modules)

	db := NewDB(t)
	pipeline := server.NewPipeline(config, db, jsonpbMarshaler, jsonpbUnmarshaler, nil, nil, nil, nil, rp)
	apiServer := server.StartApiServer(logger, logger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, nil, nil, nil, nil, nil, pipeline, rp)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", "")
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	if strings.TrimSpace(m.(string)) != payload {
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "{\"key\":\"value\"}"
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", payload)
	if err != nil {
		t.Error(err)
	}

	err = bcrypt.CompareHashAndPassword([]byte(m.(string)), []byte(payload))
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()

	payload := "something_to_encrypt"
	hash, _ := bcrypt.GenerateFromPassword([]byte(payload), bcrypt.DefaultCost)
	fn := r.GetCallback(server.RPC, "test")
	m, err, _ := r.InvokeFunction(server.RPC, fn, "", "", 0, "", string(hash))
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

	rp := vm(t, modules)
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

	rp := vm(t, modules)
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

	rp := vm(t, modules)
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

	rp := vm(t, modules)
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

	rp := vm(t, modules)
	r := rp.Get()
	defer r.Stop()
}

func TestRuntimeReqBeforeHook(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function before_storage_write(ctx, payload)
	return payload
end
nakama.register_req_before(before_storage_write, "WriteStorageObjects")
	`)

	rp := vm(t, modules)

	apiserver, _ := NewAPIServer(t, rp)
	defer apiserver.Stop()
	conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	acks, err := client.WriteStorageObjects(ctx, &api.WriteStorageObjectsRequest{
		Objects: []*api.WriteStorageObject{{
			Collection: "collection",
			Key:        "key",
			Value: `
{
	"key": "value"
}`,
		}},
	})

	if err != nil {
		t.Fatal(err)
	}

	if len(acks.Acks) != 1 {
		t.Error("Invocation failed. Return result not expected: ", len(acks.Acks))
	}
}

func TestRuntimeReqBeforeHookDisallowed(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function before_storage_write(ctx, payload)
	return nil
end
nakama.register_req_before(before_storage_write, "WriteStorageObjects")
	`)

	rp := vm(t, modules)

	apiserver, _ := NewAPIServer(t, rp)
	defer apiserver.Stop()
	conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	_, err := client.WriteStorageObjects(ctx, &api.WriteStorageObjectsRequest{
		Objects: []*api.WriteStorageObject{{
			Collection: "collection",
			Key:        "key",
			Value: `
{
	"key": "value"
}`,
		}},
	})

	if err == nil {
		t.Fatal("Request should have been disallowed.")
	}
}

func TestRuntimeReqAfterHook(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function after_storage_write(ctx, payload)
	nakama.wallet_write(ctx.user_id, {gem = 10})
	return payload
end
nakama.register_req_after(after_storage_write, "WriteStorageObjects")
	`)

	rp := vm(t, modules)

	apiserver, _ := NewAPIServer(t, rp)
	defer apiserver.Stop()
	conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	acks, err := client.WriteStorageObjects(ctx, &api.WriteStorageObjectsRequest{
		Objects: []*api.WriteStorageObject{{
			Collection: "collection",
			Key:        "key",
			Value: `
{
	"key": "value"
}`,
		}},
	})

	if err != nil {
		t.Fatal(err)
	}

	if len(acks.Acks) != 1 {
		t.Error("Invocation failed. Return result not expected: ", len(acks.Acks))
	}

	account, err := client.GetAccount(ctx, &empty.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{"gem": 10}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}

func TestRuntimeRTBeforeHook(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function before_match_create(ctx, payload)
	nakama.wallet_write(ctx.user_id, {gem = 20})
	return payload
end
nakama.register_rt_before(before_match_create, "MatchCreate")
	`)

	rp := vm(t, modules)

	apiserver, pipeline := NewAPIServer(t, rp)
	defer apiserver.Stop()
	conn, client, s, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	userID, err := UserIDFromSession(s)
	if err != nil {
		t.Fatal(err)
	}

	session := &DummySession{
		uid:      userID,
		messages: make([]*rtapi.Envelope, 0),
	}

	envelope := &rtapi.Envelope{
		Message: &rtapi.Envelope_MatchCreate{
			MatchCreate: &rtapi.MatchCreate{},
		},
	}

	pipeline.ProcessRequest(logger, session, envelope)

	account, err := client.GetAccount(ctx, &empty.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{"gem": 20}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}

func TestRuntimeRTBeforeHookDisallow(t *testing.T) {
	modules := new(sync.Map)
	writeLuaModule(modules, "test", `
local nakama = require("nakama")
function before_match_create(ctx, payload)
	return nil
end
nakama.register_rt_before(before_match_create, "MatchCreate")

function after_match_create(ctx, payload)
	nakama.wallet_write(ctx.user_id, {gem = 30})
	return payload
end
nakama.register_rt_after(after_match_create, "MatchCreate")
	`)

	rp := vm(t, modules)

	apiserver, pipeline := NewAPIServer(t, rp)
	defer apiserver.Stop()
	conn, client, s, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	userID, err := UserIDFromSession(s)
	if err != nil {
		t.Fatal(err)
	}

	session := &DummySession{
		uid:      userID,
		messages: make([]*rtapi.Envelope, 0),
	}

	envelope := &rtapi.Envelope{
		Message: &rtapi.Envelope_MatchCreate{
			MatchCreate: &rtapi.MatchCreate{},
		},
	}

	pipeline.ProcessRequest(logger, session, envelope)

	account, err := client.GetAccount(ctx, &empty.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}
