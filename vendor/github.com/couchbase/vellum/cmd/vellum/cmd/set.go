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
	"bufio"
	"fmt"
	"log"
	"os"

	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

var sorted bool

var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Set builds a new FST from a file containing new-line separated values",
	Long:  `Set builds a new FST from a file containing new-line separated values.`,
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return fmt.Errorf("source and target paths are required")
		}
		if len(args) < 2 {
			return fmt.Errorf("target path is required")
		}
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {

		if !sorted {
			return fmt.Errorf("only sorted input supported at this time")
		}

		file, err := os.Open(args[0])
		if err != nil {
			log.Fatal(err)
		}
		defer file.Close()

		f, err := os.Create(args[1])
		if err != nil {
			return err
		}

		b, err := vellum.New(f, nil)
		if err != nil {
			return err
		}

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			word := append([]byte(nil), scanner.Bytes()...)
			err = b.Insert(word, 0)
			if err != nil {
				return err
			}
		}

		if err = scanner.Err(); err != nil {
			log.Fatal(err)
		}

		err = b.Close()
		if err != nil {
			return err
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(setCmd)
	setCmd.Flags().BoolVar(&sorted, "sorted", false, "input already sorted")
}
