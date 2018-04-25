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

package cmd

import (
	"fmt"

	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

var startKey string
var endKey string

var rangeCmd = &cobra.Command{
	Use:   "range",
	Short: "Range iterates over the contents of this vellum FST file",
	Long:  `Range iterates over the contents of this vellum FST file.  You can optionally specify start/end keys after the filename.`,
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return fmt.Errorf("path is required")
		}
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		fst, err := vellum.Open(args[0])
		if err != nil {
			return err
		}
		var startKeyB, endKeyB []byte
		if startKey != "" {
			startKeyB = []byte(startKey)
		}
		if endKey != "" {
			endKeyB = []byte(endKey)
		}
		itr, err := fst.Iterator(startKeyB, endKeyB)
		for err == nil {
			key, val := itr.Current()
			fmt.Printf("%s - %d\n", key, val)
			err = itr.Next()
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(rangeCmd)
	rangeCmd.Flags().StringVar(&startKey, "start", "", "start key inclusive")
	rangeCmd.Flags().StringVar(&endKey, "end", "", "end key inclusive")
}
