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

package trace

import "testing"
import "reflect"

func TestSetDefaultSampler(t *testing.T) {
	tests := []struct {
		name    string
		sampler Sampler
		want    Sampler
	}{
		{
			name:    "when the sampler is set to nil, the default sampler should be used",
			sampler: nil,
			want:    ProbabilitySampler(defaultSamplingProbability),
		},
		{
			name:    "setting a NeverSample updates the sampler",
			sampler: NeverSample(),
			want:    NeverSample(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			SetDefaultSampler(tt.sampler)
			if !reflect.DeepEqual(defaultSampler, tt.want) {
				t.Errorf("%q. SetDefaultSampler() = %v, want %v", tt.name, defaultSampler, tt.want)
			}
			SetDefaultSampler(nil) // Need to reset the sampler between each test
		})
	}
}
