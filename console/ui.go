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

package console

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
)

//go:embed ui/dist/*
var embedFS embed.FS
var UIFS = &uiFS{}

type uiFS struct {
	Nt bool
}

func (fs *uiFS) Open(name string) (fs.File, error) {
	f, err := embedFS.Open(path.Join("ui", "dist", name))
	if err != nil {
		return nil, err
	}

	// Check if the request is attempting a directory listing.
	s, err := f.Stat()
	if err != nil {
		// Close the directory file handle to prevent leaks.
		_ = f.Close()
		return nil, err
	}
	if s.IsDir() {
		// Check if an index.html exists inside this directory, otherwise reject the directory listing.
		checkF, err := embedFS.Open(path.Join("ui", "dist", name, "index.html"))
		if err != nil {
			// Close the directory file handle to prevent leaks.
			_ = f.Close()
			// os.ErrNotExist maps to HTTP 404 Not Found.
			return nil, os.ErrNotExist
		}
		_ = checkF.Close()
	}

	return f, nil
}

var UI = http.FileServer(http.FS(UIFS))
