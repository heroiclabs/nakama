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
	"io/ioutil"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/mapping"
	"github.com/spf13/cobra"
)

var mappingPath, indexType, storeType string

// createCmd represents the create command
var createCmd = &cobra.Command{
	Use:   "create [index path]",
	Short: "creates a new index",
	Long:  `The create command will create a new empty index.`,
	Annotations: map[string]string{
		canMutateBleveIndex: "true",
	},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// override RootCmd version which opens existing index
		if len(args) < 1 {
			return fmt.Errorf("must specify path to index")
		}
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		var mapping mapping.IndexMapping
		var err error
		mapping, err = buildMapping()
		if err != nil {
			return fmt.Errorf("error building mapping: %v", err)
		}
		idx, err = bleve.NewUsing(args[0], mapping, indexType, storeType, nil)
		if err != nil {
			return fmt.Errorf("error creating index: %v", err)
		}
		// the inheritted Post action will close the index
		return nil
	},
}

func buildMapping() (mapping.IndexMapping, error) {
	mapping := mapping.NewIndexMapping()
	if mappingPath != "" {
		mappingBytes, err := ioutil.ReadFile(mappingPath)
		if err != nil {
			return nil, err
		}
		err = json.Unmarshal(mappingBytes, &mapping)
		if err != nil {
			return nil, err
		}
	}
	return mapping, nil
}

func init() {
	RootCmd.AddCommand(createCmd)

	createCmd.Flags().StringVarP(&mappingPath, "mapping", "m", "", "Path to a file containing a JSON representation of an index mapping to use.")
	createCmd.Flags().StringVarP(&storeType, "store", "s", bleve.Config.DefaultKVStore, "The bleve storage type to use.")
	createCmd.Flags().StringVarP(&indexType, "index", "i", bleve.Config.DefaultIndexType, "The bleve index type to use.")
}
