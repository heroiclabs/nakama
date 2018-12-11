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
	"strconv"

	"github.com/golang/snappy"
	"github.com/spf13/cobra"
)

// storedCmd represents the stored command
var storedCmd = &cobra.Command{
	Use:   "stored [path] [docNum]",
	Short: "prints the stored section for a doc number",
	Long:  `The stored command will print the raw stored data bytes for the specified document number.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 2 {
			return fmt.Errorf("must specify doc number")
		}
		docNum, err := strconv.Atoi(args[1])
		if err != nil {
			return fmt.Errorf("unable to parse doc number: %v", err)
		}
		if docNum >= int(segment.NumDocs()) {
			return fmt.Errorf("invalid doc number %d (valid 0 - %d)", docNum, segment.NumDocs()-1)
		}
		data := segment.Data()
		storedIdx := segment.StoredIndexOffset()
		// read docNum entry in the index
		indexPos := storedIdx + (8 * uint64(docNum))
		storedStartAddr := binary.BigEndian.Uint64(data[indexPos : indexPos+8])
		fmt.Printf("Stored field starts at %d (%#x)\n", storedStartAddr, storedStartAddr)

		var n uint64
		metaLen, read := binary.Uvarint(data[storedStartAddr : storedStartAddr+binary.MaxVarintLen64])
		n += uint64(read)
		fmt.Printf("Meta Len: %d\n", metaLen)
		var dataLen uint64
		dataLen, read = binary.Uvarint(data[storedStartAddr+n : storedStartAddr+n+binary.MaxVarintLen64])
		n += uint64(read)
		fmt.Printf("Data Len: %d\n", dataLen)
		meta := data[storedStartAddr+n : storedStartAddr+n+metaLen]
		fmt.Printf("Raw meta: % x\n", meta)
		raw := data[storedStartAddr+n+metaLen : storedStartAddr+n+metaLen+dataLen]
		fmt.Printf("Raw data (len %d): % x\n", len(raw), raw)

		// handle _id field special case
		idFieldValLen, _ := binary.Uvarint(meta)
		fmt.Printf("Raw _id (len %d): % x\n", idFieldValLen, raw[:idFieldValLen])
		fmt.Printf("Raw fields (len %d): % x\n", dataLen-idFieldValLen, raw[idFieldValLen:])
		uncompressed, err := snappy.Decode(nil, raw[idFieldValLen:])
		if err != nil {
			panic(err)
		}
		fmt.Printf("Uncompressed fields (len %d): % x\n", len(uncompressed), uncompressed)

		return nil
	},
}

func init() {
	RootCmd.AddCommand(storedCmd)
}
