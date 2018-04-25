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
	"os"

	"github.com/blevesearch/bleve/index/scorch"
	"github.com/spf13/cobra"
)

var index *scorch.Scorch

// RootCmd represents the base command when called without any subcommands
var RootCmd = &cobra.Command{
	Use:   "scorch",
	Short: "command-line tool to interact with a scorch index",
	Long:  `Scorch is a command-line tool to interact with a scorch index.`,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {

		if len(args) < 1 {
			return fmt.Errorf("must specify path to scorch index")
		}

		readOnly := true
		config := map[string]interface{}{
			"read_only": readOnly,
			"path":      args[0],
		}

		idx, err := scorch.NewScorch(scorch.Name, config, nil)
		if err != nil {
			return err
		}

		err = idx.Open()
		if err != nil {
			return fmt.Errorf("error opening: %v", err)
		}

		index = idx.(*scorch.Scorch)

		return nil
	},
	PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
		return nil
	},
}

// Execute adds all child commands to the root command sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := RootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(-1)
	}
}
