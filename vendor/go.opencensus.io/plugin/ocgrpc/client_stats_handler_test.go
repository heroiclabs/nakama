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

package ocgrpc

import (
	"testing"

	"go.opencensus.io/trace"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"golang.org/x/net/context"

	"go.opencensus.io/stats/view"
	"go.opencensus.io/tag"

	"google.golang.org/grpc/stats"
)

func TestClientDefaultCollections(t *testing.T) {
	k1, _ := tag.NewKey("k1")
	k2, _ := tag.NewKey("k2")

	type tagPair struct {
		k tag.Key
		v string
	}

	type wantData struct {
		v    func() *view.View
		rows []*view.Row
	}
	type rpc struct {
		tags        []tagPair
		tagInfo     *stats.RPCTagInfo
		inPayloads  []*stats.InPayload
		outPayloads []*stats.OutPayload
		end         *stats.End
	}

	type testCase struct {
		label string
		rpcs  []*rpc
		wants []*wantData
	}
	tcs := []testCase{
		{
			"1",
			[]*rpc{
				{
					[]tagPair{{k1, "v1"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 10},
					},
					[]*stats.OutPayload{
						{Length: 10},
					},
					&stats.End{Error: nil},
				},
			},
			[]*wantData{
				{
					func() *view.View { return ClientRequestCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 1, 1, 1, 1, 0),
						},
					},
				},
				{
					func() *view.View { return ClientResponseCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 1, 1, 1, 1, 0),
						},
					},
				},
				{
					func() *view.View { return ClientRequestBytesView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 1, 10, 10, 10, 0),
						},
					},
				},
				{
					func() *view.View { return ClientResponseBytesView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 1, 10, 10, 10, 0),
						},
					},
				},
			},
		},
		{
			"2",
			[]*rpc{
				{
					[]tagPair{{k1, "v1"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 10},
					},
					[]*stats.OutPayload{
						{Length: 10},
						{Length: 10},
						{Length: 10},
					},
					&stats.End{Error: nil},
				},
				{
					[]tagPair{{k1, "v11"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 10},
						{Length: 10},
					},
					[]*stats.OutPayload{
						{Length: 10},
						{Length: 10},
					},
					&stats.End{Error: status.Error(codes.Canceled, "canceled")},
				},
			},
			[]*wantData{
				{
					func() *view.View { return ClientErrorCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyStatus, Value: "Canceled"},
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newMeanData(1, 1),
						},
					},
				},
				{
					func() *view.View { return ClientRequestCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 2, 2, 3, 2.5, 0.5),
						},
					},
				},
				{
					func() *view.View { return ClientResponseCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 2, 1, 2, 1.5, 0.5),
						},
					},
				},
			},
		},
		{
			"3",
			[]*rpc{
				{
					[]tagPair{{k1, "v1"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 1},
					},
					[]*stats.OutPayload{
						{Length: 1},
						{Length: 1024},
						{Length: 65536},
					},
					&stats.End{Error: nil},
				},
				{
					[]tagPair{{k1, "v1"}, {k2, "v2"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 1024},
					},
					[]*stats.OutPayload{
						{Length: 4096},
						{Length: 16384},
					},
					&stats.End{Error: status.Error(codes.Canceled, "canceled")},
				},
				{
					[]tagPair{{k1, "v11"}, {k2, "v22"}},
					&stats.RPCTagInfo{FullMethodName: "/package.service/method"},
					[]*stats.InPayload{
						{Length: 2048},
						{Length: 16384},
					},
					[]*stats.OutPayload{
						{Length: 2048},
						{Length: 4096},
						{Length: 16384},
					},
					&stats.End{Error: status.Error(codes.Aborted, "aborted")},
				},
			},
			[]*wantData{
				{
					func() *view.View { return ClientErrorCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyStatus, Value: "Canceled"},
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newMeanData(1, 1),
						},
						{
							Tags: []tag.Tag{
								{Key: KeyStatus, Value: "Aborted"},
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newMeanData(1, 1),
						},
					},
				},
				{
					func() *view.View { return ClientRequestCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 3, 2, 3, 2.666666666, 0.333333333*2),
						},
					},
				},
				{
					func() *view.View { return ClientResponseCountView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 3, 1, 2, 1.333333333, 0.333333333*2),
						},
					},
				},
				{
					func() *view.View { return ClientRequestBytesView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 1, 1, 1, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0}, 8, 1, 65536, 13696.125, 481423542.982143*7),
						},
					},
				},
				{
					func() *view.View { return ClientResponseBytesView },
					[]*view.Row{
						{
							Tags: []tag.Tag{
								{Key: KeyMethod, Value: "package.service/method"},
							},
							Data: newDistributionData([]int64{0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 4, 1, 16384, 4864.25, 59678208.25*3),
						},
					},
				},
			},
		},
	}

	for _, tc := range tcs {
		// Register views.
		if err := view.Subscribe(DefaultClientViews...); err != nil {
			t.Error(err)
		}

		h := &ClientHandler{}
		h.StartOptions.Sampler = trace.NeverSample()
		for _, rpc := range tc.rpcs {
			mods := []tag.Mutator{}
			for _, t := range rpc.tags {
				mods = append(mods, tag.Upsert(t.k, t.v))
			}
			ctx, err := tag.New(context.Background(), mods...)
			if err != nil {
				t.Errorf("%q: NewMap = %v", tc.label, err)
			}
			encoded := tag.Encode(tag.FromContext(ctx))
			ctx = stats.SetTags(context.Background(), encoded)
			ctx = h.TagRPC(ctx, rpc.tagInfo)
			for _, out := range rpc.outPayloads {
				h.HandleRPC(ctx, out)
			}
			for _, in := range rpc.inPayloads {
				h.HandleRPC(ctx, in)
			}
			h.HandleRPC(ctx, rpc.end)
		}

		for _, wantData := range tc.wants {
			gotRows, err := view.RetrieveData(wantData.v().Name)
			if err != nil {
				t.Errorf("%q: RetrieveData(%q) = %v", tc.label, wantData.v().Name, err)
				continue
			}

			for _, gotRow := range gotRows {
				if !containsRow(wantData.rows, gotRow) {
					t.Errorf("%q: unwanted row for view %q = %v", tc.label, wantData.v().Name, gotRow)
					break
				}
			}

			for _, wantRow := range wantData.rows {
				if !containsRow(gotRows, wantRow) {
					t.Errorf("%q: row missing for view %q; want %v", tc.label, wantData.v().Name, wantRow)
					break
				}
			}
		}

		// Unregister views to cleanup.
		view.Unsubscribe(DefaultClientViews...)
	}
}

// containsRow returns true if rows contain r.
func containsRow(rows []*view.Row, r *view.Row) bool {
	for _, x := range rows {
		if r.Equal(x) {
			return true
		}
	}
	return false
}
