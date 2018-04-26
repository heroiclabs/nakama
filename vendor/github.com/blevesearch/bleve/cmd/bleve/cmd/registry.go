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
	"sort"

	"github.com/blevesearch/bleve/registry"
	"github.com/spf13/cobra"
)

// registryCmd represents the registry command
var registryCmd = &cobra.Command{
	Use:   "registry",
	Short: "registry lists the bleve components compiled into this executable",
	Long:  `The registry command will list all of the bleve components compiled into this executable.`,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// override to do nothing
		return nil
	},
	PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
		// override to do nothing
		return nil
	},
	Run: func(cmd *cobra.Command, args []string) {
		types, instances := registry.CharFilterTypesAndInstances()
		printType("Char Filter", types, instances)

		types, instances = registry.TokenizerTypesAndInstances()
		printType("Tokenizer", types, instances)

		types, instances = registry.TokenMapTypesAndInstances()
		printType("Token Map", types, instances)

		types, instances = registry.TokenFilterTypesAndInstances()
		printType("Token Filter", types, instances)

		types, instances = registry.AnalyzerTypesAndInstances()
		printType("Analyzer", types, instances)

		types, instances = registry.DateTimeParserTypesAndInstances()
		printType("Date Time Parser", types, instances)

		types, instances = registry.KVStoreTypesAndInstances()
		printType("KV Store", types, instances)

		types, instances = registry.FragmentFormatterTypesAndInstances()
		printType("Fragment Formatter", types, instances)

		types, instances = registry.FragmenterTypesAndInstances()
		printType("Fragmenter", types, instances)

		types, instances = registry.HighlighterTypesAndInstances()
		printType("Highlighter", types, instances)
	},
}

func printType(label string, types, instances []string) {
	sort.Strings(types)
	sort.Strings(instances)
	fmt.Printf(label + " Types:\n")
	for _, name := range types {
		fmt.Printf("\t%s\n", name)
	}
	fmt.Println()
	fmt.Printf(label + " Instances:\n")
	for _, name := range instances {
		fmt.Printf("\t%s\n", name)
	}
	fmt.Println()
}

func init() {
	RootCmd.AddCommand(registryCmd)
}
