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
	"bufio"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"

	"github.com/spf13/cobra"
)

var batchSize int

// bulkCmd represents the bulk command
var bulkCmd = &cobra.Command{
	Use:   "bulk [index path] [data paths ...]",
	Short: "bulk loads from newline delimited JSON files",
	Long:  `The bulk command will perform batch loading of documents in one or more newline delimited JSON files.`,
	Annotations: map[string]string{
		canMutateBleveIndex: "true",
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 2 {
			return fmt.Errorf("must specify at least one path")
		}

		i := 0
		batch := idx.NewBatch()

		for _, file := range args[1:] {

			file, err := os.Open(file)
			if err != nil {
				return err
			}

			fmt.Printf("Indexing: %s\n", file.Name())
			r := bufio.NewReader(file)

			for {
				if i%batchSize == 0 {
					fmt.Printf("Indexing batch (%d docs)...\n", i)
					err := idx.Batch(batch)
					if err != nil {
						return err
					}
					batch = idx.NewBatch()
				}

				b, _ := r.ReadBytes('\n')
				if len(b) == 0 {
					break
				}

				var doc interface{}
				doc = b
				var err error
				if parseJSON {
					err = json.Unmarshal(b, &doc)
					if err != nil {
						return fmt.Errorf("error parsing JSON: %v", err)
					}
				}

				docID := randomString(5)
				err = batch.Index(docID, doc)
				if err != nil {
					return err
				}
				i++
			}
			err = idx.Batch(batch)
			if err != nil {
				return err
			}

			err = file.Close()
			if err != nil {
				return err
			}

		}
		return nil
	},
}

var letters = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

func randomString(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

func init() {
	RootCmd.AddCommand(bulkCmd)

	bulkCmd.Flags().IntVarP(&batchSize, "batch", "b", 1000, "Batch size for loading, default 1000.")
	bulkCmd.Flags().BoolVarP(&parseJSON, "json", "j", true, "Parse the contents as JSON, defaults true.")
}
