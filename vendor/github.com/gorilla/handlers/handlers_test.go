// Copyright 2013 The Gorilla Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handlers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const (
	ok         = "ok\n"
	notAllowed = "Method not allowed\n"
)

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
	w.Write([]byte(ok))
})

func newRequest(method, url string) *http.Request {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		panic(err)
	}
	return req
}

func TestMethodHandler(t *testing.T) {
	tests := []struct {
		req     *http.Request
		handler http.Handler
		code    int
		allow   string // Contents of the Allow header
		body    string
	}{
		// No handlers
		{newRequest("GET", "/foo"), MethodHandler{}, http.StatusMethodNotAllowed, "", notAllowed},
		{newRequest("OPTIONS", "/foo"), MethodHandler{}, http.StatusOK, "", ""},

		// A single handler
		{newRequest("GET", "/foo"), MethodHandler{"GET": okHandler}, http.StatusOK, "", ok},
		{newRequest("POST", "/foo"), MethodHandler{"GET": okHandler}, http.StatusMethodNotAllowed, "GET", notAllowed},

		// Multiple handlers
		{newRequest("GET", "/foo"), MethodHandler{"GET": okHandler, "POST": okHandler}, http.StatusOK, "", ok},
		{newRequest("POST", "/foo"), MethodHandler{"GET": okHandler, "POST": okHandler}, http.StatusOK, "", ok},
		{newRequest("DELETE", "/foo"), MethodHandler{"GET": okHandler, "POST": okHandler}, http.StatusMethodNotAllowed, "GET, POST", notAllowed},
		{newRequest("OPTIONS", "/foo"), MethodHandler{"GET": okHandler, "POST": okHandler}, http.StatusOK, "GET, POST", ""},

		// Override OPTIONS
		{newRequest("OPTIONS", "/foo"), MethodHandler{"OPTIONS": okHandler}, http.StatusOK, "", ok},
	}

	for i, test := range tests {
		rec := httptest.NewRecorder()
		test.handler.ServeHTTP(rec, test.req)
		if rec.Code != test.code {
			t.Fatalf("%d: wrong code, got %d want %d", i, rec.Code, test.code)
		}
		if allow := rec.HeaderMap.Get("Allow"); allow != test.allow {
			t.Fatalf("%d: wrong Allow, got %s want %s", i, allow, test.allow)
		}
		if body := rec.Body.String(); body != test.body {
			t.Fatalf("%d: wrong body, got %q want %q", i, body, test.body)
		}
	}
}

func TestContentTypeHandler(t *testing.T) {
	tests := []struct {
		Method            string
		AllowContentTypes []string
		ContentType       string
		Code              int
	}{
		{"POST", []string{"application/json"}, "application/json", http.StatusOK},
		{"POST", []string{"application/json", "application/xml"}, "application/json", http.StatusOK},
		{"POST", []string{"application/json"}, "application/json; charset=utf-8", http.StatusOK},
		{"POST", []string{"application/json"}, "application/json+xxx", http.StatusUnsupportedMediaType},
		{"POST", []string{"application/json"}, "text/plain", http.StatusUnsupportedMediaType},
		{"GET", []string{"application/json"}, "", http.StatusOK},
		{"GET", []string{}, "", http.StatusOK},
	}
	for _, test := range tests {
		r, err := http.NewRequest(test.Method, "/", nil)
		if err != nil {
			t.Error(err)
			continue
		}

		h := ContentTypeHandler(okHandler, test.AllowContentTypes...)
		r.Header.Set("Content-Type", test.ContentType)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != test.Code {
			t.Errorf("expected %d, got %d", test.Code, w.Code)
		}
	}
}

func TestHTTPMethodOverride(t *testing.T) {
	var tests = []struct {
		Method         string
		OverrideMethod string
		ExpectedMethod string
	}{
		{"POST", "PUT", "PUT"},
		{"POST", "PATCH", "PATCH"},
		{"POST", "DELETE", "DELETE"},
		{"PUT", "DELETE", "PUT"},
		{"GET", "GET", "GET"},
		{"HEAD", "HEAD", "HEAD"},
		{"GET", "PUT", "GET"},
		{"HEAD", "DELETE", "HEAD"},
	}

	for _, test := range tests {
		h := HTTPMethodOverrideHandler(okHandler)
		reqs := make([]*http.Request, 0, 2)

		rHeader, err := http.NewRequest(test.Method, "/", nil)
		if err != nil {
			t.Error(err)
		}
		rHeader.Header.Set(HTTPMethodOverrideHeader, test.OverrideMethod)
		reqs = append(reqs, rHeader)

		f := url.Values{HTTPMethodOverrideFormKey: []string{test.OverrideMethod}}
		rForm, err := http.NewRequest(test.Method, "/", strings.NewReader(f.Encode()))
		if err != nil {
			t.Error(err)
		}
		rForm.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		reqs = append(reqs, rForm)

		for _, r := range reqs {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if r.Method != test.ExpectedMethod {
				t.Errorf("Expected %s, got %s", test.ExpectedMethod, r.Method)
			}
		}
	}
}
