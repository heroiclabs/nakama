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
	"encoding/json"
	"fmt"
	"log"

	"github.com/spf13/cobra"
)

// mappingCmd represents the mapping command
var mappingCmd = &cobra.Command{
	Use:   "mapping [index path]",
	Short: "prints the mapping used for this index",
	Long:  `The mapping command prints a JSON representation of the mapping used for this index.`,
	Run: func(cmd *cobra.Command, args []string) {
		mapping := idx.Mapping()
		jsonBytes, err := json.MarshalIndent(mapping, "", "  ")
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("%s\n", jsonBytes)
	},
}

func init() {
	RootCmd.AddCommand(mappingCmd)
}
