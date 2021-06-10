// Copyright 2019 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"errors"
	"fmt"

	"github.com/jackc/pgerrcode"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	dbErrorUniqueViolation = pgerrcode.UniqueViolation
)

var ErrRowsAffectedCount = errors.New("rows_affected_count")

// A type that wraps an outgoing client-facing error together with an underlying cause error.
type statusError struct {
	code   codes.Code
	status error
	cause  error
}

// Implement the error interface.
func (s *statusError) Error() string {
	return s.status.Error()
}

// Implement the crdb.ErrorCauser interface to allow the crdb.ExecuteInTx wrapper to figure out whether to retry or not.
func (s *statusError) Cause() error {
	return s.cause
}

func (s *statusError) Status() error {
	return s.status
}

func (s *statusError) Code() codes.Code {
	return s.code
}

// Helper function for creating status errors that wrap underlying causes, usually DB errors.
func StatusError(code codes.Code, msg string, cause error) error {
	return &statusError{
		code:   code,
		status: status.Error(code, msg),
		cause:  cause,
	}
}

// ErrorCauser is the type implemented by an error that remembers its cause.
//
// ErrorCauser is intentionally equivalent to the causer interface used by
// the github.com/pkg/errors package.
type ErrorCauser interface {
	// Cause returns the proximate cause of this error.
	Cause() error
}

// errorCause returns the original cause of the error, if possible. An error has
// a proximate cause if it implements ErrorCauser; the original cause is the
// first error in the cause chain that does not implement ErrorCauser.
//
// errorCause is intentionally equivalent to pkg/errors.Cause.
func errorCause(err error) error {
	for err != nil {
		cause, ok := err.(ErrorCauser)
		if !ok {
			break
		}
		err = cause.Cause()
	}
	return err
}

type txError struct {
	cause error
}

// Error implements the error interface.
func (e *txError) Error() string { return e.cause.Error() }

// Cause implements the ErrorCauser interface.
func (e *txError) Cause() error { return e.cause }

// AmbiguousCommitError represents an error that left a transaction in an
// ambiguous state: unclear if it committed or not.
type AmbiguousCommitError struct {
	txError
}

func newAmbiguousCommitError(err error) *AmbiguousCommitError {
	return &AmbiguousCommitError{txError{cause: err}}
}

// TxnRestartError represents an error when restarting a transaction. `cause` is
// the error from restarting the txn and `retryCause` is the original error which
// triggered the restart.
type TxnRestartError struct {
	txError
	retryCause error
	msg        string
}

func newTxnRestartError(err error, retryErr error) *TxnRestartError {
	const msgPattern = "restarting txn failed. ROLLBACK TO SAVEPOINT " +
		"encountered error: %s. Original error: %s."
	return &TxnRestartError{
		txError:    txError{cause: err},
		retryCause: retryErr,
		msg:        fmt.Sprintf(msgPattern, err, retryErr),
	}
}

// Error implements the error interface.
func (e *TxnRestartError) Error() string { return e.msg }

// RetryCause returns the error that caused the transaction to be restarted.
func (e *TxnRestartError) RetryCause() error { return e.retryCause }
