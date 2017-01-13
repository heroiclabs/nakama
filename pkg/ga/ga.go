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

package ga

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
)

const (
	gaURL = "https://www.google-analytics.com/collect"
)

var (
	gacodeRegexp = regexp.MustCompile(`^UA-\d+-\d+$`)
)

// Event is a GA event.
type Event struct {
	Ec string // event category
	Ea string // event action
	El string // event label
	Ev string // event value
}

// AppInfo represents a mobile app info GA event.
type AppInfo struct {
	An   string // app name
	Aid  string // app identifier
	Av   string // app version
	Aiid string // app installer identifier
}

// SendAppInfo will send the AppInfo struct to GA over HTTP.
func SendAppInfo(httpc *http.Client, gacode string, cookie string, app *AppInfo) error {
	values := url.Values{}
	values.Add("an", app.An)
	values.Add("av", app.Av)
	values.Add("aid", app.Aid)
	values.Add("aiid", app.Aiid)
	return SendValues(httpc, gacode, cookie, values)
}

// SendEvent will send the event struct to GA over HTTP.
func SendEvent(httpc *http.Client, gacode string, cookie string, event *Event) error {
	if len(event.Ec) < 1 || len(event.Ea) < 1 {
		return errors.New("Event category/action must be set.")
	}

	values := url.Values{}
	values.Add("ec", event.Ec)
	values.Add("ea", event.Ea)

	if len(event.El) > 0 {
		values.Add("el", event.El)
	}
	if len(event.Ev) > 0 {
		values.Add("ev", event.Ev)
	}

	values.Add("t", "event")
	return SendValues(httpc, gacode, cookie, values)
}

// SendValues will send supplied values to GA over HTTP.
func SendValues(httpc *http.Client, gacode string, cookie string, values url.Values) error {
	if !gacodeRegexp.MatchString(gacode) {
		return errors.New("Invalid Tracking ID.")
	}

	// Add required params
	values.Add("v", "1")
	values.Add("tid", gacode)
	values.Add("cid", cookie)

	// Send request
	buf := bytes.NewBufferString(values.Encode())
	resp, err := httpc.Post(gaURL, "application/x-www-form-urlencoded", buf)
	if err != nil {
		return err
	}

	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Request failed with '%v' status.", resp.StatusCode)
	}
	return nil
}

// SendSessionStart will send a session start event to GA over HTTP.
func SendSessionStart(httpc *http.Client, gacode string, cookie string) error {
	values := url.Values{}
	values.Add("t", "event")
	values.Add("sc", "start")
	return SendValues(httpc, gacode, cookie, values)
}

// SendSessionStop will send a session stop event to GA over HTTP.
func SendSessionStop(httpc *http.Client, gacode string, cookie string) error {
	values := url.Values{}
	values.Add("t", "event")
	values.Add("sc", "end")
	return SendValues(httpc, gacode, cookie, values)
}
