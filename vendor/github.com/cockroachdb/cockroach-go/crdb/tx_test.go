// Copyright 2016 The Cockroach Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied. See the License for the specific language governing
// permissions and limitations under the License.

package crdb

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"

	"github.com/cockroachdb/cockroach-go/testserver"
)

func TestExecuteTx(t *testing.T) {
	testExecuteTxInner(t, ExecuteTx)
}

func TestExecuteInTx(t *testing.T) {
	executeTx := func(
		ctx context.Context,
		db *sql.DB,
		opts *sql.TxOptions,
		fn func(*sql.Tx) error,
	) error {
		tx, err := db.BeginTx(ctx, opts)
		if err != nil {
			return err
		}
		return ExecuteInTx(ctx, tx, func() error { return fn(tx) })
	}
	testExecuteTxInner(t, executeTx)
}

// TestExecuteTx verifies transaction retry using the classic
// example of write skew in bank account balance transfers.
func testExecuteTxInner(
	t *testing.T,
	executeTxFn func(
		context.Context,
		*sql.DB,
		*sql.TxOptions,
		func(*sql.Tx) error,
	) error,
) {
	db, stop := testserver.NewDBForTest(t)
	defer stop()

	initStmt := `
CREATE DATABASE d;
CREATE TABLE d.t (acct INT PRIMARY KEY, balance INT);
INSERT INTO d.t (acct, balance) VALUES (1, 100), (2, 100);
`
	if _, err := db.Exec(initStmt); err != nil {
		t.Fatal(err)
	}

	type queryI interface {
		Query(string, ...interface{}) (*sql.Rows, error)
	}

	getBalances := func(q queryI) (bal1, bal2 int, err error) {
		var rows *sql.Rows
		rows, err = q.Query(`SELECT balance FROM d.t WHERE acct IN (1, 2);`)
		if err != nil {
			return
		}
		defer rows.Close()
		balances := []*int{&bal1, &bal2}
		i := 0
		for ; rows.Next(); i++ {
			if err = rows.Scan(balances[i]); err != nil {
				return
			}
		}
		if i != 2 {
			err = fmt.Errorf("expected two balances; got %d", i)
			return
		}
		return
	}

	runTxn := func(wg *sync.WaitGroup, iter *int) <-chan error {
		errCh := make(chan error, 1)
		go func() {
			*iter = 0
			errCh <- executeTxFn(context.Background(), db, nil, func(tx *sql.Tx) error {
				*iter++
				bal1, bal2, err := getBalances(tx)
				if err != nil {
					return err
				}
				// If this is the first iteration, wait for the other tx to also read.
				if *iter == 1 {
					wg.Done()
					wg.Wait()
				}
				// Now, subtract from one account and give to the other.
				if bal1 > bal2 {
					if _, err := tx.Exec(`
UPDATE d.t SET balance=balance-100 WHERE acct=1;
UPDATE d.t SET balance=balance+100 WHERE acct=2;
`); err != nil {
						return err
					}
				} else {
					if _, err := tx.Exec(`
UPDATE d.t SET balance=balance+100 WHERE acct=1;
UPDATE d.t SET balance=balance-100 WHERE acct=2;
`); err != nil {
						return err
					}
				}
				return nil
			})
		}()
		return errCh
	}

	var wg sync.WaitGroup
	wg.Add(2)
	var iters1, iters2 int
	txn1Err := runTxn(&wg, &iters1)
	txn2Err := runTxn(&wg, &iters2)
	if err := <-txn1Err; err != nil {
		t.Errorf("expected success in txn1; got %s", err)
	}
	if err := <-txn2Err; err != nil {
		t.Errorf("expected success in txn2; got %s", err)
	}
	if iters1+iters2 <= 2 {
		t.Errorf("expected at least one retry between the competing transactions; "+
			"got txn1=%d, txn2=%d", iters1, iters2)
	}
	bal1, bal2, err := getBalances(db)
	if err != nil || bal1 != 100 || bal2 != 100 {
		t.Errorf("expected balances to be restored without error; "+
			"got acct1=%d, acct2=%d: %s", bal1, bal2, err)
	}
}
