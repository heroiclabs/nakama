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

package scorch

import (
	"fmt"
	"strconv"

	"github.com/blevesearch/bleve/index/scorch/segment/zap"
	"github.com/spf13/cobra"
)

// snapshotCmd represents the snapshot command
var snapshotCmd = &cobra.Command{
	Use:   "snapshot",
	Short: "info prints details about the snapshots in the index",
	Long:  `The snapshot command prints details about the snapshots in the index.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		if len(args) < 2 {
			snapshotEpochs, err := index.RootBoltSnapshotEpochs()
			if err != nil {
				return err
			}
			for _, snapshotEpoch := range snapshotEpochs {
				fmt.Printf("snapshot epoch: %d\n", snapshotEpoch)
			}
		} else if len(args) < 3 {
			snapshotEpoch, err := strconv.ParseUint(args[1], 10, 64)
			if err != nil {
				return err
			}
			snapshot, err := index.LoadSnapshot(snapshotEpoch)
			if err != nil {
				return err
			}
			segments := snapshot.Segments()
			for i, segmentSnap := range segments {
				segment := segmentSnap.Segment()
				if segment, ok := segment.(*zap.Segment); ok {
					fmt.Printf("%d %s\n", i, segment.Path())
				}
			}
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(snapshotCmd)
}
