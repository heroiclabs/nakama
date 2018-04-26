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
	"fmt"

	"github.com/spf13/cobra"
)

// footerCmd represents the footer command
var footerCmd = &cobra.Command{
	Use:   "footer [path]",
	Short: "prints the contents of the zap footer",
	Long:  `The footer command will print the contents of the footer.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		data := segment.Data()
		fmt.Printf("Length: %d\n", len(data))
		fmt.Printf("CRC: %#x\n", segment.CRC())
		fmt.Printf("Version: %d\n", segment.Version())
		fmt.Printf("Chunk Factor: %d\n", segment.ChunkFactor())
		fmt.Printf("Fields Idx: %d (%#x)\n", segment.FieldsIndexOffset(), segment.FieldsIndexOffset())
		fmt.Printf("Stored Idx: %d (%#x)\n", segment.StoredIndexOffset(), segment.StoredIndexOffset())
		fmt.Printf("DocValue Idx: %d (%#x)\n", segment.DocValueOffset(), segment.DocValueOffset())
		fmt.Printf("Num Docs: %d\n", segment.NumDocs())
		return nil
	},
}

func init() {
	RootCmd.AddCommand(footerCmd)
}
