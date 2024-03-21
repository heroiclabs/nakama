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
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	STATS_MODULE_NAME = "stats"
	STATS_MODULE_DATA = `stats={}
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
return stats`
	TEST_MODULE_NAME = "test"
	TEST_MODULE_DATA = `test={}
-- Get the mean value of a table
function test.printWorld()
	print("Hello World")
	return {["message"]="Hello World"}
end
print("Test Module Loaded")
return test`
)

type testRuntimeData struct {
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
}

func runtimeWithModules(t *testing.T, modules map[string]string) (*Runtime, *RuntimeInfo, error) {
	rt, info, _, err := runtimeWithModulesWithData(t, modules)

	return rt, info, err
}

func runtimeWithModulesWithData(t *testing.T, modules map[string]string) (*Runtime, *RuntimeInfo, *testRuntimeData, error) {
	dir, err := os.MkdirTemp("", fmt.Sprintf("nakama_runtime_lua_test_%v", uuid.Must(uuid.NewV4()).String()))
	if err != nil {
		t.Fatalf("Failed initializing runtime modules tempdir: %s", err.Error())
	}
	defer os.RemoveAll(dir)

	for moduleName, moduleData := range modules {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%v.lua", moduleName)), []byte(moduleData), 0o644); err != nil {
			t.Fatalf("Failed initializing runtime modules tempfile: %s", err.Error())
		}
	}

	cfg := NewConfig(logger)
	cfg.Runtime.Path = dir

	ctx := context.Background()
	db := NewDB(t)
	lbCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	lbRankCache := NewLocalLeaderboardRankCache(
		ctx, logger, db, cfg.Leaderboard, lbCache)
	lbSched := NewLocalLeaderboardScheduler(logger, db, cfg, lbCache, lbRankCache)

	data := &testRuntimeData{
		leaderboardCache:     lbCache,
		leaderboardRankCache: lbRankCache,
	}

	sessionRegistry := NewLocalSessionRegistry(metrics)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	statusRegistry := NewLocalStatusRegistry(logger, cfg, sessionRegistry, protojsonMarshaler)

	rt, rtInfo, err := NewRuntime(ctx, logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, cfg, "", nil, lbCache, lbRankCache, lbSched, sessionRegistry, nil, statusRegistry, nil, tracker, metrics, nil, &DummyMessageRouter{}, storageIdx, nil)

	return rt, rtInfo, data, err
}

func TestRuntimeSampleScript(t *testing.T) {
	modules := map[string]string{
		"mod": `
local example = "an example string"
for i in string.gmatch(example, "%S+") do
   print(i)
end`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeDisallowStandardLibs(t *testing.T) {
	modules := map[string]string{
		"mod": `
-- Return true if file exists and is readable.
function file_exists(path)
  local file = io.open(path, "r")
  if file then file:close() end
  return file ~= nil
end
file_exists "./"`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err == nil {
		t.Fatal(errors.New("successfully accessed IO package"))
	}
}

// This test will always pass.
// Have a look at the stdout messages to see if the module was loaded multiple times
// You should only see "Test Module Loaded" once
func TestRuntimeRequireEval(t *testing.T) {
	modules := map[string]string{
		TEST_MODULE_NAME: TEST_MODULE_DATA,
		"test-invoke": `
local nakama = require("nakama")
local test = require("test")
test.printWorld()`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeRequireFile(t *testing.T) {
	modules := map[string]string{
		STATS_MODULE_NAME: STATS_MODULE_DATA,
		"local_test": `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeRequirePreload(t *testing.T) {
	modules := map[string]string{
		STATS_MODULE_NAME: STATS_MODULE_DATA,
		"states-invoke": `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeBit32(t *testing.T) {
	modules := map[string]string{
		"bit32-tests": `
--[[
Original under MIT license at https://github.com/Shopify/lua-tests/blob/master/bitwise.lua
--]]

print("testing bitwise operations")

assert(bit32.band() == bit32.bnot(0))
assert(bit32.btest() == true)
assert(bit32.bor() == 0)
assert(bit32.bxor() == 0)

assert(bit32.band() == bit32.band(0xffffffff))
assert(bit32.band(1,2) == 0)


-- out-of-range numbers
assert(bit32.band(-1) == 0xffffffff)
assert(bit32.band(2^33 - 1) == 0xffffffff)
assert(bit32.band(-2^33 - 1) == 0xffffffff)
assert(bit32.band(2^33 + 1) == 1)
assert(bit32.band(-2^33 + 1) == 1)
assert(bit32.band(-2^40) == 0)
assert(bit32.band(2^40) == 0)
assert(bit32.band(-2^40 - 2) == 0xfffffffe)
assert(bit32.band(2^40 - 4) == 0xfffffffc)

assert(bit32.lrotate(0, -1) == 0)
assert(bit32.lrotate(0, 7) == 0)
assert(bit32.lrotate(0x12345678, 4) == 0x23456781)
assert(bit32.rrotate(0x12345678, -4) == 0x23456781)
assert(bit32.lrotate(0x12345678, -8) == 0x78123456)
assert(bit32.rrotate(0x12345678, 8) == 0x78123456)
assert(bit32.lrotate(0xaaaaaaaa, 2) == 0xaaaaaaaa)
assert(bit32.lrotate(0xaaaaaaaa, -2) == 0xaaaaaaaa)
for i = -50, 50 do
  assert(bit32.lrotate(0x89abcdef, i) == bit32.lrotate(0x89abcdef, i%32))
end

assert(bit32.lshift(0x12345678, 4) == 0x23456780)
assert(bit32.lshift(0x12345678, 8) == 0x34567800)
assert(bit32.lshift(0x12345678, -4) == 0x01234567)
assert(bit32.lshift(0x12345678, -8) == 0x00123456)
assert(bit32.lshift(0x12345678, 32) == 0)
assert(bit32.lshift(0x12345678, -32) == 0)
assert(bit32.rshift(0x12345678, 4) == 0x01234567)
assert(bit32.rshift(0x12345678, 8) == 0x00123456)
assert(bit32.rshift(0x12345678, 32) == 0)
assert(bit32.rshift(0x12345678, -32) == 0)
assert(bit32.arshift(0x12345678, 0) == 0x12345678)
assert(bit32.arshift(0x12345678, 1) == 0x12345678 / 2)
assert(bit32.arshift(0x12345678, -1) == 0x12345678 * 2)
assert(bit32.arshift(-1, 1) == 0xffffffff)
assert(bit32.arshift(-1, 24) == 0xffffffff)
assert(bit32.arshift(-1, 32) == 0xffffffff)
assert(bit32.arshift(-1, -1) == (-1 * 2) % 2^32)

print("+")
-- some special cases
local c = {0, 1, 2, 3, 10, 0x80000000, 0xaaaaaaaa, 0x55555555,
           0xffffffff, 0x7fffffff}

for _, b in pairs(c) do
  assert(bit32.band(b) == b)
  assert(bit32.band(b, b) == b)
  assert(bit32.btest(b, b) == (b ~= 0))
  assert(bit32.band(b, b, b) == b)
  assert(bit32.btest(b, b, b) == (b ~= 0))
  assert(bit32.band(b, bit32.bnot(b)) == 0)
  assert(bit32.bor(b, bit32.bnot(b)) == bit32.bnot(0))
  assert(bit32.bor(b) == b)
  assert(bit32.bor(b, b) == b)
  assert(bit32.bor(b, b, b) == b)
  assert(bit32.bxor(b) == b)
  assert(bit32.bxor(b, b) == 0)
  assert(bit32.bxor(b, 0) == b)
  assert(bit32.bnot(b) ~= b)
  assert(bit32.bnot(bit32.bnot(b)) == b)
  assert(bit32.bnot(b) == 2^32 - 1 - b)
  assert(bit32.lrotate(b, 32) == b)
  assert(bit32.rrotate(b, 32) == b)
  assert(bit32.lshift(bit32.lshift(b, -4), 4) == bit32.band(b, bit32.bnot(0xf)))
  assert(bit32.rshift(bit32.rshift(b, 4), -4) == bit32.band(b, bit32.bnot(0xf)))
  for i = -40, 40 do
    assert(bit32.lshift(b, i) == math.floor((b * 2^i) % 2^32))
  end
end

assert(not pcall(bit32.band, {}))
assert(not pcall(bit32.bnot, "a"))
assert(not pcall(bit32.lshift, 45))
assert(not pcall(bit32.lshift, 45, print))
assert(not pcall(bit32.rshift, 45, print))

print("+")


-- testing extract/replace

assert(bit32.extract(0x12345678, 0, 4) == 8)
assert(bit32.extract(0x12345678, 4, 4) == 7)
assert(bit32.extract(0xa0001111, 28, 4) == 0xa)
assert(bit32.extract(0xa0001111, 31, 1) == 1)
assert(bit32.extract(0x50000111, 31, 1) == 0)
assert(bit32.extract(0xf2345679, 0, 32) == 0xf2345679)

assert(not pcall(bit32.extract, 0, -1))
assert(not pcall(bit32.extract, 0, 32))
assert(not pcall(bit32.extract, 0, 0, 33))
assert(not pcall(bit32.extract, 0, 31, 2))

assert(bit32.replace(0x12345678, 5, 28, 4) == 0x52345678)
assert(bit32.replace(0x12345678, 0x87654321, 0, 32) == 0x87654321)
assert(bit32.replace(0, 1, 2) == 2^2)
assert(bit32.replace(0, -1, 4) == 2^4)
assert(bit32.replace(-1, 0, 31) == 2^31 - 1)
assert(bit32.replace(-1, 0, 1, 2) == 2^32 - 7)


print'OK'`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeRegisterRPCWithPayload(t *testing.T) {
	modules := map[string]string{
		"test": `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.ExecutionMode)
	return payload
end
print("Test Module Loaded")
return test`,
		"http-invoke": `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("helloworld")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "Hello World"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err.Error())
	}

	if result != payload {
		t.Fatal("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterRPCWithPayloadEndToEnd(t *testing.T) {
	modules := map[string]string{
		"test": `
test={}
-- Get the mean value of a table
function test.printWorld(ctx, payload)
	print("Hello World")
	print(ctx.ExecutionMode)
	return payload
end
print("Test Module Loaded")
return test`,
		"http-invoke": `
local nakama = require("nakama")
local test = require("test")
nakama.register_rpc(test.printWorld, "helloworld")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	db := NewDB(t)
	pipeline := NewPipeline(logger, cfg, db, protojsonMarshaler, protojsonUnmarshaler, nil, nil, nil, nil, nil, nil, nil, runtime)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, cfg, "", nil, storageIdx, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, metrics, pipeline, runtime)
	defer apiServer.Stop()

	WaitForSocket(nil, cfg)

	payload := "\"Hello World\""
	client := &http.Client{}
	request, _ := http.NewRequest("POST", "http://localhost:7350/v2/rpc/helloworld?http_key=defaulthttpkey", strings.NewReader(payload))
	request.Header.Add("Content-Type", "Application/JSON")
	res, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}

	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}

	if string(b) != "{\"payload\":"+payload+"}" {
		t.Fatal("Invocation failed. Return result not expected: ", string(b))
	}
}

func TestRuntimeHTTPRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
	}))

	defer srv.Close()

	modules := map[string]string{
		"test": fmt.Sprintf(`
local nakama = require("nakama")
function test(ctx, payload)
	local success, code, headers, body = pcall(nakama.http_request, "%s", "GET", {})
	return tostring(code)
end
nakama.register_rpc(test, "test")`, srv.URL),
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	if result != "200" {
		t.Fatal("Invocation failed. Return result not expected", result)
	}
}

func TestRuntimeJson(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.json_encode(nakama.json_decode(payload))
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "{\"key\":\"value\"}"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err)
	}

	if result != payload {
		t.Fatal("Invocation failed. Return result not expected", result)
	}
}

func TestRuntimeBase64(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base64_decode(nakama.base64_encode(payload))
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "{\"key\":\"value\"}"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err)
	}

	if result != payload {
		t.Fatal("Invocation failed. Return result not expected", result)
	}
}

func TestRuntimeBase16(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.base16_decode(nakama.base16_encode(payload))
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "{\"key\":\"value\"}"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err)
	}

	if result != payload {
		t.Fatal("Invocation failed. Return result not expected", result)
	}
}

func TestRuntimeAes128(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.aes128_decrypt(nakama.aes128_encrypt(payload, "goldenbridge_key"), "goldenbridge_key")
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "{\"key\":\"value\"}"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err)
	}

	if strings.TrimSpace(result) != payload {
		t.Fatal("Invocation failed. Return result not expected", result)
	}
}

func TestRuntimeMD5Hash(t *testing.T) {
	modules := map[string]string{
		"md5hash-test": `
local nk = require("nakama")
assert(nk.md5_hash("test") == "098f6bcd4621d373cade4e832627b4f6")`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeSHA256Hash(t *testing.T) {
	modules := map[string]string{
		"sha256hash-test": `
local nk = require("nakama")
assert(nk.sha256_hash("test") == "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeBcryptHash(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return nakama.bcrypt_hash(payload)
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "{\"key\":\"value\"}"
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", payload)
	if err != nil {
		t.Fatal(err)
	}

	err = bcrypt.CompareHashAndPassword([]byte(result), []byte(payload))
	if err != nil {
		t.Fatal("Return result not expected", result, err)
	}
}

func TestRuntimeBcryptCompare(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function test(ctx, payload)
	return tostring(nakama.bcrypt_compare(payload, "something_to_encrypt"))
end
nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	payload := "something_to_encrypt"
	hash, _ := bcrypt.GenerateFromPassword([]byte(payload), bcrypt.DefaultCost)
	result, err, _ := fn(context.Background(), nil, nil, "", "", nil, 0, "", "", "", "", string(hash))
	if err != nil {
		t.Fatal(err)
	}

	if result != "true" {
		t.Error("Return result not expected", result)
	}
}

func TestRuntimeNotificationsSend(t *testing.T) {
	modules := map[string]string{
		"test": `
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
nk.notifications_send(new_notifications)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeNotificationSend(t *testing.T) {
	modules := map[string]string{
		"test": `
local nk = require("nakama")

local subject = "You've unlocked level 100!"
local content = {
 reward_coins = 1000
}
local user_id = "4c2ae592-b2a7-445e-98ec-697694478b1c" -- who to send
local code = 1

nk.notification_send(user_id, subject, content, code, "", false)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeNotificationsDelete(t *testing.T) {
	modules := map[string]string{
		"test": `
local nk = require("nakama")

local user_id = "4c2ae592-b2a7-445e-98ec-697694478b1c"
local notification_id = "3707b43c-60f0-4ba7-a94b-e21a028aeffb"

local notifications = {
  { user_id = user_id, notification_id = notification_id }
}
nk.notifications_delete(notifications)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeWalletWrite(t *testing.T) {
	db := NewDB(t)
	uid := uuid.FromStringOrNil("95f05d94-cc66-445a-b4d1-9e262662cf79")
	InsertUser(t, db, uid)

	modules := map[string]string{
		"test": `
local nk = require("nakama")

local content = {
  reward_coins = 1000
}
local user_id = "95f05d94-cc66-445a-b4d1-9e262662cf79" -- who to send

nk.wallet_update(user_id, content)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeStorageWrite(t *testing.T) {
	modules := map[string]string{
		"test": `
local nk = require("nakama")

local new_objects = {
	{collection = "settings", key = "a", user_id = nil, value = {}},
	{collection = "settings", key = "b", user_id = nil, value = {}},
	{collection = "settings", key = "c", user_id = nil, value = {}}
}

nk.storage_write(new_objects)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeStorageRead(t *testing.T) {
	modules := map[string]string{
		"test": `
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
end`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}

func TestRuntimeReqBeforeHook(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function before_storage_write(ctx, payload)
	return payload
end
nakama.register_req_before(before_storage_write, "WriteStorageObjects")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	apiserver, _ := NewAPIServer(t, runtime)
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
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function before_storage_write(ctx, payload)
	return nil
end
nakama.register_req_before(before_storage_write, "WriteStorageObjects")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	apiserver, _ := NewAPIServer(t, runtime)
	defer apiserver.Stop()
	conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	_, err = client.WriteStorageObjects(ctx, &api.WriteStorageObjectsRequest{
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
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function after_storage_write(ctx, payload)
	nakama.wallet_update(ctx.user_id, {gem = 10})
	return payload
end
nakama.register_req_after(after_storage_write, "WriteStorageObjects")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	apiserver, _ := NewAPIServer(t, runtime)
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
		t.Fatal("Invocation failed. Return result not expected: ", len(acks.Acks))
	}

	account, err := client.GetAccount(ctx, &emptypb.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{"gem": 10}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}

func TestRuntimeRTBeforeHook(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function before_match_create(ctx, payload)
	nakama.wallet_update(ctx.user_id, {gem = 20})
	return payload
end
nakama.register_rt_before(before_match_create, "MatchCreate")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	apiserver, pipeline := NewAPIServer(t, runtime)
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

	account, err := client.GetAccount(ctx, &emptypb.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{"gem": 20}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}

func TestRuntimeRTBeforeHookDisallow(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")
function before_match_create(ctx, payload)
	return nil
end
nakama.register_rt_before(before_match_create, "MatchCreate")

function after_match_create(ctx, payload)
	nakama.wallet_update(ctx.user_id, {gem = 30})
	return payload
end
nakama.register_rt_after(after_match_create, "MatchCreate")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}

	apiserver, pipeline := NewAPIServer(t, runtime)
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

	account, err := client.GetAccount(ctx, &emptypb.Empty{})
	if err != nil {
		t.Fatal(err)
	}

	if account.Wallet != `{}` {
		t.Fatalf("Unexpected wallet value: %s", account.Wallet)
	}
}

func TestRuntimeGroupTests(t *testing.T) {
	modules := map[string]string{
		"test": `
local nk = require("nakama")

local user_id = nk.uuid_v4()
local group_name = nk.uuid_v4()
local group_update_name = nk.uuid_v4()

local group = nk.group_create(user_id, group_name)
assert(not (group.id == nil or group.id == ''), "'group.id' must not be nil")
assert((group.name == group_name), "'group.name' must be set")

nk.group_update(group.id, user_id, group_update_name)

local users = nk.group_users_list(group.id)
for i, u in ipairs(users)
do
  assert(u.user.id == user_id, "'u.id' must be equal to user_id")
	assert(u.state == 0, "'u.state' must be equal to 0 / superadmin")
end

local groups = nk.user_groups_list(user_id)
for i, g in ipairs(groups)
do
	print(nk.json_encode(g))
  assert(g.group.name == group_update_name, "'g.name' must be equal to group_update_name")
	assert(g.state == 0, "'g.state' must be equal to 0 / superadmin")
end

nk.group_delete(group.id)`,
	}

	_, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
}
