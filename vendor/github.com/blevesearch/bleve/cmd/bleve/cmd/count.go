// Copyright © 2016 Couchbase, Inc.
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

	"github.com/spf13/cobra"
)

// countCmd represents the count command
var countCmd = &cobra.Command{
	Use:   "count [index path]",
	Short: "counts the number documents in the index",
	Long:  `The count command will count the number of documents in the index.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		count, err := idx.DocCount()
		if err != nil {
			return fmt.Errorf("error counting docs in index: %v", err)
		}
		fmt.Printf("%d\n", count)
		return nil
	},
}

func init() {
	RootCmd.AddCommand(countCmd)
}
