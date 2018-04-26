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

// fieldsCmd represents the fields command
var fieldsCmd = &cobra.Command{
	Use:   "fields [index path]",
	Short: "lists the fields in this index",
	Long:  `The fields command will list the fields used in this index.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		i, _, err := idx.Advanced()
		if err != nil {
			return fmt.Errorf("error getting index: %v", err)
		}
		r, err := i.Reader()
		if err != nil {
			return fmt.Errorf("error getting index reader: %v", err)
		}
		fields, err := r.Fields()
		if err != nil {
			return fmt.Errorf("error getting fields: %v", err)
		}
		for i, field := range fields {
			fmt.Printf("%d - %s\n", i, field)
		}
		return nil
	},
}

func init() {
	RootCmd.AddCommand(fieldsCmd)
}
