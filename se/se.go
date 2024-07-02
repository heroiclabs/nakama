// Copyright 2024 The Nakama Authors
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

package se

import (
	"bytes"
	"encoding/json"
	"net/http"
	"runtime"
	"time"
)

type seEvent struct {
	Type    string                 `json:"type,omitempty"`
	UserID  string                 `json:"userId,omitempty"`
	Event   string                 `json:"event,omitempty"`
	Context map[string]interface{} `json:"context,omitempty"`
	App     map[string]interface{} `json:"app,omitempty"`
	Os      map[string]interface{} `json:"os,omitempty"`
}

type seBatch struct {
	Batch []*seEvent `json:"batch,omitempty"`
}

const seURL = "https://api.segment.io/v1/batch"

var client = &http.Client{
	Timeout: 5000 * time.Millisecond,
}

func Start(key, id, version, variant string) error {
	events := []*seEvent{
		{
			Type:   "identify",
			UserID: id,
			Context: map[string]interface{}{
				"direct": true,
				"library": map[string]interface{}{
					"name":    "go",
					"version": runtime.Version(),
				},
			},
		},
		{
			Type:   "track",
			UserID: id,
			Event:  "start",
			Context: map[string]interface{}{
				"direct": true,
				"library": map[string]interface{}{
					"name":    "go",
					"version": runtime.Version(),
				},
			},
			App: map[string]interface{}{
				"version": version,
				"name":    variant,
			},
			Os: map[string]interface{}{
				"name":    runtime.GOOS,
				"version": runtime.GOARCH,
			},
		},
	}
	return send(key, events)
}

func End(key, id string) error {
	events := []*seEvent{
		{
			Type:   "track",
			UserID: id,
			Event:  "end",
			Context: map[string]interface{}{
				"direct": true,
				"library": map[string]interface{}{
					"name":    "go",
					"version": runtime.Version(),
				},
			},
		},
	}
	return send(key, events)
}

func send(key string, events []*seEvent) error {
	batch := &seBatch{
		Batch: events,
	}
	body, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, seURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(key, "")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	if resp.Body != nil {
		_ = resp.Body.Close()
	}

	return nil
}
