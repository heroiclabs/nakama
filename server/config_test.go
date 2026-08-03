// Copyright 2026 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"go.uber.org/zap"
)

func TestParseArgsGoogleAuthClientIDs(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(configPath, []byte("google_auth:\n  client_ids:\n    - yaml-web-client\n    - yaml-mobile-client\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	config := ParseArgs(zap.NewNop(), []string{"nakama", "--config", configPath})
	if got, want := config.GetGoogleAuth().ClientIDs, []string{"yaml-web-client", "yaml-mobile-client"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected Google client IDs loaded from YAML: got %v, want %v", got, want)
	}

	config = ParseArgs(zap.NewNop(), []string{
		"nakama",
		"--config", configPath,
		"--google_auth.client_ids", "cli-web-client",
		"--google_auth.client_ids", "cli-mobile-client",
	})
	if got, want := config.GetGoogleAuth().ClientIDs, []string{"cli-web-client", "cli-mobile-client"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected Google client IDs loaded from command line: got %v, want %v", got, want)
	}
}

func TestGoogleAuthConfigCloneCopiesClientIDs(t *testing.T) {
	config := &GoogleAuthConfig{ClientIDs: []string{"web-client", "mobile-client"}}
	clone := config.Clone()
	clone.ClientIDs[0] = "changed-client"

	if got, want := config.ClientIDs[0], "web-client"; got != want {
		t.Fatalf("clone changed the source Google client IDs: got %q, want %q", got, want)
	}
}
