//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package flags

import (
	"fmt"
	"strconv"
)

// additional types
type int8Value int8
type int16Value int16
type int32Value int32
type f32Value float32
type uint8Value uint8
type uint32Value uint32
type uint16Value uint16

// Var handlers for each of the types
func newInt8Value(p *int8) *int8Value {
	return (*int8Value)(p)
}

func newInt16Value(p *int16) *int16Value {
	return (*int16Value)(p)
}

func newInt32Value(p *int32) *int32Value {
	return (*int32Value)(p)
}

func newFloat32Value(p *float32) *f32Value {
	return (*f32Value)(p)
}

func newUint8Value(p *uint8) *uint8Value {
	return (*uint8Value)(p)
}

func newUint16Value(p *uint16) *uint16Value {
	return (*uint16Value)(p)
}

func newUint32Value(p *uint32) *uint32Value {
	return (*uint32Value)(p)
}

// Setters for each of the types
func (f *int8Value) Set(s string) error {
	v, err := strconv.ParseInt(s, 10, 8)
	if err != nil {
		return err
	}
	*f = int8Value(v)
	return nil
}

func (f *int16Value) Set(s string) error {
	v, err := strconv.ParseInt(s, 10, 16)
	if err != nil {
		return err
	}
	*f = int16Value(v)
	return nil
}

func (f *int32Value) Set(s string) error {
	v, err := strconv.ParseInt(s, 10, 32)
	if err != nil {
		return err
	}
	*f = int32Value(v)
	return nil
}

func (f *f32Value) Set(s string) error {
	v, err := strconv.ParseFloat(s, 32)
	if err != nil {
		return err
	}
	*f = f32Value(v)
	return nil
}

func (f *uint8Value) Set(s string) error {
	v, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		return err
	}
	*f = uint8Value(v)
	return nil
}

func (f *uint16Value) Set(s string) error {
	v, err := strconv.ParseUint(s, 10, 16)
	if err != nil {
		return err
	}
	*f = uint16Value(v)
	return nil
}

func (f *uint32Value) Set(s string) error {
	v, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		return err
	}
	*f = uint32Value(v)
	return nil
}

// Getters for each of the types
func (f *int8Value) Get() interface{}   { return int8(*f) }
func (f *int16Value) Get() interface{}  { return int16(*f) }
func (f *int32Value) Get() interface{}  { return int32(*f) }
func (f *f32Value) Get() interface{}    { return float32(*f) }
func (f *uint8Value) Get() interface{}  { return uint8(*f) }
func (f *uint16Value) Get() interface{} { return uint16(*f) }
func (f *uint32Value) Get() interface{} { return uint32(*f) }

// Stringers for each of the types
func (f *int8Value) String() string   { return fmt.Sprintf("%v", *f) }
func (f *int16Value) String() string  { return fmt.Sprintf("%v", *f) }
func (f *int32Value) String() string  { return fmt.Sprintf("%v", *f) }
func (f *f32Value) String() string    { return fmt.Sprintf("%v", *f) }
func (f *uint8Value) String() string  { return fmt.Sprintf("%v", *f) }
func (f *uint16Value) String() string { return fmt.Sprintf("%v", *f) }
func (f *uint32Value) String() string { return fmt.Sprintf("%v", *f) }

// string slice

// string slice

type strSlice struct {
	s   *[]string
	set bool // if there a flag defined via command line, the slice will be cleared first.
}

func newStringSlice(p *[]string) *strSlice {
	return &strSlice{
		s:   p,
		set: false,
	}
}

func (s *strSlice) Set(str string) error {
	if !s.set {
		*s.s = (*s.s)[:0]
		s.set = true
	}
	*s.s = append(*s.s, str)
	return nil
}

func (s *strSlice) Get() interface{} {
	return []string(*s.s)
}

func (s *strSlice) String() string {
	return fmt.Sprintf("%v", s.s)
}

// int slice
type intSlice struct {
	s   *[]int
	set bool
}

func newIntSlice(p *[]int) *intSlice {
	return &intSlice{
		s:   p,
		set: false,
	}
}

func (is *intSlice) Set(str string) error {
	i, err := strconv.Atoi(str)
	if err != nil {
		return err
	}
	if !is.set {
		*is.s = (*is.s)[:0]
		is.set = true
	}
	*is.s = append(*is.s, i)
	return nil
}

func (is *intSlice) Get() interface{} {
	return []int(*is.s)
}

func (is *intSlice) String() string {
	return fmt.Sprintf("%v", is.s)
}

// float64 slice
type float64Slice struct {
	s   *[]float64
	set bool
}

func newFloat64Slice(p *[]float64) *float64Slice {
	return &float64Slice{
		s:   p,
		set: false,
	}
}

func (is *float64Slice) Set(str string) error {
	i, err := strconv.ParseFloat(str, 64)
	if err != nil {
		return err
	}
	if !is.set {
		*is.s = (*is.s)[:0]
		is.set = true
	}
	*is.s = append(*is.s, i)
	return nil
}

func (is *float64Slice) Get() interface{} {
	return []float64(*is.s)
}

func (is *float64Slice) String() string {
	return fmt.Sprintf("%v", is.s)
}
