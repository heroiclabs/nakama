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
	"fmt"
	"io"
	"os"

	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

var dotCmd = &cobra.Command{
	Use:   "dot",
	Short: "Dot prints the contents of this vellum FST file in the dot format",
	Long:  `Dot prints the contents of this vellum FST file in the dot format.`,
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return fmt.Errorf("path is required")
		}
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		fst, err := vellum.Open(args[0])
		if err != nil {
			return err
		}

		return dotToWriter(fst, os.Stdout)
	},
}

func dotToWriter(fst *vellum.FST, w io.Writer) error {
	_, err := fmt.Fprint(w, dotHeader)
	if err != nil {
		return err
	}
	err = fst.Debug(func(n int, state interface{}) error {
		if d, ok := state.(dotStringer); ok {
			_, err = fmt.Fprintf(w, "%s", d.DotString(n))
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprint(w, dotFooter)
	if err != nil {
		return err
	}
	return nil
}

const dotHeader = `
digraph automaton {
    labelloc="l";
    labeljust="l";
    rankdir="LR";

`
const dotFooter = `}
`

type dotStringer interface {
	DotString(int) string
}

func init() {
	RootCmd.AddCommand(dotCmd)
}
