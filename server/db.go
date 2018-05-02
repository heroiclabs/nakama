// Copyright 2018 The Nakama Authors
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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	dbErrorUniqueViolation = "23505"
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
