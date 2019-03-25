// Copyright 2019 The Nakama Authors
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
	"fmt"
	"go.uber.org/zap"
	"io/ioutil"
	"net/http"
)

func (s *ConsoleServer) importStorage(w http.ResponseWriter, r *http.Request) {
	// Check authentication.
	auth := r.Header.Get("authorization")
	if len(auth) == 0 {
		w.WriteHeader(401)
		if _, err := w.Write([]byte("Console authentication required.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}
	if !checkAuth(s.config, auth) {
		w.WriteHeader(401)
		if _, err := w.Write([]byte("Console authentication invalid.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Parse multipart form request data.
	if err := r.ParseMultipartForm(10485760); err != nil {
		s.logger.Error("Error parsing storage import form", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error parsing form data.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Find the name of the uploaded file.
	var filename string
	for n, _ := range r.MultipartForm.File {
		filename = n
		break
	}
	if filename == "" {
		s.logger.Warn("Could not find file in storage import multipart form")

		w.WriteHeader(400)
		if _, err := w.Write([]byte("No file was uploaded.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Open the uploaded file.
	file, _, err := r.FormFile(filename)
	if err != nil {
		s.logger.Error("Error opening storage import file", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error opening uploaded file.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}
	defer file.Close()

	// Fully read the file contents.
	fileBytes, err := ioutil.ReadAll(file)
	if err != nil {
		s.logger.Error("Error opening storage import file", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error opening uploaded file.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Examine contents to determine if it's a JSON or CSV import.
	mimeType := http.DetectContentType(fileBytes)
	switch mimeType {
	case "application/json":
	case "text/csv":
	default:
		s.logger.Warn("Unsupported MIME type in storage import multipart form", zap.String("type", mimeType))

		w.WriteHeader(400)
		if _, err := w.Write([]byte(fmt.Sprintf("Unsupported MIME type '%v', must be 'application/json' or 'text/csv'.", mimeType))); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// TODO process `fileBytes` based on MIME type
}
