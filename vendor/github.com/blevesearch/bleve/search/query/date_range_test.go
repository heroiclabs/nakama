//  Copyright (c) 2016 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package query

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBleveQueryTime(t *testing.T) {
	testTimes := []time.Time{
		time.Now(),
		time.Time{},
	}

	for i, testTime := range testTimes {
		bqt := &BleveQueryTime{testTime}

		buf, err := json.Marshal(bqt)
		if err != nil {
			t.Errorf("expected no err")
		}

		var bqt2 BleveQueryTime
		err = json.Unmarshal(buf, &bqt2)
		if err != nil {
			t.Errorf("expected no unmarshal err, got: %v", err)
		}

		if bqt.Time.Format(time.RFC3339) != bqt2.Time.Format(time.RFC3339) {
			t.Errorf("test %d - expected same time, %#v != %#v", i, bqt.Time, bqt2.Time)
		}

		if testTime.Format(time.RFC3339) != bqt2.Time.Format(time.RFC3339) {
			t.Errorf("test %d - expected orig time, %#v != %#v", i, testTime, bqt2.Time)
		}
	}
}
