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

// dictionaryCmd represents the dictionary command
var dictionaryCmd = &cobra.Command{
	Use:   "dictionary [index path] [field name]",
	Short: "prints the term dictionary for the specified field in the index",
	Long:  `The dictionary command will print the term dictionary for the specified field.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 2 {
			return fmt.Errorf("must specify field")
		}
		i, _, err := idx.Advanced()
		if err != nil {
			return fmt.Errorf("error getting index: %v", err)
		}
		r, err := i.Reader()
		if err != nil {
			return fmt.Errorf("error getting index reader: %v", err)
		}
		d, err := r.FieldDict(args[1])
		if err != nil {
			return fmt.Errorf("error getting field dictionary: %v", err)
		}

		de, err := d.Next()
		for err == nil && de != nil {
			fmt.Printf("%s - %d\n", de.Term, de.Count)
			de, err = d.Next()
		}
		if err != nil {
			return fmt.Errorf("error iterating dictionary: %v", err)
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(dictionaryCmd)
}
