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
//

package stats

import (
	"context"
	"testing"
	"time"

	"go.opencensus.io/tag"
)

func Test_View_MeasureFloat64_AggregationDistribution_WindowCumulative(t *testing.T) {
	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")
	k3, _ := tag.NewKey("k3")
	agg1 := DistributionAggregation([]float64{2})
	view, err := NewView("VF1", "desc VF1", []tag.Key{k1, k2}, nil, agg1, Cumulative{})
	if err != nil {
		t.Fatal(err)
	}

	type tagString struct {
		k tag.Key
		v string
	}
	type record struct {
		f    float64
		tags []tagString
	}

	type testCase struct {
		label    string
		records  []record
		wantRows []*Row
	}

	tcs := []testCase{
		{
			"1",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					&DistributionData{
						2, 1, 5, 3, 8, []int64{1, 1}, agg1,
					},
				},
			},
		},
		{
			"2",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					&DistributionData{
						1, 1, 1, 1, 0, []int64{1, 0}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					&DistributionData{
						1, 5, 5, 5, 0, []int64{0, 1}, agg1,
					},
				},
			},
		},
		{
			"3",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}, {k3, "v3"}}},
				{1, []tagString{{k1, "v1 other"}}},
				{5, []tagString{{k2, "v2"}}},
				{5, []tagString{{k1, "v1"}, {k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					&DistributionData{
						2, 1, 5, 3, 8, []int64{1, 1}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1 other"}},
					&DistributionData{
						1, 1, 1, 1, 0, []int64{1, 0}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					&DistributionData{
						1, 5, 5, 5, 0, []int64{0, 1}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1"}, {Key: k2, Value: "v2"}},
					&DistributionData{
						1, 5, 5, 5, 0, []int64{0, 1}, agg1,
					},
				},
			},
		},
		{
			"4",
			[]record{
				{1, []tagString{{k1, "v1 is a very long value key"}}},
				{5, []tagString{{k1, "v1 is a very long value key"}, {k3, "v3"}}},
				{1, []tagString{{k1, "v1 is another very long value key"}}},
				{1, []tagString{{k1, "v1 is a very long value key"}, {k2, "v2 is a very long value key"}}},
				{5, []tagString{{k1, "v1 is a very long value key"}, {k2, "v2 is a very long value key"}}},
				{3, []tagString{{k1, "v1 is a very long value key"}, {k2, "v2 is a very long value key"}}},
				{3, []tagString{{k1, "v1 is a very long value key"}, {k2, "v2 is a very long value key"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1 is a very long value key"}},
					&DistributionData{
						2, 1, 5, 3, 8, []int64{1, 1}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1 is another very long value key"}},
					&DistributionData{
						1, 1, 1, 1, 0, []int64{1, 0}, agg1,
					},
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1 is a very long value key"}, {Key: k2, Value: "v2 is a very long value key"}},
					&DistributionData{
						4, 1, 5, 3, 2.66666666666667 * 3, []int64{1, 3}, agg1,
					},
				},
			},
		},
	}

	for _, tc := range tcs {
		view.clearRows()
		view.subscribe()
		for _, r := range tc.records {
			mods := []tag.Mutator{}
			for _, t := range r.tags {
				mods = append(mods, tag.Insert(t.k, t.v))
			}
			ts, err := tag.NewMap(context.Background(), mods...)
			if err != nil {
				t.Errorf("%v: NewMap = %v", tc.label, err)
			}
			view.addSample(ts, r.f, time.Now())
		}

		gotRows := view.collectedRows(time.Now())
		for i, got := range gotRows {
			if !containsRow(tc.wantRows, got) {
				t.Errorf("%v-%d: got row %v; want none", tc.label, i, got)
				break
			}
		}

		for i, want := range tc.wantRows {
			if !containsRow(gotRows, want) {
				t.Errorf("%v-%d: got none; want row %v", tc.label, i, want)
				break
			}
		}
	}
}

func Test_View_MeasureFloat64_AggregationDistribution_WindowSlidingTime(t *testing.T) {
	startTime := time.Date(2010, 1, 1, 0, 0, 0, 0, time.UTC)

	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")
	agg1 := DistributionAggregation([]float64{2})
	view, err := NewView("VF1", "desc VF1", []tag.Key{k1, k2}, nil, agg1, Interval{10 * time.Second, 5})
	if err != nil {
		t.Fatal(err)
	}

	type tagString struct {
		k tag.Key
		v string
	}
	type record struct {
		f    float64
		tags []tagString
		now  time.Time
	}

	type wantRows struct {
		label        string
		retrieveTime time.Time
		rows         []*Row
	}

	type testCase struct {
		label    string
		records  []record
		wantRows []wantRows
	}

	tcs := []testCase{
		{
			"1",
			[]record{
				{1, []tagString{{k1, "v1"}}, startTime.Add(1 * time.Second)},
				{2, []tagString{{k1, "v1"}}, startTime.Add(6 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(6 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(10 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(10 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(14 * time.Second)},
				{3, []tagString{{k1, "v1"}}, startTime.Add(14 * time.Second)},
			},
			[]wantRows{
				{
					"last 6 recorded",
					startTime.Add(14 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								6, 2, 5, 3.8333333333, 1.3666666667 * 5, []int64{0, 6}, agg1,
							},
						},
					},
				},
				{
					"last 4 recorded",
					startTime.Add(18 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								4, 3, 5, 4, 0.6666666667 * 3, []int64{0, 4}, agg1,
							},
						},
					},
				},
				{
					"last 2 recorded",
					startTime.Add(22 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								2, 3, 4, 3.5, 0.5, []int64{0, 2}, agg1,
							},
						},
					},
				},
			},
		},
		{
			"2",
			[]record{
				{1, []tagString{{k1, "v1"}}, startTime.Add(3 * time.Second)},
				{2, []tagString{{k1, "v1"}}, startTime.Add(5 * time.Second)},
				{3, []tagString{{k1, "v1"}}, startTime.Add(5 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(9 * time.Second)},
			},
			[]wantRows{
				{
					"no partial bucket",
					startTime.Add(10 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								7, 1, 5, 3.57142857142857, 2.61904761904762 * 6, []int64{1, 6}, agg1,
							},
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 50%)",
					startTime.Add(12 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								7, 1, 5, 3.57142857142857, 2.61904761904762 * 6, []int64{1, 6}, agg1,
							},
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 99.99%)",
					startTime.Add(15 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								6, 2, 5, 4, 1.6 * 5, []int64{0, 6}, agg1,
							},
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 0.001%)",
					startTime.Add(17*time.Second - 1*time.Millisecond),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								6, 2, 5, 4, 1.6 * 5, []int64{0, 6}, agg1,
							},
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 50%)",
					startTime.Add(18 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							&DistributionData{
								4, 4, 5, 4.75, 0.25 * 3, []int64{0, 4}, agg1,
							},
						},
					},
				},
			},
		},
	}

	for _, tc := range tcs {
		view.clearRows()
		view.subscribe()
		for _, r := range tc.records {
			mods := []tag.Mutator{}
			for _, t := range r.tags {
				mods = append(mods, tag.Insert(t.k, t.v))
			}
			ts, err := tag.NewMap(context.Background(), mods...)
			if err != nil {
				t.Errorf("%v: NewMap = %v", tc.label, err)
			}
			view.addSample(ts, r.f, r.now)
		}

		for _, wantRows := range tc.wantRows {
			gotRows := view.collectedRows(wantRows.retrieveTime)

			for _, gotRow := range gotRows {
				if !containsRow(wantRows.rows, gotRow) {
					t.Errorf("got unexpected row '%v' for test case: '%v' with label '%v'", gotRow, tc.label, wantRows.label)
					break
				}
			}

			for _, wantRow := range wantRows.rows {
				if !containsRow(gotRows, wantRow) {
					t.Errorf("want row '%v' for test case: '%v' with label '%v'. Not received", wantRow, tc.label, wantRows.label)
					break
				}
			}
		}

	}
}

func Test_View_MeasureFloat64_AggregationCount_WindowSlidingTime(t *testing.T) {
	startTime := time.Date(2010, 1, 1, 0, 0, 0, 0, time.UTC)

	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")
	agg1 := CountAggregation{}
	view, err := NewView("VF1", "desc VF1", []tag.Key{k1, k2}, nil, agg1, Interval{10 * time.Second, 5})
	if err != nil {
		t.Fatal(err)
	}

	type tagString struct {
		k tag.Key
		v string
	}
	type record struct {
		f    float64
		tags []tagString
		now  time.Time
	}

	type wantRows struct {
		label        string
		retrieveTime time.Time
		rows         []*Row
	}

	type testCase struct {
		label    string
		records  []record
		wantRows []wantRows
	}

	tcs := []testCase{
		{
			"1",
			[]record{
				{1, []tagString{{k1, "v1"}}, startTime.Add(1 * time.Second)},
				{2, []tagString{{k1, "v1"}}, startTime.Add(6 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(6 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(10 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(10 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(14 * time.Second)},
				{3, []tagString{{k1, "v1"}}, startTime.Add(14 * time.Second)},
			},
			[]wantRows{
				{
					"last 6 recorded",
					startTime.Add(14 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(6),
						},
					},
				},
				{
					"last 4 recorded",
					startTime.Add(18 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(4),
						},
					},
				},
				{
					"last 2 recorded",
					startTime.Add(22 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(2),
						},
					},
				},
			},
		},
		{
			"2",
			[]record{
				{1, []tagString{{k1, "v1"}}, startTime.Add(3 * time.Second)},
				{2, []tagString{{k1, "v1"}}, startTime.Add(5 * time.Second)},
				{3, []tagString{{k1, "v1"}}, startTime.Add(5 * time.Second)},
				{4, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(8 * time.Second)},
				{5, []tagString{{k1, "v1"}}, startTime.Add(9 * time.Second)},
			},
			[]wantRows{
				{
					"no partial bucket",
					startTime.Add(10 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(7),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 50%) (count: 1)",
					startTime.Add(12 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(7),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 80%) (count: 2)",
					startTime.Add(15*time.Second + 400*time.Millisecond),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(6),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 50%) (count: 2)",
					startTime.Add(16 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(5),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 90%) (count: 3)",
					startTime.Add(17*time.Second + 200*time.Millisecond),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(4),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 50%) (count: 3)",
					startTime.Add(18 * time.Second),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(3),
						},
					},
				},
				{
					"oldest partial bucket: (remaining time: 20%) (count: 3)",
					startTime.Add(18*time.Second + 600*time.Millisecond),
					[]*Row{
						{
							[]tag.Tag{{Key: k1, Value: "v1"}},
							newCountData(2),
						},
					},
				},
			},
		},
	}

	for _, tc := range tcs {
		view.clearRows()
		view.subscribe()
		for _, r := range tc.records {
			mods := []tag.Mutator{}
			for _, t := range r.tags {
				mods = append(mods, tag.Insert(t.k, t.v))
			}
			ts, err := tag.NewMap(context.Background(), mods...)
			if err != nil {
				t.Errorf("%v: NewMap = %v", tc.label, err)
			}
			view.addSample(ts, r.f, r.now)
		}

		for _, wantRows := range tc.wantRows {
			gotRows := view.collectedRows(wantRows.retrieveTime)

			for _, gotRow := range gotRows {
				if !containsRow(wantRows.rows, gotRow) {
					t.Errorf("got unexpected row '%v' for test case: '%v' with label '%v'", gotRow, tc.label, wantRows.label)
					break
				}
			}

			for _, wantRow := range wantRows.rows {
				if !containsRow(gotRows, wantRow) {
					t.Errorf("want row '%v' for test case: '%v' with label '%v'. Not received", wantRow, tc.label, wantRows.label)
					break
				}
			}
		}

	}
}

func Test_View_MeasureFloat64_AggregationSum_WindowCumulative(t *testing.T) {
	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")
	k3, _ := tag.NewKey("k3")
	view, err := NewView("VF1", "desc VF1", []tag.Key{k1, k2}, nil, SumAggregation{}, Cumulative{})
	if err != nil {
		t.Fatal(err)
	}

	type tagString struct {
		k tag.Key
		v string
	}
	type record struct {
		f    float64
		tags []tagString
	}

	tcs := []struct {
		label    string
		records  []record
		wantRows []*Row
	}{
		{
			"1",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newSumData(6),
				},
			},
		},
		{
			"2",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newSumData(1),
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					newSumData(5),
				},
			},
		},
		{
			"3",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}, {k3, "v3"}}},
				{1, []tagString{{k1, "v1 other"}}},
				{5, []tagString{{k2, "v2"}}},
				{5, []tagString{{k1, "v1"}, {k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newSumData(6),
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1 other"}},
					newSumData(1),
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					newSumData(5),
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1"}, {Key: k2, Value: "v2"}},
					newSumData(5),
				},
			},
		},
	}

	for _, tt := range tcs {
		view.clearRows()
		view.subscribe()
		for _, r := range tt.records {
			mods := []tag.Mutator{}
			for _, t := range r.tags {
				mods = append(mods, tag.Insert(t.k, t.v))
			}
			ts, err := tag.NewMap(context.Background(), mods...)
			if err != nil {
				t.Errorf("%v: NewMap = %v", tt.label, err)
			}
			view.addSample(ts, r.f, time.Now())
		}

		gotRows := view.collectedRows(time.Now())
		for i, got := range gotRows {
			if !containsRow(tt.wantRows, got) {
				t.Errorf("%v-%d: got row %v; want none", tt.label, i, got)
				break
			}
		}

		for i, want := range tt.wantRows {
			if !containsRow(gotRows, want) {
				t.Errorf("%v-%d: got none; want row %v", tt.label, i, want)
				break
			}
		}
	}
}

func Test_View_MeasureFloat64_AggregationMean_WindowCumulative(t *testing.T) {
	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")
	k3, _ := tag.NewKey("k3")
	view, err := NewView("VF1", "desc VF1", []tag.Key{k1, k2}, nil, MeanAggregation{}, Cumulative{})
	if err != nil {
		t.Fatal(err)
	}

	type tagString struct {
		k tag.Key
		v string
	}
	type record struct {
		f    float64
		tags []tagString
	}

	tcs := []struct {
		label    string
		records  []record
		wantRows []*Row
	}{
		{
			"1",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newMeanData(3, 2),
				},
			},
		},
		{
			"2",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k2, "v2"}}},
				{-0.5, []tagString{{k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newMeanData(1, 1),
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					newMeanData(2.25, 2),
				},
			},
		},
		{
			"3",
			[]record{
				{1, []tagString{{k1, "v1"}}},
				{5, []tagString{{k1, "v1"}, {k3, "v3"}}},
				{1, []tagString{{k1, "v1 other"}}},
				{5, []tagString{{k2, "v2"}}},
				{5, []tagString{{k1, "v1"}, {k2, "v2"}}},
				{-4, []tagString{{k1, "v1"}, {k2, "v2"}}},
			},
			[]*Row{
				{
					[]tag.Tag{{Key: k1, Value: "v1"}},
					newMeanData(3, 2),
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1 other"}},
					newMeanData(1, 1),
				},
				{
					[]tag.Tag{{Key: k2, Value: "v2"}},
					newMeanData(5, 1),
				},
				{
					[]tag.Tag{{Key: k1, Value: "v1"}, {Key: k2, Value: "v2"}},
					newMeanData(0.5, 2),
				},
			},
		},
	}

	for _, tt := range tcs {
		view.clearRows()
		view.subscribe()
		for _, r := range tt.records {
			mods := []tag.Mutator{}
			for _, t := range r.tags {
				mods = append(mods, tag.Insert(t.k, t.v))
			}
			ts, err := tag.NewMap(context.Background(), mods...)
			if err != nil {
				t.Errorf("%v: NewMap = %v", tt.label, err)
			}
			view.addSample(ts, r.f, time.Now())
		}

		gotRows := view.collectedRows(time.Now())
		for i, got := range gotRows {
			if !containsRow(tt.wantRows, got) {
				t.Errorf("%v-%d: got row %v; want none", tt.label, i, got)
				break
			}
		}

		for i, want := range tt.wantRows {
			if !containsRow(gotRows, want) {
				t.Errorf("%v-%d: got none; want row %v", tt.label, i, want)
				break
			}
		}
	}
}

func TestViewSortedKeys(t *testing.T) {
	k1, _ := tag.NewKey("a")
	k2, _ := tag.NewKey("b")
	k3, _ := tag.NewKey("c")
	ks := []tag.Key{k1, k3, k2}

	v, err := NewView("sort_keys", "desc sort_keys", ks, nil, MeanAggregation{}, Cumulative{})
	if err != nil {
		t.Fatalf("NewView() = %v", err)
	}

	want := []string{"a", "b", "c"}
	vks := v.TagKeys()
	if len(vks) != len(want) {
		t.Errorf("Keys = %+v; want %+v", vks, want)
	}

	for i, v := range want {
		if got, want := v, vks[i].Name(); got != want {
			t.Errorf("View name = %q; want %q", got, want)
		}
	}
}

// TODO(songya): add tests for AggregationSum and AggregationMean with Interval Window

// containsRow returns true if rows contain r.
func containsRow(rows []*Row, r *Row) bool {
	for _, x := range rows {
		if r.Equal(x) {
			return true
		}
	}
	return false
}
