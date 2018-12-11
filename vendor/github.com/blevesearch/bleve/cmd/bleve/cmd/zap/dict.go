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

package zap

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/blevesearch/bleve/index/scorch/segment/zap"
	"github.com/couchbase/vellum"
	"github.com/spf13/cobra"
)

// dictCmd represents the dict command
var dictCmd = &cobra.Command{
	Use:   "dict [path] [field]",
	Short: "dict prints the term dictionary for the specified field",
	Long:  `The dict command lets you print the term dictionary for the specified field.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 2 {
			return fmt.Errorf("must specify field")
		}

		data := segment.Data()

		addr, err := segment.DictAddr(args[1])
		if err != nil {
			return fmt.Errorf("error determining address: %v", err)
		}
		fmt.Printf("dictionary for field starts at %d (%x)\n", addr, addr)

		vellumLen, read := binary.Uvarint(data[addr : addr+binary.MaxVarintLen64])
		fmt.Printf("vellum length: %d\n", vellumLen)
		fstBytes := data[addr+uint64(read) : addr+uint64(read)+vellumLen]
		fmt.Printf("raw vellum data:\n % x\n", fstBytes)
		fmt.Printf("dictionary:\n")
		if fstBytes != nil {
			fst, err := vellum.Load(fstBytes)
			if err != nil {
				return fmt.Errorf("dictionary field %s vellum err: %v", args[1], err)
			}

			itr, err := fst.Iterator(nil, nil)
			for err == nil {
				currTerm, currVal := itr.Current()
				extra := ""
				if currVal&zap.FSTValEncodingMask == zap.FSTValEncoding1Hit {
					docNum, normBits := zap.FSTValDecode1Hit(currVal)
					norm := math.Float32frombits(uint32(normBits))
					extra = fmt.Sprintf("-- docNum: %d, norm: %f", docNum, norm)
				}

				fmt.Printf(" %s - %d (%x) %s\n", currTerm, currVal, currVal, extra)
				err = itr.Next()
			}
			if err != nil && err != vellum.ErrIteratorDone {
				return fmt.Errorf("error iterating dictionary: %v", err)
			}

		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(dictCmd)
}
