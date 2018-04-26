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
	"os"
	"strconv"

	"github.com/blevesearch/bleve"
	"github.com/spf13/cobra"
)

var cfgFile string

var idx bleve.Index

const canMutateBleveIndex = "canMutateBleveIndex"

// CanMutateBleveIndex returns true if the command is capable
// of mutating the bleve index, or false if its operation is
// read-only
func CanMutateBleveIndex(c *cobra.Command) bool {
	for k, v := range c.Annotations {
		if k == canMutateBleveIndex {
			if b, err := strconv.ParseBool(v); err == nil && b {
				return true
			}
		}
	}
	return false
}

// RootCmd represents the base command when called without any subcommands
var RootCmd = &cobra.Command{
	Use:   "bleve",
	Short: "command-line tool to interact with a bleve index",
	Long:  `Bleve is a command-line tool to interact with a bleve index.`,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return fmt.Errorf("must specify path to index")
		}
		var err error
		idx, err = bleve.Open(args[0])
		if err != nil {
			return fmt.Errorf("error opening bleve index: %v", err)
		}
		return nil
	},
	PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
		err := idx.Close()
		if err != nil {
			return fmt.Errorf("error closing bleve index: %v", err)
		}
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
