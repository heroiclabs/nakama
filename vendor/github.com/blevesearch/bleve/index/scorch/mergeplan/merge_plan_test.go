//  Copyright (c) 2017 Couchbase, Inc.
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

package mergeplan

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"reflect"
	"sort"
	"testing"
	"time"
)

// Implements the Segment interface for testing,
type segment struct {
	MyId       uint64
	MyFullSize int64
	MyLiveSize int64
}

func (s *segment) Id() uint64      { return s.MyId }
func (s *segment) FullSize() int64 { return s.MyFullSize }
func (s *segment) LiveSize() int64 { return s.MyLiveSize }

func makeLinearSegments(n int) (rv []Segment) {
	for i := 0; i < n; i++ {
		rv = append(rv, &segment{
			MyId:       uint64(i),
			MyFullSize: int64(i),
			MyLiveSize: int64(i),
		})
	}
	return rv
}

// ----------------------------------------

func TestSimplePlan(t *testing.T) {
	segs := makeLinearSegments(10)

	tests := []struct {
		Desc       string
		Segments   []Segment
		Options    *MergePlanOptions
		ExpectPlan *MergePlan
		ExpectErr  error
	}{
		{"nil segments",
			nil, nil, nil, nil},
		{"empty segments",
			[]Segment{}, nil, nil, nil},
		{"1 segment",
			[]Segment{segs[1]},
			nil,
			nil,
			nil,
		},
		{"2 segments",
			[]Segment{
				segs[1],
				segs[2],
			},
			nil,
			&MergePlan{
				Tasks: []*MergeTask{
					&MergeTask{
						Segments: []Segment{
							segs[2],
							segs[1],
						},
					},
				},
			},
			nil,
		},
		{"3 segments",
			[]Segment{
				segs[1],
				segs[2],
				segs[9],
			},
			nil,
			&MergePlan{
				Tasks: []*MergeTask{
					&MergeTask{
						Segments: []Segment{
							segs[9],
							segs[2],
							segs[1],
						},
					},
				},
			},
			nil,
		},
		{"many segments",
			[]Segment{
				segs[1],
				segs[2],
				segs[3],
				segs[4],
				segs[5],
				segs[6],
			},
			&MergePlanOptions{
				MaxSegmentsPerTier:   1,
				MaxSegmentSize:       1000,
				TierGrowth:           2.0,
				SegmentsPerMergeTask: 2,
				FloorSegmentSize:     1,
			},
			&MergePlan{
				Tasks: []*MergeTask{
					&MergeTask{
						Segments: []Segment{
							segs[6],
							segs[5],
						},
					},
				},
			},
			nil,
		},
	}

	for testi, test := range tests {
		plan, err := Plan(test.Segments, test.Options)
		if err != test.ExpectErr {
			testj, _ := json.Marshal(&test)
			t.Errorf("testi: %d, test: %s, got err: %v",
				testi, testj, err)
		}
		if !reflect.DeepEqual(plan, test.ExpectPlan) {
			testj, _ := json.Marshal(&test)
			planj, _ := json.Marshal(&plan)
			t.Errorf("testi: %d, test: %s, got plan: %s",
				testi, testj, planj)
		}
	}
}

// ----------------------------------------

func TestSort(t *testing.T) {
	segs := makeLinearSegments(10)

	sort.Sort(byLiveSizeDescending(segs))

	for i := 1; i < len(segs); i++ {
		if segs[i].LiveSize() >= segs[i-1].LiveSize() {
			t.Errorf("not descending")
		}
	}
}

// ----------------------------------------

func TestCalcBudget(t *testing.T) {
	tests := []struct {
		totalSize     int64
		firstTierSize int64
		o             MergePlanOptions
		expect        int
	}{
		{0, 0, MergePlanOptions{}, 0},
		{1, 0, MergePlanOptions{}, 1},
		{9, 0, MergePlanOptions{}, 9},
		{1, 1,
			MergePlanOptions{
				MaxSegmentsPerTier:   1,
				MaxSegmentSize:       1000,
				TierGrowth:           2.0,
				SegmentsPerMergeTask: 2,
				FloorSegmentSize:     1,
			},
			1,
		},
		{21, 1,
			MergePlanOptions{
				MaxSegmentsPerTier:   1,
				MaxSegmentSize:       1000,
				TierGrowth:           2.0,
				SegmentsPerMergeTask: 2,
				FloorSegmentSize:     1,
			},
			5,
		},
		{21, 1,
			MergePlanOptions{
				MaxSegmentsPerTier:   2,
				MaxSegmentSize:       1000,
				TierGrowth:           2.0,
				SegmentsPerMergeTask: 2,
				FloorSegmentSize:     1,
			},
			7,
		},
		{1000, 2000, DefaultMergePlanOptions,
			1},
		{5000, 2000, DefaultMergePlanOptions,
			3},
		{10000, 2000, DefaultMergePlanOptions,
			5},
		{30000, 2000, DefaultMergePlanOptions,
			11},
		{1000000, 2000, DefaultMergePlanOptions,
			24},
		{1000000000, 2000, DefaultMergePlanOptions,
			54},
	}

	for testi, test := range tests {
		res := CalcBudget(test.totalSize, test.firstTierSize, &test.o)
		if res != test.expect {
			t.Errorf("testi: %d, test: %#v, res: %v",
				testi, test, res)
		}
	}
}

// ----------------------------------------

func TestInsert1SameSizedSegmentBetweenMerges(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1000,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}

	spec := testCyclesSpec{
		descrip: "i1sssbm",
		verbose: os.Getenv("VERBOSE") == "i1sssbm" || os.Getenv("VERBOSE") == "y",
		n:       200,
		o:       o,
		beforePlan: func(spec *testCyclesSpec) {
			spec.segments = append(spec.segments, &segment{
				MyId:       spec.nextSegmentId,
				MyFullSize: 1,
				MyLiveSize: 1,
			})
			spec.nextSegmentId++
		},
	}

	spec.runCycles(t)
}

func TestInsertManySameSizedSegmentsBetweenMerges(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1000,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}

	spec := testCyclesSpec{
		descrip: "imsssbm",
		verbose: os.Getenv("VERBOSE") == "imsssbm" || os.Getenv("VERBOSE") == "y",
		n:       20,
		o:       o,
		beforePlan: func(spec *testCyclesSpec) {
			for i := 0; i < 10; i++ {
				spec.segments = append(spec.segments, &segment{
					MyId:       spec.nextSegmentId,
					MyFullSize: 1,
					MyLiveSize: 1,
				})
				spec.nextSegmentId++
			}
		},
	}

	spec.runCycles(t)
}

func TestInsertManySameSizedSegmentsWithDeletionsBetweenMerges(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1000,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}

	spec := testCyclesSpec{
		descrip: "imssswdbm",
		verbose: os.Getenv("VERBOSE") == "imssswdbm" || os.Getenv("VERBOSE") == "y",
		n:       20,
		o:       o,
		beforePlan: func(spec *testCyclesSpec) {
			for i := 0; i < 10; i++ {
				// Deletions are a shrinking of the live size.
				for i, seg := range spec.segments {
					if (spec.cycle+i)%5 == 0 {
						s := seg.(*segment)
						if s.MyLiveSize > 0 {
							s.MyLiveSize -= 1
						}
					}
				}

				spec.segments = append(spec.segments, &segment{
					MyId:       spec.nextSegmentId,
					MyFullSize: 1,
					MyLiveSize: 1,
				})
				spec.nextSegmentId++
			}
		},
	}

	spec.runCycles(t)
}

func TestInsertManyDifferentSizedSegmentsBetweenMerges(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1000,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}

	spec := testCyclesSpec{
		descrip: "imdssbm",
		verbose: os.Getenv("VERBOSE") == "imdssbm" || os.Getenv("VERBOSE") == "y",
		n:       20,
		o:       o,
		beforePlan: func(spec *testCyclesSpec) {
			for i := 0; i < 10; i++ {
				spec.segments = append(spec.segments, &segment{
					MyId:       spec.nextSegmentId,
					MyFullSize: int64(1 + (i % 5)),
					MyLiveSize: int64(1 + (i % 5)),
				})
				spec.nextSegmentId++
			}
		},
	}

	spec.runCycles(t)
}

func TestManySameSizedSegmentsWithDeletesBetweenMerges(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1000,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}

	var numPlansWithTasks int

	spec := testCyclesSpec{
		descrip: "mssswdbm",
		verbose: os.Getenv("VERBOSE") == "mssswdbm" || os.Getenv("VERBOSE") == "y",
		n:       20,
		o:       o,
		beforePlan: func(spec *testCyclesSpec) {
			// Deletions are a shrinking of the live size.
			for i, seg := range spec.segments {
				if (spec.cycle+i)%5 == 0 {
					s := seg.(*segment)
					if s.MyLiveSize > 0 {
						s.MyLiveSize -= 1
					}
				}
			}

			for i := 0; i < 10; i++ {
				spec.segments = append(spec.segments, &segment{
					MyId:       spec.nextSegmentId,
					MyFullSize: 1,
					MyLiveSize: 1,
				})
				spec.nextSegmentId++
			}
		},
		afterPlan: func(spec *testCyclesSpec, plan *MergePlan) {
			if plan != nil && len(plan.Tasks) > 0 {
				numPlansWithTasks++
			}
		},
	}

	spec.runCycles(t)

	if numPlansWithTasks <= 0 {
		t.Errorf("expected some plans with tasks")
	}
}

func TestValidateMergePlannerOptions(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       1 << 32,
		MaxSegmentsPerTier:   3,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 3,
	}
	err := ValidateMergePlannerOptions(o)
	if err != ErrMaxSegmentSizeTooLarge {
		t.Error("Validation expected to fail as the MaxSegmentSize exceeds limit")
	}
}

func TestPlanMaxSegmentSizeLimit(t *testing.T) {
	o := &MergePlanOptions{
		MaxSegmentSize:       20,
		MaxSegmentsPerTier:   5,
		TierGrowth:           3.0,
		SegmentsPerMergeTask: 5,
		FloorSegmentSize:     5,
	}
	segments := makeLinearSegments(20)

	s := rand.NewSource(time.Now().UnixNano())
	r := rand.New(s)

	max := 20
	min := 5
	randomInRange := func() int64 {
		return int64(r.Intn(max-min) + min)
	}
	for i := 1; i < 20; i++ {
		o.MaxSegmentSize = randomInRange()
		plans, err := Plan(segments, o)
		if err != nil {
			t.Errorf("Plan failed, err: %v", err)
		}
		if len(plans.Tasks) == 0 {
			t.Errorf("expected some plans with tasks")
		}

		for _, task := range plans.Tasks {
			var totalLiveSize int64
			for _, segs := range task.Segments {
				totalLiveSize += segs.LiveSize()

			}
			if totalLiveSize >= o.MaxSegmentSize {
				t.Errorf("merged segments size: %d exceeding the MaxSegmentSize"+
					"limit: %d", totalLiveSize, o.MaxSegmentSize)
			}
		}
	}

}

// ----------------------------------------

type testCyclesSpec struct {
	descrip string
	verbose bool

	n int // Number of cycles to run.
	o *MergePlanOptions

	beforePlan func(*testCyclesSpec)
	afterPlan  func(*testCyclesSpec, *MergePlan)

	cycle         int
	segments      []Segment
	nextSegmentId uint64
}

func (spec *testCyclesSpec) runCycles(t *testing.T) {
	numPlansWithTasks := 0

	for spec.cycle < spec.n {
		if spec.verbose {
			emit(spec.descrip, spec.cycle, 0, spec.segments, nil)
		}

		if spec.beforePlan != nil {
			spec.beforePlan(spec)
		}

		if spec.verbose {
			emit(spec.descrip, spec.cycle, 1, spec.segments, nil)
		}

		plan, err := Plan(spec.segments, spec.o)
		if err != nil {
			t.Fatalf("expected no err, got: %v", err)
		}

		if spec.afterPlan != nil {
			spec.afterPlan(spec, plan)
		}

		if spec.verbose {
			emit(spec.descrip, spec.cycle, 2, spec.segments, plan)
		}

		if plan != nil {
			if len(plan.Tasks) > 0 {
				numPlansWithTasks++
			}

			for _, task := range plan.Tasks {
				spec.segments = removeSegments(spec.segments, task.Segments)

				var totLiveSize int64
				for _, segment := range task.Segments {
					totLiveSize += segment.LiveSize()
				}

				if totLiveSize > 0 {
					spec.segments = append(spec.segments, &segment{
						MyId:       spec.nextSegmentId,
						MyFullSize: totLiveSize,
						MyLiveSize: totLiveSize,
					})
					spec.nextSegmentId++
				}
			}
		}

		spec.cycle++
	}

	if numPlansWithTasks <= 0 {
		t.Errorf("expected some plans with tasks")
	}
}

func emit(descrip string, cycle int, step int, segments []Segment, plan *MergePlan) {
	if os.Getenv("VERBOSE") == "" {
		return
	}

	suffix := ""
	if plan != nil && len(plan.Tasks) > 0 {
		suffix = "hasPlan"
	}

	fmt.Printf("%s %d.%d ---------- %s\n", descrip, cycle, step, suffix)
	fmt.Printf("%s\n", ToBarChart(descrip, 100, segments, plan))
}
