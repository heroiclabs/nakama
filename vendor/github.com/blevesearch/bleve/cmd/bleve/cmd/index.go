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
	"log"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var keepDir, keepExt, parseJSON bool

// indexCmd represents the index command
var indexCmd = &cobra.Command{
	Use:   "index [index path] [data paths ...]",
	Short: "adds the files to the index",
	Long:  `The index command adds the specified files to the index.`,
	Annotations: map[string]string{
		canMutateBleveIndex: "true",
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 2 {
			return fmt.Errorf("must specify at least one path")
		}
		for file := range handleArgs(args[1:]) {
			var doc interface{}
			// index the files
			docID := file.filename
			if !keepDir {
				_, docID = filepath.Split(docID)
			}
			if !keepExt {
				ext := filepath.Ext(docID)
				docID = docID[0 : len(docID)-len(ext)]
			}
			doc = file.contents
			var err error
			if parseJSON {
				err = json.Unmarshal(file.contents, &doc)
				if err != nil {
					return fmt.Errorf("error parsing JSON: %v", err)
				}
			}
			fmt.Printf("Indexing: %s\n", docID)
			err = idx.Index(docID, doc)
			if err != nil {
				return fmt.Errorf("error indexing: %v", err)
			}
		}
		return nil
	},
}

type file struct {
	filename string
	contents []byte
}

func handleArgs(args []string) chan file {
	rv := make(chan file)
	go getAllFiles(args, rv)
	return rv
}

func getAllFiles(args []string, rv chan file) {
	for _, arg := range args {
		arg = filepath.Clean(arg)
		err := filepath.Walk(arg, func(path string, finfo os.FileInfo, err error) error {
			if err != nil {
				log.Print(err)
				return err
			}
			if finfo.IsDir() {
				return nil
			}

			bytes, err := ioutil.ReadFile(path)
			if err != nil {
				log.Fatal(err)
			}
			rv <- file{
				filename: filepath.Base(path),
				contents: bytes,
			}
			return nil
		})
		if err != nil {
			log.Fatal(err)
		}
	}
	close(rv)
}

func init() {
	RootCmd.AddCommand(indexCmd)

	indexCmd.Flags().BoolVarP(&keepDir, "keepDir", "d", false, "Keep the directory in the document id, defaults false.")
	indexCmd.Flags().BoolVarP(&keepExt, "keepExt", "x", false, "Keep the extension in the document id, defaults false.")
	indexCmd.Flags().BoolVarP(&parseJSON, "json", "j", true, "Parse the contents as JSON, defaults true.")
}
