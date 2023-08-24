// Copyright (c) 2016 Uber Technologies, Inc.
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

// Package flags provides an interface for automatically creating command line
// options from a struct.
//
// Typically, if one wants to load from a yaml, one has to define a proper
// struct, then yaml.Unmarshal(), this is all good. However, there are
// situations where we want to load most of the configs from the file but
// overriding some configs.
//
// Let's say we use a yaml to config our Db connections and upon start of the
// application we load from the yaml file to get the necessary parameters to
// create the connection. Our base.yaml looks like this
//
//	base.yaml
//	---
//	mysql:
//	  user: 'foo'
//	  password: 'xxxxxx'
//	  mysql_defaults_file: ./mysql_defaults.ini
//	  mysql_socket_path: /var/run/mysqld/mysqld.sock
//	  ... more config options ...
//
// we want to load all the configs from it but we want to provide some
// flexibility for the program to connect via a different db user. We could
// define a --user command flag then after loading the yaml file, we override
// the user field with what we get from --user flag.
//
// If there are many overriding like this, manual define these flags is
// tedious. This package provides an automatic way to define this override,
// which is, given a struct, it'll create all the flags which are name using
// the field names of the struct. If one of these flags are set via command
// line, the struct will be modified in-place to reflect the value from command
// line, therefore the values of the fields in the struct are overridden
//
// YAML is just used as an example here. In practice, one can use any struct
// to define flags.
//
// Let's say we have our configration object as the following.
//
//	type logging struct {
//		 Interval int
//		 Path     string
//	}
//
//	type socket struct {
//		 ReadTimeout  time.Duration
//		 WriteTimeout time.Duration
//	}
//
//	type tcp struct {
//		 ReadTimeout time.Duration
//		 socket
//	}
//
//	type network struct {
//		 ReadTimeout  time.Duration
//		 WriteTimeout time.Duration
//		 tcp
//	}
//
//	type Cfg struct {
//		 logging
//		 network
//	}
//
// The following code
//
//	func main() {
//	  c := &Cfg{}
//	  flags.ParseArgs(c, os.Args[1:])
//	}
//
// will create the following flags
//
//	-logging.interval int
//	      logging.interval
//	-logging.path string
//	      logging.path
//	-network.readtimeout duration
//	      network.readtimeout
//	-network.tcp.readtimeout duration
//	      network.tcp.readtimeout
//	-network.tcp.socket.readtimeout duration
//	      network.tcp.socket.readtimeout
//	-network.tcp.socket.writetimeout duration
//	      network.tcp.socket.writetimeout
//	-network.writetimeout duration
//	      network.writetimeout
//
// flags to subcommands are naturally suported.
//
//	func main() {
//	  cmd := os.Args[1]
//	  switch cmd {
//	    case "new"
//	    c1 := &Cfg1{}
//	    ParseArgs(c1, os.Args[2:])
//	  case "update":
//	    c2 := &Cfg2{}
//	    ParseArgs(c2, os.Args[2:])
//
//	  ... more sub commands ...
//	  }
//	}
//
// One can set Flatten to true when calling NewFlagMakerAdv, in which case,
// flags are created without namespacing. For example,
//
//	type auth struct {
//	 Token string
//	 Tag   float64
//	}
//
//	type credentials struct {
//	 User     string
//	 Password string
//	 auth
//	}
//
//	type database struct {
//	 DBName    string
//	 TableName string
//	 credentials
//	}
//
//	type Cfg struct {
//	 logging
//	 database
//	}
//
//	func main() {
//	 c := &Cfg{}
//	 flags.ParseArgs(c, os.Args[1:])
//	}
//
// will create the following flags
//
//	-dbname string
//	      dbname
//	-interval int
//	      interval
//	-password string
//	      password
//	-path string
//	      path
//	-tablename string
//	      tablename
//	-tag float
//	      tag
//	-token string
//	      token
//	-user string
//	      user
//
// Please be aware that usual GoLang flag creation rules apply, i.e., if there are
// duplication in flag names (in the flattened case it's more likely to happen
// unless the caller make due dilligence to create the struct properly), it panics.
//
// Note that not all types can have command line flags created for. map, channel
// and function type will not defien a flag corresponding to the field. Pointer
// types are properly handled and slice type will create multi-value command
// line flags. That is, e.g. if a field foo's type is []int, one can use
// --foo 10 --foo 15 --foo 20 to override this field value to be
// []int{10, 15, 20}. For now, only []int, []string and []float64 are supported
// in this fashion.
package flags

import (
	"flag"
	"fmt"
	"reflect"
	"strings"
	"time"
)

// FlagMakingOptions control the way FlagMaker's behavior when defining flags.
type FlagMakingOptions struct {
	// Use lower case flag names rather than the field name/tag name directly.
	UseLowerCase bool
	// Create flags in namespaced fashion
	Flatten bool
	// If there is a struct tag named 'TagName', use its value as the flag name.
	// The purpose is that, for yaml/json parsing we often have something like
	// Foobar string `yaml:"host_name"`, in which case the flag will be named
	// 'host_name' rather than 'foobar'.
	TagName string
	// If there is a struct tag named 'TagUsage', use its value as the usage description.
	TagUsage string
}

// FlagMaker enumerate all the exported fields of a struct recursively
// and create corresponding command line flags. For anonymous fields,
// they are only enumerated if they are pointers to structs.
// Usual GoLang flag rules apply, e.g. duplicated flag names leads to
// panic.
type FlagMaker struct {
	opts *FlagMakingOptions
	// We don't consume os.Args directly unless told to.
	fs *flag.FlagSet
}

// NewFlagMaker creates a default FlagMaker which creates namespaced flags
func NewFlagMaker() *FlagMaker {
	return NewFlagMakerAdv(&FlagMakingOptions{
		UseLowerCase: true,
		Flatten:      false,
		TagName:      "yaml",
		TagUsage:     "usage"})
}

// NewFlagMakerAdv gives full control to create flags.
func NewFlagMakerAdv(options *FlagMakingOptions) *FlagMaker {
	return &FlagMaker{
		opts: options,
		fs:   flag.NewFlagSet("xFlags", flag.ContinueOnError),
	}
}

// NewFlagMakerFlagSet gives full control to create flags.
func NewFlagMakerFlagSet(options *FlagMakingOptions, fs *flag.FlagSet) *FlagMaker {
	return &FlagMaker{
		opts: options,
		fs:   fs,
	}
}

// ParseArgs parses the string arguments which should not contain the program name.
//
// obj is the struct to populate. args are the command line arguments,
// typically obtained from os.Args.
func ParseArgs(obj interface{}, args []string) ([]string, error) {
	fm := NewFlagMaker()
	return fm.ParseArgs(obj, args)
}

// PrintDefaults prints the default value and type of defined flags.
// It just calls the standard 'flag' package's PrintDefaults.
func (fm *FlagMaker) PrintDefaults() {
	fm.fs.PrintDefaults()
}

// ParseArgs parses the arguments based on the FlagMaker's setting.
func (fm *FlagMaker) ParseArgs(obj interface{}, args []string) ([]string, error) {
	v := reflect.ValueOf(obj)
	if v.Kind() != reflect.Ptr {
		return args, fmt.Errorf("top level object must be a pointer. %v is passed", v.Type())
	}
	if v.IsNil() {
		return args, fmt.Errorf("top level object cannot be nil")
	}

	switch e := v.Elem(); e.Kind() {
	case reflect.Struct:
		fm.enumerateAndCreate("", e, "")
	case reflect.Interface:
		if e.Elem().Kind() == reflect.Ptr {
			fm.enumerateAndCreate("", e, "")
		} else {
			return args, fmt.Errorf("interface must have pointer underlying type. %v is passed", v.Type())
		}
	default:
		return args, fmt.Errorf("object must be a pointer to struct or interface. %v is passed", v.Type())
	}

	err := fm.fs.Parse(args)
	return fm.fs.Args(), err
}

func (fm *FlagMaker) enumerateAndCreate(prefix string, value reflect.Value, usage string) {
	switch value.Kind() {
	case
		// do no create flag for these types
		reflect.Map,
		reflect.Uintptr,
		reflect.UnsafePointer,
		reflect.Array,
		reflect.Chan,
		reflect.Func:
		return
	case reflect.Slice:
		// only support slice of strings, ints and float64s
		switch value.Type().Elem().Kind() {
		case reflect.String:
			fm.defineStringSlice(prefix, value, usage)
		case reflect.Int:
			fm.defineIntSlice(prefix, value, usage)
		case reflect.Float64:
			fm.defineFloat64Slice(prefix, value, usage)
		}
		return
	case
		// Basic value types
		reflect.String,
		reflect.Bool,
		reflect.Float32, reflect.Float64,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		fm.defineFlag(prefix, value, usage)
		return
	case reflect.Interface:
		if !value.IsNil() {
			fm.enumerateAndCreate(prefix, value.Elem(), usage)
		}
		return
	case reflect.Ptr:
		if value.IsNil() {
			value.Set(reflect.New(value.Type().Elem()))
		}
		fm.enumerateAndCreate(prefix, value.Elem(), usage)
		return
	case reflect.Struct:
		// keep going
	default:
		panic(fmt.Sprintf("unknown reflected kind %v", value.Kind()))
	}

	numFields := value.NumField()
	tt := value.Type()

	for i := 0; i < numFields; i++ {
		stField := tt.Field(i)
		// Skip unexported fields, as only exported fields can be set. This is similar to how json and yaml work.
		if stField.PkgPath != "" && !stField.Anonymous {
			continue
		}
		if stField.Anonymous && fm.getUnderlyingType(stField.Type).Kind() != reflect.Struct {
			continue
		}
		field := value.Field(i)
		optName := fm.getName(stField)
		if len(prefix) > 0 && !fm.opts.Flatten {
			optName = prefix + "." + optName
		}

		usageDesc := fm.getUsage(optName, stField)
		//if len(usageDesc) == 0 {
		//	optName = optName
		//}

		fm.enumerateAndCreate(optName, field, usageDesc)
	}
}

func (fm *FlagMaker) getName(field reflect.StructField) string {
	name := field.Tag.Get(fm.opts.TagName)
	if len(name) == 0 {
		if field.Anonymous {
			name = fm.getUnderlyingType(field.Type).Name()
		} else {
			name = field.Name
		}
	}
	if fm.opts.UseLowerCase {
		return strings.ToLower(name)
	}
	return name
}

func (fm *FlagMaker) getUsage(name string, field reflect.StructField) string {
	usage := field.Tag.Get(fm.opts.TagUsage)
	if len(usage) == 0 {
		usage = name
	}
	return usage
}

func (fm *FlagMaker) getUnderlyingType(ttype reflect.Type) reflect.Type {
	// this only deals with *T unnamed type, other unnamed types, e.g. []int, struct{}
	// will return empty string.
	if ttype.Kind() == reflect.Ptr {
		return fm.getUnderlyingType(ttype.Elem())
	}
	return ttype
}

// Each object has its type (which prescribes the possible operations/methods
// could be invoked; it also has an underlying 'kind', int, float, struct etc.
// Since user can freely define types, one 'kind' of object may correpond to
// many types. We cannot do type assertion because types of same kind are still
// different types. Instead, we convert to the primitive types that corresponds
// to the kinds and create flag vars. One thing to know is that, the whole point
// of defineFlag() method is to define flag.Vars that points to certain field
// of the struct so that command line values can modify the struct. We cannot
// define a flag var pointing to arbitrary 'free' varible.

// I wish GoLang had macro...
var (
	stringPtrType  = reflect.TypeOf((*string)(nil))
	boolPtrType    = reflect.TypeOf((*bool)(nil))
	float32PtrType = reflect.TypeOf((*float32)(nil))
	float64PtrType = reflect.TypeOf((*float64)(nil))
	intPtrType     = reflect.TypeOf((*int)(nil))
	int8PtrType    = reflect.TypeOf((*int8)(nil))
	int16PtrType   = reflect.TypeOf((*int16)(nil))
	int32PtrType   = reflect.TypeOf((*int32)(nil))
	int64PtrType   = reflect.TypeOf((*int64)(nil))
	uintPtrType    = reflect.TypeOf((*uint)(nil))
	uint8PtrType   = reflect.TypeOf((*uint8)(nil))
	uint16PtrType  = reflect.TypeOf((*uint16)(nil))
	uint32PtrType  = reflect.TypeOf((*uint32)(nil))
	uint64PtrType  = reflect.TypeOf((*uint64)(nil))
)

func (fm *FlagMaker) defineFlag(name string, value reflect.Value, usage string) {
	// v must be scalar, otherwise panic
	ptrValue := value.Addr()
	switch value.Kind() {
	case reflect.String:
		v := ptrValue.Convert(stringPtrType).Interface().(*string)
		fm.fs.StringVar(v, name, value.String(), usage)
	case reflect.Bool:
		v := ptrValue.Convert(boolPtrType).Interface().(*bool)
		fm.fs.BoolVar(v, name, value.Bool(), usage)
	case reflect.Int:
		v := ptrValue.Convert(intPtrType).Interface().(*int)
		fm.fs.IntVar(v, name, int(value.Int()), usage)
	case reflect.Int8:
		v := ptrValue.Convert(int8PtrType).Interface().(*int8)
		fm.fs.Var(newInt8Value(v), name, usage)
	case reflect.Int16:
		v := ptrValue.Convert(int16PtrType).Interface().(*int16)
		fm.fs.Var(newInt16Value(v), name, usage)
	case reflect.Int32:
		v := ptrValue.Convert(int32PtrType).Interface().(*int32)
		fm.fs.Var(newInt32Value(v), name, usage)
	case reflect.Int64:
		switch v := ptrValue.Interface().(type) {
		case *int64:
			fm.fs.Int64Var(v, name, value.Int(), usage)
		case *time.Duration:
			fm.fs.DurationVar(v, name, value.Interface().(time.Duration), usage)
		default:
			// (TODO) if one type defines time.Duration, we'll create a int64 flag for it.
			// Find some acceptable way to deal with it.
			vv := ptrValue.Convert(int64PtrType).Interface().(*int64)
			fm.fs.Int64Var(vv, name, value.Int(), usage)
		}
	case reflect.Float32:
		v := ptrValue.Convert(float32PtrType).Interface().(*float32)
		fm.fs.Var(newFloat32Value(v), name, usage)
	case reflect.Float64:
		v := ptrValue.Convert(float64PtrType).Interface().(*float64)
		fm.fs.Float64Var(v, name, value.Float(), usage)
	case reflect.Uint:
		v := ptrValue.Convert(uintPtrType).Interface().(*uint)
		fm.fs.UintVar(v, name, uint(value.Uint()), usage)
	case reflect.Uint8:
		v := ptrValue.Convert(uint8PtrType).Interface().(*uint8)
		fm.fs.Var(newUint8Value(v), name, usage)
	case reflect.Uint16:
		v := ptrValue.Convert(uint16PtrType).Interface().(*uint16)
		fm.fs.Var(newUint16Value(v), name, usage)
	case reflect.Uint32:
		v := ptrValue.Convert(uint32PtrType).Interface().(*uint32)
		fm.fs.Var(newUint32Value(v), name, usage)
	case reflect.Uint64:
		v := ptrValue.Convert(uint64PtrType).Interface().(*uint64)
		fm.fs.Uint64Var(v, name, value.Uint(), usage)
	}
}

func (fm *FlagMaker) defineStringSlice(name string, value reflect.Value, usage string) {
	ptrValue := value.Addr().Interface().(*[]string)
	fm.fs.Var(newStringSlice(ptrValue), name, usage)
}

func (fm *FlagMaker) defineIntSlice(name string, value reflect.Value, usage string) {
	ptrValue := value.Addr().Interface().(*[]int)
	fm.fs.Var(newIntSlice(ptrValue), name, usage)
}

func (fm *FlagMaker) defineFloat64Slice(name string, value reflect.Value, usage string) {
	ptrValue := value.Addr().Interface().(*[]float64)
	fm.fs.Var(newFloat64Slice(ptrValue), name, usage)
}
