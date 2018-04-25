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
	"log"

	"github.com/blevesearch/bleve"
	"github.com/spf13/cobra"
)

var checkFieldName string
var checkCount int

// checkCmd represents the check command
var checkCmd = &cobra.Command{
	Use:   "check [index path]",
	Short: "checks the contents of the index",
	Long:  `The check command will perform consistency checks on the index.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		var fieldNames []string
		var err error
		if checkFieldName == "" {
			fieldNames, err = idx.Fields()
			if err != nil {
				return err
			}
		} else {
			fieldNames = []string{checkFieldName}
		}
		fmt.Printf("checking fields: %v\n", fieldNames)

		totalProblems := 0
		for _, fieldName := range fieldNames {
			fmt.Printf("checking field: '%s'\n", fieldName)
			problems, err := checkField(idx, fieldName)
			if err != nil {
				log.Fatal(err)
			}
			totalProblems += problems
		}

		if totalProblems != 0 {
			return fmt.Errorf("found %d total problems\n", totalProblems)
		}

		return nil
	},
}

func checkField(index bleve.Index, fieldName string) (int, error) {
	termDictionary, err := getDictionary(index, fieldName)
	if err != nil {
		return 0, err
	}
	fmt.Printf("field contains %d terms\n", len(termDictionary))

	numTested := 0
	numProblems := 0
	for term, count := range termDictionary {
		fmt.Printf("checked %d terms\r", numTested)
		if checkCount > 0 && numTested >= checkCount {
			break
		}

		tq := bleve.NewTermQuery(term)
		tq.SetField(fieldName)
		req := bleve.NewSearchRequest(tq)
		req.Size = 0
		res, err := index.Search(req)
		if err != nil {
			return 0, err
		}

		if res.Total != count {
			fmt.Printf("unexpected mismatch for term '%s', dictionary %d, search hits %d\n", term, count, res.Total)
			numProblems++
		}

		numTested++
	}
	fmt.Printf("done checking %d terms, found %d problems\n", numTested, numProblems)

	return numProblems, nil
}

func getDictionary(index bleve.Index, field string) (map[string]uint64, error) {
	rv := make(map[string]uint64)
	i, _, err := index.Advanced()
	if err != nil {
		log.Fatal(err)
	}
	r, err := i.Reader()
	if err != nil {
		log.Fatal(err)
	}
	d, err := r.FieldDict(field)
	if err != nil {
		log.Fatal(err)
	}

	de, err := d.Next()
	for err == nil && de != nil {
		rv[de.Term] = de.Count
		de, err = d.Next()
	}
	if err != nil {
		return nil, err
	}
	return rv, nil
}

func init() {
	RootCmd.AddCommand(checkCmd)
	checkCmd.Flags().StringVarP(&checkFieldName, "field", "f", "", "Restrict check to the specified field name, by default check all fields.")
	checkCmd.Flags().IntVarP(&checkCount, "count", "c", 100, "Check this many terms, default 100.")
}
