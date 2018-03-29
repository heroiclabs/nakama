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
	"io"
	"net/http"
	"time"

	"strings"

	"database/sql"

	"fmt"

	"encoding/json"

	"encoding/base64"

	"encoding/hex"
	"io/ioutil"

	"nakama/pkg/jsonpatch"

	"github.com/fatih/structs"
	"github.com/gorhill/cronexpr"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
)

const CALLBACKS = "runtime_callbacks"

type Callbacks struct {
	HTTP   map[string]*lua.LFunction
	RPC    map[string]*lua.LFunction
	Before map[string]*lua.LFunction
	After  map[string]*lua.LFunction
}

type NakamaModule struct {
	logger              *zap.Logger
	db                  *sql.DB
	tracker             Tracker
	notificationService *NotificationService
	cbufferPool         *CbufferPool
	announceHTTP        func(string)
	announceRPC         func(string)
	announceBefore      func(string)
	announceAfter       func(string)
	client              *http.Client
}

func NewNakamaModule(logger *zap.Logger, db *sql.DB, l *lua.LState, tracker Tracker, notificationService *NotificationService, cbufferPool *CbufferPool, announceHTTP func(string), announceRPC func(string), announceBefore func(string), announceAfter func(string)) *NakamaModule {
	l.SetContext(context.WithValue(context.Background(), CALLBACKS, &Callbacks{
		RPC:    make(map[string]*lua.LFunction),
		Before: make(map[string]*lua.LFunction),
		After:  make(map[string]*lua.LFunction),
		HTTP:   make(map[string]*lua.LFunction),
	}))
	return &NakamaModule{
		logger:              logger,
		db:                  db,
		tracker:             tracker,
		notificationService: notificationService,
		cbufferPool:         cbufferPool,
		announceHTTP:        announceHTTP,
		announceRPC:         announceRPC,
		announceBefore:      announceBefore,
		announceAfter:       announceAfter,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (n *NakamaModule) Loader(l *lua.LState) int {
	mod := l.SetFuncs(l.NewTable(), map[string]lua.LGFunction{
		"cbuffer_create":                 n.cbufferPool.create,
		"cbuffer_push":                   n.cbufferPool.push,
		"cbuffer_peek_random":            n.cbufferPool.peekRandom,
		"sql_exec":                       n.sqlExec,
		"sql_query":                      n.sqlQuery,
		"uuid_v4":                        n.uuidV4,
		"uuid_bytes_to_string":           n.uuidBytesToString,
		"uuid_string_to_bytes":           n.uuidStringToBytes,
		"http_request":                   n.httpRequest,
		"json_encode":                    n.jsonEncode,
		"json_decode":                    n.jsonDecode,
		"base64_encode":                  n.base64Encode,
		"base64_decode":                  n.base64Decode,
		"base16_encode":                  n.base16Encode,
		"base16_decode":                  n.base16decode,
		"cron_next":                      n.cronNext,
		"logger_info":                    n.loggerInfo,
		"logger_warn":                    n.loggerWarn,
		"logger_error":                   n.loggerError,
		"register_rpc":                   n.registerRPC,
		"register_before":                n.registerBefore,
		"register_after":                 n.registerAfter,
		"register_http":                  n.registerHTTP,
		"users_fetch_id":                 n.usersFetchId,
		"users_fetch_handle":             n.usersFetchHandle,
		"users_update":                   n.usersUpdate,
		"users_ban":                      n.usersBan,
		"storage_list":                   n.storageList,
		"storage_fetch":                  n.storageFetch,
		"storage_write":                  n.storageWrite,
		"storage_update":                 n.storageUpdate,
		"storage_remove":                 n.storageRemove,
		"leaderboard_create":             n.leaderboardCreate,
		"leaderboard_submit_incr":        n.leaderboardSubmitIncr,
		"leaderboard_submit_decr":        n.leaderboardSubmitDecr,
		"leaderboard_submit_set":         n.leaderboardSubmitSet,
		"leaderboard_submit_best":        n.leaderboardSubmitBest,
		"leaderboard_records_list_user":  n.leaderboardRecordsListUser,
		"leaderboard_records_list_users": n.leaderboardRecordsListUsers,
		"groups_create":                  n.groupsCreate,
		"groups_update":                  n.groupsUpdate,
		"group_users_list":               n.groupUsersList,
		"groups_user_list":               n.groupsUserList,
		"notifications_send_id":          n.notificationsSendId,
		"event_publish":                  n.eventPublish,
	})

	l.Push(mod)
	return 1
}

func (n *NakamaModule) sqlExec(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, l.NewTable())
	if paramsTable == nil {
		l.ArgError(2, "expects params table")
		return 0
	}
	var params []interface{}
	if paramsTable.Len() != 0 {
		var ok bool
		params, ok = convertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	result, err := n.db.Exec(query, params...)
	if err != nil {
		l.RaiseError("sql exec error: %v", err.Error())
		return 0
	}
	count, err := result.RowsAffected()
	if err != nil {
		l.RaiseError("sql exec rows affected error: %v", err.Error())
		return 0
	}

	l.Push(lua.LNumber(count))
	return 1
}

func (n *NakamaModule) sqlQuery(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, l.NewTable())
	if paramsTable == nil {
		l.ArgError(2, "expects params table")
		return 0
	}
	var params []interface{}
	if paramsTable.Len() != 0 {
		var ok bool
		params, ok = convertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	rows, err := n.db.Query(query, params...)
	if err != nil {
		l.RaiseError("sql query error: %v", err.Error())
		return 0
	}
	defer rows.Close()

	resultColumns, err := rows.Columns()
	if err != nil {
		l.RaiseError("sql query column lookup error: %v", err.Error())
		return 0
	}
	resultColumnCount := len(resultColumns)
	resultRows := make([][]interface{}, 0)
	for rows.Next() {
		resultRowValues := make([]interface{}, resultColumnCount)
		resultRowPointers := make([]interface{}, resultColumnCount)
		for i, _ := range resultRowValues {
			resultRowPointers[i] = &resultRowValues[i]
		}
		if err = rows.Scan(resultRowPointers...); err != nil {
			l.RaiseError("sql query scan error: %v", err.Error())
			return 0
		}
		resultRows = append(resultRows, resultRowValues)
	}
	if err = rows.Err(); err != nil {
		l.RaiseError("sql query row scan error: %v", err.Error())
		return 0
	}

	rt := l.NewTable()
	for i, r := range resultRows {
		rowTable := l.NewTable()
		for j, col := range resultColumns {
			rowTable.RawSetString(col, convertValue(l, r[j]))
		}
		rt.RawSetInt(i+1, rowTable)
	}
	l.Push(rt)
	return 1
}

func (n *NakamaModule) uuidV4(l *lua.LState) int {
	// TODO ensure there were no arguments to the function
	l.Push(lua.LString(uuid.NewV4().String()))
	return 1
}

func (n *NakamaModule) uuidBytesToString(l *lua.LState) int {
	uuidBytes := l.CheckString(1)
	if uuidBytes == "" {
		l.ArgError(1, "Expects a UUID byte string")
		return 0
	}
	u, err := uuid.FromBytes([]byte(uuidBytes))
	if err != nil {
		l.ArgError(1, "Not a valid UUID byte string")
		return 0
	}
	l.Push(lua.LString(u.String()))
	return 1
}

func (n *NakamaModule) uuidStringToBytes(l *lua.LState) int {
	uuidString := l.CheckString(1)
	if uuidString == "" {
		l.ArgError(1, "Expects a UUID string")
		return 0
	}
	u, err := uuid.FromString(uuidString)
	if err != nil {
		l.ArgError(1, "Not a valid UUID string")
		return 0
	}
	l.Push(lua.LString(u.Bytes()))
	return 1
}

func (n *NakamaModule) httpRequest(l *lua.LState) int {
	url := l.CheckString(1)
	method := l.CheckString(2)
	headers := l.CheckTable(3)
	body := l.OptString(4, "")
	if url == "" {
		l.ArgError(1, "Expects URL string")
		return 0
	}
	if method == "" {
		l.ArgError(2, "Expects method string")
		return 0
	}

	// Prepare request body, if any.
	var requestBody io.Reader
	if body != "" {
		requestBody = strings.NewReader(body)
	}
	// Prepare the request.
	req, err := http.NewRequest(method, url, requestBody)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Apply any request headers.
	httpHeaders := ConvertLuaTable(headers)
	for k, v := range httpHeaders {
		if vs, ok := v.(string); !ok {
			l.RaiseError("HTTP header values must be strings")
			return 0
		} else {
			req.Header.Add(k, vs)
		}
	}
	// Execute the request.
	resp, err := n.client.Do(req)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Read the response body.
	responseBody, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		l.RaiseError("HTTP response body error: %v", err.Error())
		return 0
	}
	// Read the response headers.
	responseHeaders := make(map[string]interface{}, len(resp.Header))
	for k, vs := range resp.Header {
		// TODO accept multiple values per header
		for _, v := range vs {
			responseHeaders[k] = v
			break
		}
	}

	l.Push(lua.LNumber(resp.StatusCode))
	l.Push(ConvertMap(l, responseHeaders))
	l.Push(lua.LString(string(responseBody)))
	return 3
}

func (n *NakamaModule) jsonEncode(l *lua.LState) int {
	jsonTable := l.Get(1)
	if jsonTable == nil {
		l.ArgError(1, "Expects a non-nil value to encode")
		return 0
	}

	jsonData := convertLuaValue(jsonTable)
	jsonBytes, err := json.Marshal(jsonData)
	if err != nil {
		l.RaiseError("Error encoding to JSON: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(string(jsonBytes)))
	return 1
}

func (n *NakamaModule) jsonDecode(l *lua.LState) int {
	jsonString := l.CheckString(1)
	if jsonString == "" {
		l.ArgError(1, "Expects JSON string")
		return 0
	}

	var jsonData interface{}
	if err := json.Unmarshal([]byte(jsonString), &jsonData); err != nil {
		l.RaiseError("Not a valid JSON string: %v", err.Error())
		return 0
	}

	l.Push(convertValue(l, jsonData))
	return 1
}

func (n *NakamaModule) base64Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output := base64.StdEncoding.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}
func (n *NakamaModule) base64Decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		l.RaiseError("Not a valid base64 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}
func (n *NakamaModule) base16Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output := hex.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}
func (n *NakamaModule) base16decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output, err := hex.DecodeString(input)
	if err != nil {
		l.RaiseError("Not a valid base16 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) cronNext(l *lua.LState) int {
	cron := l.CheckString(1)
	if cron == "" {
		l.ArgError(1, "expects cron string")
		return 0
	}
	ts := l.CheckInt64(2)
	if ts == 0 {
		l.ArgError(1, "expects timestamp in seconds")
		return 0
	}

	expr, err := cronexpr.Parse(cron)
	if err != nil {
		l.ArgError(1, "expects a valid cron string")
		return 0
	}
	t := time.Unix(ts, 0).UTC()
	next := expr.Next(t)
	nextTs := next.UTC().Unix()
	l.Push(lua.LNumber(nextTs))
	return 1
}

func (n *NakamaModule) loggerInfo(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Info(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) loggerWarn(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Warn(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) loggerError(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Error(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) registerRPC(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects rpc id")
		return 0
	}

	id = strings.ToLower(id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.RPC[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(id)
	}
	return 0
}

func (n *NakamaModule) registerBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	messageName := l.CheckString(2)

	if messageName == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	messageName = strings.ToLower(messageName)

	foundMessage := false
	for _, v := range RUNTIME_MESSAGES {
		if v == messageName {
			foundMessage = true
			break
		}
	}

	if !foundMessage {
		l.ArgError(2, "Invalid message name for register hook.")
		return 0
	}

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.Before[messageName] = fn
	if n.announceBefore != nil {
		n.announceBefore(messageName)
	}
	return 0
}

func (n *NakamaModule) registerAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	messageName := l.CheckString(2)

	if messageName == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	messageName = strings.ToLower(messageName)

	foundMessage := false
	for _, v := range RUNTIME_MESSAGES {
		if v == messageName {
			foundMessage = true
			break
		}
	}

	if !foundMessage {
		l.ArgError(2, "Invalid message name for register hook.")
		return 0
	}

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.After[messageName] = fn
	if n.announceAfter != nil {
		n.announceAfter(messageName)
	}
	return 0
}

func (n *NakamaModule) registerHTTP(l *lua.LState) int {
	fn := l.CheckFunction(1)
	path := l.CheckString(2)

	if path == "" {
		l.ArgError(2, "expects http path")
		return 0
	}

	if strings.HasPrefix(path, "/") {
		l.ArgError(2, "http path should not start with leading slash")
		return 0
	}

	path = strings.ToLower(path)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.HTTP[path] = fn
	if n.announceHTTP != nil {
		n.announceHTTP(path)
	}
	return 0
}

func (n *NakamaModule) usersFetchId(l *lua.LState) int {
	lt := l.CheckTable(1)
	userIds, ok := convertLuaValue(lt).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}

	userIdStrings := make([]string, 0)
	for _, id := range userIds {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		} else {
			userIdStrings = append(userIdStrings, ids)
		}
	}

	users, err := UsersFetchIds(n.logger, n.db, n.tracker, userIdStrings)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to retrieve users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, u := range users {
		um := structs.Map(u)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		ut := ConvertMap(l, um)
		ut.RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, ut)
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) usersFetchHandle(l *lua.LState) int {
	lt := l.CheckTable(1)
	handles, ok := convertLuaValue(lt).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user handle data")
		return 0
	}

	userHandles := make([]string, 0)
	for _, h := range handles {
		if hs, ok := h.(string); !ok {
			l.ArgError(1, "invalid user handle data, each handle must be a string")
			return 0
		} else {
			userHandles = append(userHandles, hs)
		}
	}

	users, err := UsersFetchHandle(n.logger, n.db, n.tracker, userHandles)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to retrieve users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, u := range users {
		um := structs.Map(u)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		ut := ConvertMap(l, um)
		ut.RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, ut)
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) usersUpdate(l *lua.LState) int {
	updatesTable := l.CheckTable(1)
	if updatesTable == nil || updatesTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of user updates")
		return 0
	}

	conversionError := ""
	updates := make([]*SelfUpdateOp, 0)

	updatesTable.ForEach(func(i lua.LValue, u lua.LValue) {
		updateTable, ok := u.(*lua.LTable)
		if !ok {
			conversionError = "expects a valid set of user updates"
			return
		}

		update := &SelfUpdateOp{}
		updateTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "UserId":
				if v.Type() != lua.LTString {
					conversionError = "expects valid user IDs in each update"
					return
				}
				if uid := v.String(); uid == "" {
					conversionError = "expects valid user IDs in each update"
					return
				} else {
					update.UserId = uid
				}
			case "Handle":
				if v.Type() != lua.LTString {
					conversionError = "expects valid handles in each update"
					return
				}
				update.Handle = v.String()
			case "Fullname":
				if v.Type() != lua.LTString {
					conversionError = "expects valid fullnames in each update"
					return
				}
				update.Fullname = v.String()
			case "Timezone":
				if v.Type() != lua.LTString {
					conversionError = "expects valid timezones in each update"
					return
				}
				update.Timezone = v.String()
			case "Location":
				if v.Type() != lua.LTString {
					conversionError = "expects valid locations in each update"
					return
				}
				update.Location = v.String()
			case "Lang":
				if v.Type() != lua.LTString {
					conversionError = "expects valid langs in each update"
					return
				}
				update.Lang = v.String()
			case "Metadata":
				if v.Type() != lua.LTTable {
					conversionError = "expects Metadata to be a table"
					return
				}

				metadataMap := ConvertLuaTable(v.(*lua.LTable))
				metadataBytes, err := json.Marshal(metadataMap)
				if err != nil {
					conversionError = fmt.Sprintf("failed to convert metadata: %s", err.Error())
					return
				}

				update.Metadata = metadataBytes
			case "AvatarUrl":
				if v.Type() != lua.LTString {
					conversionError = "expects valid avatar urls in each update"
					return
				}
				update.AvatarUrl = v.String()
			}
		})

		// Check it's a valid update op.
		if len(update.UserId) == 0 {
			conversionError = "expects each update to contain a user ID"
			return
		}
		if update.Handle == "" && update.Fullname == "" && update.Timezone == "" && update.Location == "" && update.Lang == "" && len(update.Metadata) == 0 && update.AvatarUrl == "" {
			conversionError = "expects each update to contain at least one field to change"
			return
		}
		updates = append(updates, update)
	})

	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	if _, err := SelfUpdate(n.logger, n.db, updates); err != nil {
		l.RaiseError(fmt.Sprintf("failed to update users: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) usersBan(l *lua.LState) int {
	usersTable := l.CheckTable(1)
	if usersTable == nil || usersTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of users")
		return 0
	}
	usersRaw, ok := convertLuaValue(usersTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of users")
		return 0
	}

	ids := make([]string, 0)
	handles := make([]string, 0)
	for _, d := range usersRaw {
		if m, ok := d.(string); !ok {
			l.ArgError(1, "expects a valid set of user IDs or handles")
			return 0
		} else {
			// Ban as both ID and handle.
			ids = append(ids, m)
			handles = append(handles, m)
		}
	}

	if err := UsersBan(n.logger, n.db, ids, handles); err != nil {
		l.RaiseError(fmt.Sprintf("failed to ban users: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) storageList(l *lua.LState) int {
	userID := l.OptString(1, "")
	bucket := l.OptString(2, "")
	collection := l.OptString(3, "")
	limit := l.CheckInt64(4)
	cursor := l.OptString(5, "")

	values, newCursor, _, err := StorageList(n.logger, n.db, "", userID, bucket, collection, limit, cursor)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list storage: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, v := range values {
		vm := structs.Map(v)

		valueMap := make(map[string]interface{})
		err = json.Unmarshal(v.Value, &valueMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert value to json: %s", err.Error()))
			return 0
		}

		lt := ConvertMap(l, vm)
		lt.RawSetString("Value", ConvertMap(l, valueMap))
		lv.RawSetInt(i+1, lt)
	}
	l.Push(lv)

	// Convert and push the new cursor, if any.
	if newCursor != "" {
		l.Push(lua.LString(newCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *NakamaModule) storageFetch(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil || keysTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of keys")
		return 0
	}
	keysRaw, ok := convertLuaValue(keysTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	keyMap := make([]map[string]interface{}, 0)
	for _, d := range keysRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of data")
			return 0
		} else {
			keyMap = append(keyMap, m)
		}
	}

	keys := make([]*StorageKey, len(keyMap))
	idx := 0
	for _, k := range keyMap {
		var bucket string
		if b, ok := k["Bucket"]; !ok {
			l.ArgError(1, "expects a bucket in each key")
			return 0
		} else {
			if bs, ok := b.(string); !ok {
				l.ArgError(1, "bucket must be a string")
				return 0
			} else {
				bucket = bs
			}
		}
		var collection string
		if c, ok := k["Collection"]; !ok {
			l.ArgError(1, "expects a collection in each key")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(1, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var record string
		if r, ok := k["Record"]; !ok {
			l.ArgError(1, "expects a record in each key")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(1, "record must be a string")
				return 0
			} else {
				record = rs
			}
		}
		var userID string
		if u, ok := k["UserId"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(1, "expects valid user IDs in each key, when provided")
				return 0
			} else {
				userID = us
			}
		}

		keys[idx] = &StorageKey{
			Bucket:     bucket,
			Collection: collection,
			Record:     record,
			UserId:     userID,
		}
		idx++
	}

	values, _, err := StorageFetch(n.logger, n.db, "", keys)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to fetch storage: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, v := range values {
		vm := structs.Map(v)

		valueMap := make(map[string]interface{})
		err = json.Unmarshal(v.Value, &valueMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert value to json: %s", err.Error()))
			return 0
		}

		lt := ConvertMap(l, vm)
		lt.RawSetString("Value", ConvertMap(l, valueMap))
		lv.RawSetInt(i+1, lt)
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) storageWrite(l *lua.LState) int {
	dataTable := l.CheckTable(1)
	if dataTable == nil || dataTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	dataRaw, ok := convertLuaValue(dataTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	dataMap := make([]map[string]interface{}, 0)
	for _, d := range dataRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of data")
			return 0
		} else {
			dataMap = append(dataMap, m)
		}
	}

	data := make([]*StorageData, len(dataMap))
	idx := 0
	for _, k := range dataMap {
		var bucket string
		if b, ok := k["Bucket"]; !ok {
			l.ArgError(1, "expects a bucket in each key")
			return 0
		} else {
			if bs, ok := b.(string); !ok {
				l.ArgError(1, "bucket must be a string")
				return 0
			} else {
				bucket = bs
			}
		}
		var collection string
		if c, ok := k["Collection"]; !ok {
			l.ArgError(1, "expects a collection in each key")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(1, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var record string
		if r, ok := k["Record"]; !ok {
			l.ArgError(1, "expects a record in each key")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(1, "record must be a string")
				return 0
			} else {
				record = rs
			}
		}
		var value []byte
		if v, ok := k["Value"]; !ok {
			l.ArgError(1, "expects a value in each key")
			return 0
		} else {
			if vs, ok := v.(map[string]interface{}); !ok {
				l.ArgError(1, "value must be a table")
				return 0
			} else {
				dataJson, err := json.Marshal(vs)
				if err != nil {
					l.RaiseError("could not convert value to JSON: %v", err.Error())
					return 0
				}
				value = dataJson
			}
		}
		var userID string
		if u, ok := k["UserId"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(1, "expects valid user IDs in each value, when provided")
				return 0
			} else {
				userID = us
			}
		}
		var version string
		if v, ok := k["Version"]; ok {
			if vs, ok := v.(string); !ok {
				l.ArgError(1, "version must be a string")
				return 0
			} else {
				version = vs
			}
		}
		readPermission := int64(1)
		if r, ok := k["PermissionRead"]; ok {
			if rf, ok := r.(float64); !ok {
				l.ArgError(1, "permission read must be a number")
				return 0
			} else {
				readPermission = int64(rf)
			}
		}
		writePermission := int64(1)
		if w, ok := k["PermissionWrite"]; ok {
			if wf, ok := w.(float64); !ok {
				l.ArgError(1, "permission read must be a number")
				return 0
			} else {
				writePermission = int64(wf)
			}
		}

		data[idx] = &StorageData{
			Bucket:          bucket,
			Collection:      collection,
			Record:          record,
			UserId:          userID,
			Value:           value,
			Version:         version,
			PermissionRead:  readPermission,
			PermissionWrite: writePermission,
		}
		idx++
	}

	keys, _, err := StorageWrite(n.logger, n.db, "", data)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to write storage: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, k := range keys {
		km := structs.Map(k)
		lv.RawSetInt(i+1, convertValue(l, km))
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) storageUpdate(l *lua.LState) int {
	updatesTable := l.CheckTable(1)
	if updatesTable == nil || updatesTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of user updates")
		return 0
	}

	conversionError := ""
	updates := make([]*StorageKeyUpdate, 0)

	updatesTable.ForEach(func(i lua.LValue, u lua.LValue) {
		updateTable, ok := u.(*lua.LTable)
		if !ok {
			conversionError = "expects a valid set of user updates"
			return
		}

		// Initialise fields where default values for their types are not the logical defaults needed.
		update := &StorageKeyUpdate{
			Key:             &StorageKey{},
			PermissionRead:  int64(1),
			PermissionWrite: int64(1),
		}

		updateTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "Bucket":
				if v.Type() != lua.LTString {
					conversionError = "expects valid buckets in each update"
					return
				}
				update.Key.Bucket = v.String()
			case "Collection":
				if v.Type() != lua.LTString {
					conversionError = "expects valid collections in each update"
					return
				}
				update.Key.Collection = v.String()
			case "Record":
				if v.Type() != lua.LTString {
					conversionError = "expects valid records in each update"
					return
				}
				update.Key.Record = v.String()
			case "UserId":
				if v.Type() != lua.LTString {
					conversionError = "expects valid user IDs in each update"
					return
				}
				update.Key.UserId = v.String()
			case "Version":
				if v.Type() != lua.LTString {
					conversionError = "expects valid versions in each update"
					return
				}
				update.Key.Version = v.String()
			case "PermissionRead":
				if v.Type() != lua.LTNumber {
					conversionError = "expects valid read permissions in each update"
					return
				}
				update.PermissionRead = int64(lua.LVAsNumber(v))
			case "PermissionWrite":
				if v.Type() != lua.LTNumber {
					conversionError = "expects valid write permissions in each update"
					return
				}
				update.PermissionWrite = int64(lua.LVAsNumber(v))
			case "Update":
				if v.Type() != lua.LTTable {
					conversionError = "expects valid patch op in each update"
					return
				}

				vi, ok := convertLuaValue(v).([]interface{})
				if !ok {
					conversionError = "expects valid patch op in each update"
					return
				}

				// Lowercase all key names in op declarations.
				// eg. the Lua patch op: {{Op = "incr", Path = "/foo", Value = 1}}
				// becomes the JSON:     [{"op": "incr", "path": "/foo", "value": 1}]
				for _, vim := range vi {
					vm, ok := vim.(map[string]interface{})
					if !ok {
						conversionError = "expects valid patch op in each update"
						return
					}
					for vmK, vmV := range vm {
						vmKlower := strings.ToLower(vmK)
						if vmKlower != vmK {
							delete(vm, vmK)
							vm[vmKlower] = vmV
						}
					}
				}

				ve, err := json.Marshal(vi)
				if err != nil {
					conversionError = "expects valid patch op in each update"
					return
				}
				patch, err := jsonpatch.DecodeExtendedPatch(ve)
				if err != nil {
					conversionError = "expects valid patch op in each update"
					return
				}
				update.Patch = patch
			}
		})

		// If there was an inner error allow it to propagate.
		if conversionError != "" {
			return
		}

		// Check it's a valid update op.
		if update.Key.Bucket == "" || update.Key.Collection == "" || update.Key.Record == "" || update.Patch == nil {
			conversionError = "expects each update to contain at least bucket, collection, record, and update"
			return
		}
		updates = append(updates, update)
	})

	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	keys, _, err := StorageUpdate(n.logger, n.db, "", updates)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to update storage: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, k := range keys {
		km := structs.Map(k)
		lv.RawSetInt(i+1, convertValue(l, km))
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) storageRemove(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil || keysTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of keys")
		return 0
	}
	keysRaw, ok := convertLuaValue(keysTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	keyMap := make([]map[string]interface{}, 0)
	for _, d := range keysRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of data")
			return 0
		} else {
			keyMap = append(keyMap, m)
		}
	}

	keys := make([]*StorageKey, len(keyMap))
	idx := 0
	for _, k := range keyMap {
		var bucket string
		if b, ok := k["Bucket"]; !ok {
			l.ArgError(1, "expects a bucket in each key")
			return 0
		} else {
			if bs, ok := b.(string); !ok {
				l.ArgError(1, "bucket must be a string")
				return 0
			} else {
				bucket = bs
			}
		}
		var collection string
		if c, ok := k["Collection"]; !ok {
			l.ArgError(1, "expects a collection in each key")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(1, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var record string
		if r, ok := k["Record"]; !ok {
			l.ArgError(1, "expects a record in each key")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(1, "record must be a string")
				return 0
			} else {
				record = rs
			}
		}
		var userID string
		if u, ok := k["UserId"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(1, "expects valid user IDs in each key, when provided")
				return 0
			} else {
				userID = us
			}
		}
		var version string
		if v, ok := k["Version"]; ok {
			if vs, ok := v.(string); !ok {
				l.ArgError(1, "version must be a string")
				return 0
			} else {
				version = vs
			}
		}
		keys[idx] = &StorageKey{
			Bucket:     bucket,
			Collection: collection,
			Record:     record,
			UserId:     userID,
			Version:    version,
		}
		idx++
	}

	if _, err := StorageRemove(n.logger, n.db, "", keys); err != nil {
		l.RaiseError(fmt.Sprintf("failed to remove storage: %s", err.Error()))
	}
	return 0
}

func (n *NakamaModule) leaderboardCreate(l *lua.LState) int {
	id := l.CheckString(1)
	sort := l.CheckString(2)
	reset := l.OptString(3, "")
	metadata := l.OptTable(4, l.NewTable())
	authoritative := l.OptBool(5, false)

	if sort != "asc" && sort != "desc" {
		l.ArgError(2, "invalid sort - only acceptable values are 'asc' and 'desc'")
		return 0
	}

	metadataMap := ConvertLuaTable(metadata)
	metadataBytes, err := json.Marshal(metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata: %s", err.Error()))
		return 0
	}

	_, err = leaderboardCreate(n.logger, n.db, id, sort, reset, string(metadataBytes), authoritative)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to create leaderboard: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) leaderboardSubmitIncr(l *lua.LState) int {
	return n.leaderboardSubmit(l, "incr")
}
func (n *NakamaModule) leaderboardSubmitDecr(l *lua.LState) int {
	return n.leaderboardSubmit(l, "decr")
}
func (n *NakamaModule) leaderboardSubmitSet(l *lua.LState) int {
	return n.leaderboardSubmit(l, "set")
}
func (n *NakamaModule) leaderboardSubmitBest(l *lua.LState) int {
	return n.leaderboardSubmit(l, "best")
}

func (n *NakamaModule) leaderboardSubmit(l *lua.LState, op string) int {
	leaderboardID := l.CheckString(1)
	value := l.CheckInt64(2)
	ownerID := l.CheckString(3)
	if ownerID == "" {
		l.ArgError(3, "invalid owner id")
		return 0
	}
	handle := l.OptString(4, "")
	lang := l.OptString(5, "")
	location := l.OptString(6, "")
	timezone := l.OptString(7, "")
	metadata := l.OptTable(8, l.NewTable())

	metadataMap := ConvertLuaTable(metadata)
	metadataBytes, err := json.Marshal(metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert leaderboard record metadata: %s", err.Error()))
		return 0
	}

	record, _, err := leaderboardSubmit(n.logger, n.db, "", leaderboardID, ownerID, handle, lang, op, value, location, timezone, metadataBytes)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to submit leaderboard record: %s", err.Error()))
		return 0
	}

	rm := structs.Map(record)

	outgoingMetadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(record.Metadata), &outgoingMetadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert leaderboard record metadata to json: %s", err.Error()))
		return 0
	}

	lv := ConvertMap(l, rm)
	lv.RawSetString("Metadata", ConvertMap(l, outgoingMetadataMap))

	l.Push(lv)
	return 1
}

func (n *NakamaModule) leaderboardRecordsListUser(l *lua.LState) int {
	leaderboardID := l.CheckString(1)
	if leaderboardID == "" {
		l.ArgError(1, "expects a valid leaderboard id")
		return 0
	}
	userID := l.CheckString(2)
	if userID == "" {
		l.ArgError(2, "expects a valid user ID")
		return 0
	}
	limit := l.CheckInt64(3)
	if limit == 0 {
		l.ArgError(3, "expects a valid limit 10-100")
		return 0
	}

	// Construct the operation.
	list := &TLeaderboardRecordsList{
		LeaderboardId: leaderboardID,
		Filter: &TLeaderboardRecordsList_OwnerId{
			OwnerId: userID,
		},
		Limit: limit,
	}

	records, newCursor, _, err := leaderboardRecordsList(n.logger, n.db, "", list)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list leadeboard records: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, r := range records {
		rm := structs.Map(r)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(r.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		rt := ConvertMap(l, rm)
		rt.RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, rt)
	}
	l.Push(lv)

	if newCursor != "" {
		l.Push(lua.LString(newCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *NakamaModule) leaderboardRecordsListUsers(l *lua.LState) int {
	leaderboardID := l.CheckString(1)
	if leaderboardID == "" {
		l.ArgError(1, "expects a valid leaderboard id")
		return 0
	}
	users := l.CheckTable(2)
	if users == nil {
		l.ArgError(2, "expects a valid list of user ids")
		return 0
	}
	limit := l.CheckInt64(3)
	if limit == 0 {
		l.ArgError(2, "expects a valid limit 10-100")
		return 0
	}
	cursor := l.OptString(4, "")

	// Construct the operation.
	list := &TLeaderboardRecordsList{
		LeaderboardId: leaderboardID,
		Filter: &TLeaderboardRecordsList_OwnerIds{
			OwnerIds: &TLeaderboardRecordsList_Owners{
				OwnerIds: make([]string, 0),
			},
		},
		Limit: limit,
	}
	if cursor != "" {
		list.Cursor = cursor
	}

	conversionError := ""
	users.ForEach(func(k lua.LValue, v lua.LValue) {
		if v.Type() != lua.LTString {
			conversionError = "expects user ids to be strings"
			return
		}
		u := v.String()
		if u == "" {
			conversionError = "expects user ids to be valid"
			return
		}
		list.GetOwnerIds().OwnerIds = append(list.GetOwnerIds().OwnerIds, u)
	})

	if conversionError != "" {
		l.ArgError(2, conversionError)
		return 0
	}

	records, newCursor, _, err := leaderboardRecordsList(n.logger, n.db, "", list)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list leadeboard records: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, r := range records {
		rm := structs.Map(r)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(r.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		rt := ConvertMap(l, rm)
		rt.RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, rt)
	}
	l.Push(lv)

	if newCursor != "" {
		l.Push(lua.LString(newCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *NakamaModule) groupsCreate(l *lua.LState) int {
	groupsTable := l.CheckTable(1)
	if groupsTable == nil || groupsTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of groups")
		return 0
	}

	conversionError := false
	groupParams := make([]*GroupCreateParam, 0)

	groupsTable.ForEach(func(i lua.LValue, g lua.LValue) {
		groupTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid group")
			return
		}

		p := &GroupCreateParam{}
		groupTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "Name":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects Name to be string")
					return
				}
				p.Name = v.String()
			case "Description":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects Description to be string")
					return
				}
				p.Description = v.String()
			case "AvatarUrl":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects AvatarUrl to be string")
					return
				}
				p.AvatarURL = v.String()
			case "Lang":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects Lang to be string")
					return
				}
				p.Lang = v.String()
			case "Private":
				if v.Type() != lua.LTBool {
					conversionError = true
					l.ArgError(1, "expects Private to be boolean")
					return
				}
				p.Private = lua.LVAsBool(v)
			case "Metadata":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects Metadata to be a table")
					return
				}

				metadataMap := ConvertLuaTable(v.(*lua.LTable))
				metadataBytes, err := json.Marshal(metadataMap)
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
					return
				}

				p.Metadata = metadataBytes
			case "CreatorId":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects CreatorId to be string")
					return
				}

				u := v.String()
				if u == "" {
					conversionError = true
					l.ArgError(1, "invalid CreatorId")
					return
				}
				p.Creator = u
			}
		})

		// Check mandatory items.
		if p.Name == "" {
			conversionError = true
			l.ArgError(1, "missing group Name")
			return
		} else if len(p.Creator) == 0 {
			conversionError = true
			l.ArgError(1, "missing CreatorId")
			return
		}

		// Set defaults if the values are missing.
		if len(p.Metadata) == 0 {
			p.Metadata = []byte("{}")
		}

		groupParams = append(groupParams, p)
	})

	if conversionError {
		return 0
	}

	groups, err := GroupsCreate(n.logger, n.db, groupParams)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to create groups: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, g := range groups {
		gm := structs.Map(g)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(g.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		gt := ConvertMap(l, gm)
		gt.RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, gt)
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) groupsUpdate(l *lua.LState) int {
	groupsTable := l.CheckTable(1)
	if groupsTable == nil || groupsTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of groups")
		return 0
	}

	conversionError := ""
	groupUpdates := make([]*TGroupsUpdate_GroupUpdate, 0)

	groupsTable.ForEach(func(i lua.LValue, g lua.LValue) {
		groupTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = "expects a valid group"
			return
		}

		p := &TGroupsUpdate_GroupUpdate{}
		groupTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "GroupId":
				if v.Type() != lua.LTString {
					conversionError = "expects GroupId to be a string"
					return
				}
				gid := v.String()
				if gid == "" {
					conversionError = "expects GroupId to be a valid ID"
					return
				}
				p.GroupId = gid
			case "Name":
				if v.Type() != lua.LTString {
					conversionError = "expects Name to be a string"
					return
				}
				p.Name = v.String()
			case "Description":
				if v.Type() != lua.LTString {
					conversionError = "expects Description to be string"
					return
				}
				p.Description = v.String()
			case "AvatarUrl":
				if v.Type() != lua.LTString {
					conversionError = "expects AvatarUrl to be string"
					return
				}
				p.AvatarUrl = v.String()
			case "Lang":
				if v.Type() != lua.LTString {
					conversionError = "expects Lang to be string"
					return
				}
				p.Lang = v.String()
			case "Private":
				if v.Type() != lua.LTBool {
					conversionError = "expects Private to be boolean"
					return
				}
				p.Private = lua.LVAsBool(v)
			case "Metadata":
				if v.Type() != lua.LTTable {
					conversionError = "expects Metadata to be a table"
					return
				}

				metadataMap := ConvertLuaTable(v.(*lua.LTable))
				metadataBytes, err := json.Marshal(metadataMap)
				if err != nil {
					conversionError = "invalid Metadata"
					return
				}

				p.Metadata = string(metadataBytes)
			}
		})

		if conversionError != "" {
			return
		}

		// mandatory items
		if len(p.GroupId) == 0 {
			conversionError = "missing GroupId"
			return
		}

		groupUpdates = append(groupUpdates, p)
	})

	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	_, err := GroupsUpdate(n.logger, n.db, "", groupUpdates)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to update groups: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) groupUsersList(l *lua.LState) int {
	groupID := l.CheckString(1)
	if groupID == "" {
		l.ArgError(1, "expects a valid group ID")
		return 0
	}

	users, _, err := GroupUsersList(n.logger, n.db, n.tracker, "", groupID)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list group users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, u := range users {
		um := structs.Map(u)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.User.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		ut := ConvertMap(l, um)
		ut.RawGetString("User").(*lua.LTable).RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, ut)
	}

	l.Push(lv)

	return 1
}

func (n *NakamaModule) groupsUserList(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects a valid user ID")
		return 0
	}

	groups, _, err := GroupsSelfList(n.logger, n.db, "", userID)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list user groups: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	lv := l.NewTable()
	for i, g := range groups {
		gm := structs.Map(g)

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(g.Group.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}

		gt := ConvertMap(l, gm)
		gt.RawGetString("Group").(*lua.LTable).RawSetString("Metadata", ConvertMap(l, metadataMap))
		lv.RawSetInt(i+1, gt)
	}

	l.Push(lv)

	return 1
}

func (n *NakamaModule) notificationsSendId(l *lua.LState) int {
	notificationsTable := l.CheckTable(1)
	if notificationsTable == nil {
		l.ArgError(1, "expects a valid set of notifications")
		return 0
	}

	conversionError := false
	notifications := make([]*NNotification, 0)
	notificationsTable.ForEach(func(i lua.LValue, g lua.LValue) {
		notificationTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of notifications")
			return
		}

		notification := &NNotification{}
		notification.CreatedAt = nowMs()
		notification.ExpiresAt = n.notificationService.expiryMs + notification.CreatedAt
		notificationTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "Persistent":
				if v.Type() != lua.LTBool {
					conversionError = true
					l.ArgError(1, "expects Persistent to be boolean")
					return
				}
				notification.Persistent = lua.LVAsBool(v)
			case "Subject":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects Subject to be string")
					return
				}
				notification.Subject = v.String()
			case "Content":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects Content to be a table")
					return
				}

				contentMap := ConvertLuaTable(v.(*lua.LTable))
				contentBytes, err := json.Marshal(contentMap)
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("failed to convert content: %s", err.Error()))
					return
				}

				notification.Content = contentBytes
			case "Code":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects Code to be number")
					return
				}
				number := int64(lua.LVAsNumber(v))
				if number <= 100 {
					l.ArgError(1, "expects Code to be above 100")
					return
				}
				notification.Code = int64(number)
			case "ExpiresAt":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects ExpiresAt to be number")
					return
				}
				number := int64(lua.LVAsNumber(v))
				if number <= 0 {
					l.ArgError(1, "expects ExpiresAt to be above 100")
					return
				}
				notification.ExpiresAt = notification.CreatedAt + int64(number)
			case "UserId":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects UserId to be string")
					return
				}
				u := v.String()
				if u == "" {
					l.ArgError(1, "expects UserId to be a valid UUID")
					return
				}
				notification.UserID = u
			case "SenderId":
				if v.Type() == lua.LTNil {
					return
				}
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects SenderId to be string")
					return
				}
				u := v.String()
				if u == "" {
					l.ArgError(1, "expects SenderId to be a valid UUID")
					return
				}
				notification.SenderID = u
			}
		})

		if notification.Subject == "" {
			l.ArgError(1, "expects Subject to be non-empty")
			return
		} else if len(notification.Content) == 0 {
			l.ArgError(1, "expects Content to be a valid JSON")
			return
		} else if len(notification.UserID) == 0 {
			l.ArgError(1, "expects UserId to be a valid UUID")
			return
		}

		notification.Id = generateNewId()

		notifications = append(notifications, notification)
	})

	if conversionError {
		return 0
	}

	err := n.notificationService.NotificationSend(notifications)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to send notifications: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) eventPublish(l *lua.LState) int {
	return 0
}
