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
	"io/ioutil"
	"os"
	"os/exec"

	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

var svgCmd = &cobra.Command{
	Use:   "svg",
	Short: "SVG prints the contents of this vellum FST file in the SVG format",
	Long:  `SVG prints the contents of this vellum FST file in the SVG format.`,
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

		return svgToWriter(fst, os.Stdout)
	},
}

func svgToWriter(fst *vellum.FST, w io.Writer) error {
	pr, pw := io.Pipe()
	go func() {
		defer func() {
			_ = pw.Close()
		}()
		_ = dotToWriter(fst, pw)
	}()
	cmd := exec.Command("dot", "-Tsvg")
	cmd.Stdin = pr
	cmd.Stdout = w
	cmd.Stderr = ioutil.Discard
	err := cmd.Run()
	if err != nil {
		return err
	}
	return nil
}

func init() {
	RootCmd.AddCommand(svgCmd)
}
