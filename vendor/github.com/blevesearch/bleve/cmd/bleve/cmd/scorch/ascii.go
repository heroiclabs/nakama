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

	"github.com/blevesearch/bleve/index/scorch/mergeplan"
	"github.com/spf13/cobra"
)

// asciiCmd represents the ascii command
var asciiCmd = &cobra.Command{
	Use:   "ascii",
	Short: "ascii prints an ascii representation of the segments in a snapshot",
	Long:  `The ascii command prints an ascii representation of the segments in a given snapshot.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		if len(args) < 2 {
			return fmt.Errorf("snapshot epoch required")
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
			var mergePlanSegments []mergeplan.Segment
			for _, v := range segments {
				mergePlanSegments = append(mergePlanSegments, v)
			}

			str := mergeplan.ToBarChart(args[1], 25, mergePlanSegments, nil)
			fmt.Printf("%s\n", str)
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(asciiCmd)
}
