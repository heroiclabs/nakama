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

	"github.com/spf13/cobra"
)

// deletedCmd represents the deleted command
var deletedCmd = &cobra.Command{
	Use:   "deleted",
	Short: "deleted prints the deleted bitmap for segments in the index snapshot",
	Long:  `The delete command prints the deleted bitmap for segments in the index snapshot.`,
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
			for i, segmentSnap := range segments {
				deleted := segmentSnap.Deleted()
				fmt.Printf("%d %v\n", i, deleted)
			}
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(deletedCmd)
}
