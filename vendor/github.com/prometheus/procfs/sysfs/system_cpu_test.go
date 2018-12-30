// Copyright 2018 The Prometheus Authors
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

// +build !windows

package sysfs

import (
	"reflect"
	"testing"
)

func TestNewSystemCpufreq(t *testing.T) {
	fs, err := NewFS("fixtures")
	if err != nil {
		t.Fatal(err)
	}

	c, err := fs.NewSystemCpufreq()
	if err != nil {
		t.Fatal(err)
	}

	systemCpufreq := []SystemCPUCpufreqStats{
		// Ubuntu 16.04 (4.15.0-20-generic), has `scaling_cur_freq` file.
		{
			Name:               "0",
			CurrentFrequency:   1219917,
			MinimumFrequency:   800000,
			MaximumFrequency:   2400000,
			TransitionLatency:  0,
			AvailableGovernors: "performance powersave",
			Driver:             "intel_pstate",
			Govenor:            "powersave",
			RelatedCpus:        "0",
			SetSpeed:           "<unsupported>",
		},
		// RHEL 7.3 (3.10.0-514.26.2.el7), missing `scaling_cur_freq` file.
		{
			Name:               "1",
			CurrentFrequency:   1200195,
			MinimumFrequency:   1200000,
			MaximumFrequency:   3300000,
			TransitionLatency:  4294967295,
			AvailableGovernors: "performance powersave",
			Driver:             "intel_pstate",
			Govenor:            "powersave",
			RelatedCpus:        "1",
			SetSpeed:           "<unsupported>",
		},
	}

	if !reflect.DeepEqual(systemCpufreq, c) {
		t.Errorf("Result not correct: want %v, have %v", systemCpufreq, c)
	}
}
