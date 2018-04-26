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

package boltsmat

import (
	"fmt"
	"io/ioutil"
	"math/rand"
	"os"

	"github.com/boltdb/bolt"
	"github.com/mschoch/smat"
)

// Fuzz using state machine driven by byte stream
func Fuzz(data []byte) int {
	return smat.Fuzz(&context{}, setup, teardown, actionMap, data)
}

// Context
type context struct {
	path   string
	db     *bolt.DB
	tx     *bolt.Tx
	bucket *bolt.Bucket
}

// *** States ***

func dbOpen(next byte) smat.ActionID {
	return smat.PercentExecute(next,
		smat.PercentAction{10, closeReopen},
		smat.PercentAction{90, startWriteTx},
	)
}

func writeTxOpen(next byte) smat.ActionID {
	return smat.PercentExecute(next,
		smat.PercentAction{30, setRandom},
		smat.PercentAction{30, deleteRandom},
		smat.PercentAction{30, commitTx},
		smat.PercentAction{10, rollbackTx},
	)
}

// *** Actions ***
const (
	setup smat.ActionID = iota
	teardown
	closeReopen
	startWriteTx
	setRandom
	deleteRandom
	commitTx
	rollbackTx
)

var actionMap = smat.ActionMap{
	setup:        setupFunc,
	teardown:     teardownFunc,
	closeReopen:  closeReopenFunc,
	startWriteTx: startWriteTxFunc,
	setRandom:    setRandomFunc,
	deleteRandom: deleteRandomFunc,
	commitTx:     commitTxFunc,
	rollbackTx:   rollbackTxFunc,
}

func setupFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	context.path, err = ioutil.TempDir("", "cellar")
	if err != nil {
		return nil, err
	}
	context.path += string(os.PathSeparator) + "fuzz.db"
	context.db, err = bolt.Open(context.path, 0600, nil)
	if err != nil {
		return nil, err
	}
	return dbOpen, nil
}

func teardownFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	if context.tx != nil {
		_ = context.tx.Rollback()
		context.tx = nil
	}
	if context.db != nil {
		_ = context.db.Close()
		context.db = nil
	}
	_ = os.RemoveAll(context.path)
	return nil, nil
}

func closeReopenFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	err = context.db.Close()
	if err != nil {
		return nil, err
	}
	context.db, err = bolt.Open(context.path, 0600, nil)
	if err != nil {
		return nil, err
	}
	return dbOpen, nil
}

func startWriteTxFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	context.tx, err = context.db.Begin(true)
	if err != nil {
		return nil, err
	}
	return writeTxOpen, nil
}

func setRandomFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	if context.bucket == nil {
		context.bucket, err = context.tx.CreateBucketIfNotExists([]byte("default"))
		if err != nil {
			return nil, err
		}
	}
	err = context.bucket.Put(randomKey(), randomVal())
	if err != nil {
		return nil, err
	}
	return writeTxOpen, nil
}

func deleteRandomFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	if context.bucket == nil {
		context.bucket, err = context.tx.CreateBucketIfNotExists([]byte("default"))
		if err != nil {
			return nil, err
		}
	}
	err = context.bucket.Delete(randomKey())
	if err != nil {
		return nil, err
	}
	return writeTxOpen, nil
}

func commitTxFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	err = context.tx.Commit()
	if err != nil {
		return nil, err
	}
	context.tx = nil
	context.bucket = nil
	return dbOpen, nil
}

func rollbackTxFunc(ctx smat.Context) (next smat.State, err error) {
	context := ctx.(*context)
	err = context.tx.Rollback()
	if err != nil {
		return nil, err
	}
	context.tx = nil
	context.bucket = nil
	return dbOpen, nil
}

func randomKey() []byte {
	num := rand.Int63()
	return []byte(fmt.Sprintf("k%016x", num))
}

func randomVal() []byte {
	num := rand.Int63()
	return []byte(fmt.Sprintf("v%016x", num))
}
