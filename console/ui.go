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
	"path"
)

//go:embed ui/dist/*
var embedFS embed.FS
var UIFS = &uiFS{}

type uiFS struct {
	Nt bool
}

func (fs *uiFS) Open(name string) (fs.File, error) {
	if fs.Nt {
		return embedFS.Open(path.Join("ui", "dist", "prod-nt", name))
	}
	return embedFS.Open(path.Join("ui", "dist", "prod", name))
}

var UI = http.FileServer(http.FS(UIFS))
