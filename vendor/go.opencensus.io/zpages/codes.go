// Copyright 2017, OpenCensus Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package zpages

type code int

const (
	OK code = iota
	CANCELLED
	UNKNOWN
	INVALID_ARGUMENT
	DEADLINE_EXCEEDED
	NOT_FOUND
	ALREADY_EXISTS
	PERMISSION_DENIED
	RESOURCE_EXHAUSTED
	FAILED_PRECONDITION
	ABORTED
	OUT_OF_RANGE
	UNIMPLEMENTED
	INTERNAL
	UNAVAILABLE
	DATA_LOSS
	UNAUTHENTICATED
)
