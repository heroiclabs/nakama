// Copyright 2018, OpenCensus Authors
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

package jaeger

import (
	"fmt"
	"testing"
)

// TODO(jbd): Test export.

func Test_bytesToInt64(t *testing.T) {
	type args struct {
	}
	tests := []struct {
		buf  []byte
		want int64
	}{
		{
			buf:  []byte{255, 0, 0, 0, 0, 0, 0, 0},
			want: -72057594037927936,
		},
		{
			buf:  []byte{0, 0, 0, 0, 0, 0, 0, 1},
			want: 1,
		},
		{
			buf:  []byte{0, 0, 0, 0, 0, 0, 0, 0},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("%d", tt.want), func(t *testing.T) {
			if got := bytesToInt64(tt.buf); got != tt.want {
				t.Errorf("bytesToInt64() = %v, want %v", got, tt.want)
			}
		})
	}
}
