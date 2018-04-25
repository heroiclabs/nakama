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

	"github.com/blevesearch/bleve/index/scorch/segment/zap"
	"github.com/spf13/cobra"
)

// fieldsCmd represents the fields command
var fieldsCmd = &cobra.Command{
	Use:   "fields [path]",
	Short: "fields prints the fields in the specified file",
	Long:  `The fields command lets you print the fields in the specified file.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		data := segment.Data()

		crcOffset := len(data) - 4
		verOffset := crcOffset - 4
		chunkOffset := verOffset - 4
		fieldsOffset := chunkOffset - 16
		fieldsIndexOffset := binary.BigEndian.Uint64(data[fieldsOffset : fieldsOffset+8])
		fieldsIndexEnd := uint64(len(data) - zap.FooterSize)

		// iterate through fields index
		var fieldID uint64
		for fieldsIndexOffset+(8*fieldID) < fieldsIndexEnd {
			addr := binary.BigEndian.Uint64(data[fieldsIndexOffset+(8*fieldID) : fieldsIndexOffset+(8*fieldID)+8])
			var n uint64
			dictLoc, read := binary.Uvarint(data[addr+n : fieldsIndexEnd])
			n += uint64(read)

			var nameLen uint64
			nameLen, read = binary.Uvarint(data[addr+n : fieldsIndexEnd])
			n += uint64(read)

			name := string(data[addr+n : addr+n+nameLen])

			fmt.Printf("field %d '%s' starts at %d (%x)\n", fieldID, name, dictLoc, dictLoc)

			fieldID++
		}

		return nil
	},
}

func init() {
	RootCmd.AddCommand(fieldsCmd)
}
