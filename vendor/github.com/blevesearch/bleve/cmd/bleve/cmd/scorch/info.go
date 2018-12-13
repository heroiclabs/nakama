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

	"github.com/spf13/cobra"
)

// dictCmd represents the dict command
var infoCmd = &cobra.Command{
	Use:   "info",
	Short: "info prints basic info about the index",
	Long:  `The info command prints basic info about the index.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		reader, err := index.Reader()
		if err != nil {
			return err
		}

		count, err := reader.DocCount()
		if err != nil {
			return err
		}

		fmt.Printf("doc count: %d\n", count)

		// var numSnapshots int
		// var rootSnapshot uint64
		// index.VisitBoltSnapshots(func(snapshotEpoch uint64) error {
		// 	if rootSnapshot == 0 {
		// 		rootSnapshot = snapshotEpoch
		// 	}
		// 	numSnapshots++
		// 	return nil
		// })
		// fmt.Printf("has %d snapshot(s), root: %d\n", numSnapshots, rootSnapshot)

		return nil
	},
}

func init() {
	RootCmd.AddCommand(infoCmd)
}
