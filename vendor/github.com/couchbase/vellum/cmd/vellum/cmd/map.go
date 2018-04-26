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
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"

	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

var mapCmd = &cobra.Command{
	Use:   "map",
	Short: "Map builds a new FST from a CSV file containing key,val pairs",
	Long:  `Map builds a new FST from a CSV file containing key,val pairs.`,
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

		reader := csv.NewReader(file)
		reader.FieldsPerRecord = 2

		var record []string
		record, err = reader.Read()
		for err == nil {
			var v uint64
			v, err = strconv.ParseUint(record[1], 10, 64)
			if err != nil {
				return err
			}
			err = b.Insert([]byte(record[0]), v)
			if err != nil {
				return err
			}

			record, err = reader.Read()
		}
		if err != io.EOF {
			return err
		}

		err = b.Close()
		if err != nil {
			return err
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(mapCmd)
	mapCmd.Flags().BoolVar(&sorted, "sorted", false, "input already sorted")
}
