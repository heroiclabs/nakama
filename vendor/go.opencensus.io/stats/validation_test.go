// Copyright 2017, OpenCensus Authors
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

package stats

import (
	"strings"
	"testing"
)

func Test_checkViewName(t *testing.T) {
	tests := []struct {
		name    string
		view    string
		wantErr bool
	}{
		{
			name:    "valid view name",
			view:    "my.org/views/response_size",
			wantErr: false,
		},
		{
			name:    "long name",
			view:    strings.Repeat("a", 256),
			wantErr: true,
		},
		{
			name:    "name with non-ASCII",
			view:    "my.org/views/\007",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := checkViewName(tt.view); (err != nil) != tt.wantErr {
				t.Errorf("checkViewName() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestCheckMeasureName(t *testing.T) {
	tests := []struct {
		name    string
		view    string
		wantErr bool
	}{
		{
			name:    "valid measure name",
			view:    "my.org/measures/response_size",
			wantErr: false,
		},
		{
			name:    "long name",
			view:    strings.Repeat("a", 256),
			wantErr: true,
		},
		{
			name:    "name with non-ASCII",
			view:    "my.org/measures/\007",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := checkMeasureName(tt.view); (err != nil) != tt.wantErr {
				t.Errorf("checkMeasureName() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
