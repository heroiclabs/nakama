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
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"

	"github.com/blevesearch/bleve/index/scorch/segment/zap"
	"github.com/golang/snappy"
	"github.com/spf13/cobra"
)

// docvalueCmd represents the docvalue command
var docvalueCmd = &cobra.Command{
	Use:   "docvalue [path] <field> optional <docNum> optional",
	Short: "docvalue prints the docvalue details by field, and docNum",
	Long:  `The docvalue command lets you explore the docValues in order of field and by doc number.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return fmt.Errorf("must specify index file path")
		}

		data := segment.Data()
		crcOffset := len(data) - 4
		verOffset := crcOffset - 4
		chunkOffset := verOffset - 4
		fieldsOffset := chunkOffset - 16
		fieldsIndexOffset := binary.BigEndian.Uint64(data[fieldsOffset : fieldsOffset+8])
		fieldsIndexEnd := uint64(len(data) - zap.FooterSize)

		// iterate through fields index
		var fieldInv []string
		var id uint64
		for fieldsIndexOffset+(8*id) < fieldsIndexEnd {
			addr := binary.BigEndian.Uint64(
				data[fieldsIndexOffset+(8*id) : fieldsIndexOffset+(8*id)+8])
			var n uint64
			_, read := binary.Uvarint(data[addr+n : fieldsIndexEnd])
			n += uint64(read)

			var nameLen uint64
			nameLen, read = binary.Uvarint(data[addr+n : fieldsIndexEnd])
			n += uint64(read)

			name := string(data[addr+n : addr+n+nameLen])

			id++
			fieldInv = append(fieldInv, name)
		}

		dvLoc := segment.DocValueOffset()
		var n int
		var fieldName string
		var fieldID uint16
		var fieldDvSize float64
		var read, fieldStartLoc, fieldEndLoc uint64
		var fieldChunkCount, fieldDvStart, fieldDvEnd, totalDvSize uint64
		var fieldChunkLens []uint64

		// if no fields are specified then print the docValue offsets for all fields set
		for id, field := range fieldInv {
			fieldStartLoc, n = binary.Uvarint(
				data[dvLoc+read : dvLoc+read+binary.MaxVarintLen64])
			if n <= 0 {
				return fmt.Errorf("loadDvIterators: failed to read the "+
					" docvalue offsets for field %d", fieldID)
			}

			read += uint64(n)
			fieldEndLoc, n = binary.Uvarint(
				data[dvLoc+read : dvLoc+read+binary.MaxVarintLen64])
			if n <= 0 {
				return fmt.Errorf("Failed to read the docvalue offset "+
					"end for field %d", fieldID)
			}

			read += uint64(n)
			if fieldStartLoc == math.MaxUint64 && len(args) == 1 {
				fmt.Printf("FieldID: %d '%s' docvalue at %d (%x) not "+
					" persisted \n", id, field, fieldStartLoc, fieldStartLoc)
				continue
			}

			var chunkOffsetsPosition, offset, numChunks uint64
			if fieldEndLoc-fieldStartLoc > 16 {
				numChunks = binary.BigEndian.Uint64(data[fieldEndLoc-8 : fieldEndLoc])
				// read the length of chunk offsets
				chunkOffsetsLen := binary.BigEndian.Uint64(data[fieldEndLoc-16 : fieldEndLoc-8])
				// acquire position of chunk offsets
				chunkOffsetsPosition = (fieldEndLoc - 16) - chunkOffsetsLen
			}

			// read the chunk offsets
			chunkLens := make([]uint64, numChunks)
			dvSize := uint64(0)
			for i := 0; i < int(numChunks); i++ {
				length, read := binary.Uvarint(
					data[chunkOffsetsPosition+offset : chunkOffsetsPosition+offset+
						binary.MaxVarintLen64])
				if read <= 0 {
					return fmt.Errorf("Corrupted chunk offset during segment load")
				}

				offset += uint64(read)
				chunkLens[i] = length
				dvSize += length
			}

			totalDvSize += dvSize
			// if no field args are given, then print out the dv locations for all fields
			if len(args) == 1 {
				mbsize := float64(dvSize) / (1024 * 1024)
				fmt.Printf("FieldID: %d '%s' docvalue at %d (%x) numChunks "+
					"%d  diskSize %.6f MB\n", id, field, fieldStartLoc,
					fieldStartLoc, numChunks, mbsize)
				continue
			}

			// if the field is the requested one for more details,
			// then remember the details
			if field == args[1] {
				fieldDvStart = fieldStartLoc
				fieldDvEnd = fieldEndLoc
				fieldName = field
				fieldID = uint16(id)
				fieldDvSize = float64(dvSize) / (1024 * 1024)
				fieldChunkLens = append(fieldChunkLens, chunkLens...)
				fieldChunkCount = numChunks
			}
		}

		mbsize := float64(totalDvSize) / (1024 * 1024)
		fmt.Printf("Total Doc Values Size on Disk: %.6f MB\n", mbsize)

		// done with the fields dv locs printing for the given zap file
		if len(args) == 1 {
			return nil
		}

		if fieldName == "" || fieldDvEnd == 0 {
			return fmt.Errorf("No docvalue persisted for given field arg: %s",
				args[1])
		}

		if len(args) == 2 {
			fmt.Printf("FieldID: %d '%s' docvalue at %d (%x) numChunks "+
				"%d  diskSize %.6f MB\n", fieldID, fieldName, fieldDvStart,
				fieldDvStart, fieldChunkCount, fieldDvSize)
			fmt.Printf("Number of docvalue chunks: %d\n", fieldChunkCount)
			return nil
		}

		localDocNum, err := strconv.Atoi(args[2])
		if err != nil {
			return fmt.Errorf("Unable to parse doc number: %v", err)
		}

		if localDocNum >= int(segment.NumDocs()) {
			return fmt.Errorf("Invalid doc number %d (valid 0 - %d)",
				localDocNum, segment.NumDocs()-1)
		}

		// find the chunkNumber where the docValues are stored
		docInChunk := uint64(localDocNum) / uint64(segment.ChunkFactor())

		if fieldChunkCount < docInChunk {
			return fmt.Errorf("No chunk exists for chunk number: %d for "+
				"localDocNum: %d", docInChunk, localDocNum)
		}

		start, end := readChunkBoundary(int(docInChunk), fieldChunkLens)
		destChunkDataLoc := fieldDvStart + start
		curChunkEnd := fieldDvStart + end

		// read the number of docs reside in the chunk
		var numDocs uint64
		var nr int
		numDocs, nr = binary.Uvarint(
			data[destChunkDataLoc : destChunkDataLoc+binary.MaxVarintLen64])
		if nr <= 0 {
			return fmt.Errorf("Failed to read the chunk")
		}

		chunkMetaLoc := destChunkDataLoc + uint64(nr)
		curChunkHeader := make([]zap.MetaData, int(numDocs))
		offset := uint64(0)
		for i := 0; i < int(numDocs); i++ {
			curChunkHeader[i].DocNum, nr = binary.Uvarint(
				data[chunkMetaLoc+offset : chunkMetaLoc+offset+binary.MaxVarintLen64])
			offset += uint64(nr)
			curChunkHeader[i].DocDvOffset, nr = binary.Uvarint(
				data[chunkMetaLoc+offset : chunkMetaLoc+offset+binary.MaxVarintLen64])
			offset += uint64(nr)
		}

		compressedDataLoc := chunkMetaLoc + offset
		dataLength := curChunkEnd - compressedDataLoc
		curChunkData := data[compressedDataLoc : compressedDataLoc+dataLength]

		start, end = getDocValueLocs(uint64(localDocNum), curChunkHeader)
		if start == math.MaxUint64 || end == math.MaxUint64 {
			fmt.Printf("No field values found for localDocNum: %d\n",
				localDocNum)
			fmt.Printf("Try docNums present in chunk: %s\n",
				metaDataDocNums(curChunkHeader))
			return nil
		}
		// uncompress the already loaded data
		uncompressed, err := snappy.Decode(nil, curChunkData)
		if err != nil {
			log.Printf("snappy err %+v ", err)
			return err
		}

		var termSeparator byte = 0xff
		var termSeparatorSplitSlice = []byte{termSeparator}

		// pick the terms for the given docNum
		uncompressed = uncompressed[start:end]
		for {
			i := bytes.Index(uncompressed, termSeparatorSplitSlice)
			if i < 0 {
				break
			}

			fmt.Printf(" %s ", uncompressed[0:i])
			uncompressed = uncompressed[i+1:]
		}
		fmt.Printf(" \n ")
		return nil
	},
}

func getDocValueLocs(docNum uint64, metaHeader []zap.MetaData) (uint64, uint64) {
	i := sort.Search(len(metaHeader), func(i int) bool {
		return metaHeader[i].DocNum >= docNum
	})
	if i < len(metaHeader) && metaHeader[i].DocNum == docNum {
		return zap.ReadDocValueBoundary(i, metaHeader)
	}
	return math.MaxUint64, math.MaxUint64
}

func metaDataDocNums(metaHeader []zap.MetaData) string {
	docNums := ""
	for _, meta := range metaHeader {
		docNums += fmt.Sprintf("%d", meta.DocNum) + ", "
	}
	return docNums
}

func readChunkBoundary(chunk int, offsets []uint64) (uint64, uint64) {
	var start uint64
	if chunk > 0 {
		start = offsets[chunk-1]
	}
	return start, offsets[chunk]
}

func init() {
	RootCmd.AddCommand(docvalueCmd)
}
