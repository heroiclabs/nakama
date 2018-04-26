//  Copyright (c) 2016 Marty Schoch

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the
//  License. You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//  Unless required by applicable law or agreed to in writing,
//  software distributed under the License is distributed on an "AS
//  IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
//  express or implied. See the License for the specific language
//  governing permissions and limitations under the License.

// +build gofuzz

package boltsmat

import (
	"fmt"
	"io/ioutil"
	"os"
	"testing"

	"github.com/mschoch/smat"
)

func TestGenerateFuzzData(t *testing.T) {
	for i, actionSeq := range actionSeqs {
		byteSequence, err := actionSeq.ByteEncoding(&context{}, setup, teardown, actionMap)
		if err != nil {
			t.Fatal(err)
		}
		os.MkdirAll("workdir/corpus", 0700)
		ioutil.WriteFile(fmt.Sprintf("workdir/corpus/%d", i), byteSequence, 0600)
	}
}

var actionSeqs = []smat.ActionSeq{
	// open tx, write 5 random keys, delete 5 random keys, commit tx
	{
		startWriteTx,
		setRandom,
		setRandom,
		setRandom,
		setRandom,
		setRandom,
		deleteRandom,
		deleteRandom,
		deleteRandom,
		deleteRandom,
		deleteRandom,
		commitTx,
	},
	// open tx, write 5 random keys, rollback
	{
		startWriteTx,
		setRandom,
		setRandom,
		setRandom,
		setRandom,
		setRandom,
		rollbackTx,
	},
	// crasher due to bug in test bug
	{
		startWriteTx,
		setRandom,
		commitTx,
		startWriteTx,
		setRandom,
	},
}
