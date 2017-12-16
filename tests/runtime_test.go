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
	"os"
	"path/filepath"
	"testing"

	"nakama/server"

	"reflect"

	"github.com/gogo/protobuf/jsonpb"
	"github.com/satori/go.uuid"
)

const DATA_PATH = "/tmp/nakama/data/"

func newRuntimePool() (*server.RuntimePool, error) {
	db, err := setupDB()
	if err != nil {
		return nil, err
	}
	c := server.NewRuntimeConfig()
	c.Path = filepath.Join(DATA_PATH, "modules")
	return server.NewRuntimePool(logger, logger, db, c, nil, nil)
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

func writeLuaModule(name, content string) {
	os.MkdirAll(filepath.Join(DATA_PATH, "modules"), os.ModePerm)
	ioutil.WriteFile(filepath.Join(DATA_PATH, "/modules/"+name), []byte(content), 0644)
}

func TestRuntimeSampleScript(t *testing.T) {
	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

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
	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

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
	writeLuaModule("test-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
test.printWorld()
`)

	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRequireFile(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeStatsModule()
	writeLuaModule("local_test.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
assert(stats.mean(t) > 0)
`)

	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRequirePreload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeStatsModule()
	writeLuaModule("states-invoke.lua", `
local stats = require("stats")
t = {[1]=5, [2]=7, [3]=8, [4]='Something else.'}
print(stats.mean(t))
`)

	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeKeepChangesBetweenStates(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("var.lua", `
var={}
var.count = 1
return var
	`)

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

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
	writeLuaModule("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_http(test.printWorld, "test/helloworld")
	`)

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.HTTP, "test/helloworld")
	m, err := r.InvokeFunctionHTTP(fn, "", "", 0, nil)
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
	writeLuaModule("test.lua", `
test={}
-- Get the mean value of a table
function test.printWorld(ctx)
	print("Hello World")
end

print("Test Module Loaded")
return test
	`)
	writeLuaModule("http-invoke.lua", `
local nakama = require("nakama")
local test = require("test")
nakama.register_http(test.printWorld, "test/helloworld")
	`)

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.HTTP, "test/helloworld")
	_, err = r.InvokeFunctionHTTP(fn, "", "", 0, nil)
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeRegisterHTTPWithPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
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
nakama.register_http(test.printWorld, "test/helloworld")
	`)

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.HTTP, "test/helloworld")
	payload := make(map[string]interface{})
	payload["message"] = "Hello World"

	m, err := r.InvokeFunctionHTTP(fn, "", "", 0, payload)
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

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.RPC, "helloworld")
	payload := "Hello World"

	m, err := r.InvokeFunctionRPC(fn, "", "", 0, payload)
	if err != nil {
		t.Error(err)
	}

	if string(m) != "Hello World" {
		t.Error("Invocation failed. Return result not expected")
	}
}

func TestRuntimeRegisterBeforeWithPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
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
nakama.register_before(test.printWorld, "tselffetch")
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

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	fn := r.GetRuntimeCallback(server.BEFORE, "tselffetch")
	envelope := &server.Envelope{
		CollationId: "123",
		Payload: &server.Envelope_SelfFetch{
			SelfFetch: &server.TSelfFetch{},
		}}

	result, err := r.InvokeFunctionBefore(fn, "", "", 0, jsonpbMarshaler, jsonpbUnmarshaler, envelope)
	if err != nil {
		t.Error(err)
	}

	if !reflect.DeepEqual(envelope, result) {
		t.Error("Input Proto is not the same as Output proto.")
	}
	if result.CollationId != "123" {
		t.Error("Input Proto CollationId is not the same as Output proto.")
	}
}

func TestRuntimeRegisterBeforeWithGroupPayload(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
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
nakama.register_before(test.printWorld, "tgroupsjoin")
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

	rp, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
	r := rp.Get()
	defer r.Stop()

	gid := uuid.NewV4().String()

	fn := r.GetRuntimeCallback(server.BEFORE, "tgroupsjoin")
	envelope := &server.Envelope{
		CollationId: "1234",
		Payload: &server.Envelope_GroupsJoin{
			GroupsJoin: &server.TGroupsJoin{
				GroupIds: []string{gid},
			},
		}}

	result, err := r.InvokeFunctionBefore(fn, "", "", 0, jsonpbMarshaler, jsonpbUnmarshaler, envelope)
	if err != nil {
		t.Error(err)
	}

	if !reflect.DeepEqual(envelope, result) {
		t.Error("Input Proto is not the same as Output proto.")
	}
	if result.CollationId != "1234" {
		t.Error("Input Proto CollationId is not the same as Output proto.")
	}
	if len(result.GetGroupsJoin().GroupIds) != 1 {
		t.Error("Input Proto GroupIds length is not the same as Output proto.")
	}
	if result.GetGroupsJoin().GroupIds[0] != gid {
		t.Error("Input Proto GroupIds value is not the same as Output proto.")
	}
}

func TestRuntimeUserId(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("userid.lua", `
local nk = require("nakama")

local user_ids = {
  "fd09791f-3297-40bd-b411-1afe316fd2e8",
  "fd8db1fc-6f79-4302-a54c-5960c99601a1"
}

local users = nk.users_fetch_id(user_ids)
	`)

	setupDB()
	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeUsersBan(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("userid.lua", `
local nk = require("nakama")

local user_handles = {
  "02ebb2c8"
}

local status, res = pcall(nk.users_ban, user_handles)
if not status then
  print(res)
end
assert(status == true)
	`)

	setupDB()
	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestRuntimeLeaderboardCreate(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("userid.lua", `
local nk = require("nakama")

leaderboard_id = nk.uuid_v4()
local metadata = {
  weather_conditions = "rain"
}

nk.leaderboard_create(leaderboard_id, "desc", "0 0 * * 1", metadata, false)
	`)

	setupDB()
	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestStorageWrite(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("storage_write.lua", `
local nk = require("nakama")

local new_records = {
	{Bucket = "mygame", Collection = "settings", Record = "a", UserId = nil, Value = {}},
	{Bucket = "mygame", Collection = "settings", Record = "b", UserId = nil, Value = {}},
	{Bucket = "mygame", Collection = "settings", Record = "c", UserId = nil, Value = {}}
}

nk.storage_write(new_records)
`)

	setupDB()
	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}

func TestStorageFetch(t *testing.T) {
	defer os.RemoveAll(DATA_PATH)
	writeLuaModule("storage_fetch.lua", `
local nk = require("nakama")
local record_keys = {
  {Bucket = "mygame", Collection = "settings", Record = "a", UserId = nil},
  {Bucket = "mygame", Collection = "settings", Record = "b", UserId = nil},
  {Bucket = "mygame", Collection = "settings", Record = "c", UserId = nil}
}
local records = nk.storage_fetch(record_keys)
for i, r in ipairs(records)
do
  assert(#r.Value == 0, "'r.Value' must be '{}'")
end
`)

	setupDB()
	_, err := newRuntimePool()
	if err != nil {
		t.Error(err)
	}
}
