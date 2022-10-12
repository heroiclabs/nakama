package process

import (
	"os"
	"strings"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/require"
)

type Process struct {
	env map[string]string
}

func Require(runtime *goja.Runtime, module *goja.Object) {
	p := &Process{
		env: make(map[string]string),
	}

	for _, e := range os.Environ() {
		envKeyValue := strings.SplitN(e, "=", 2)
		p.env[envKeyValue[0]] = envKeyValue[1]
	}

	o := module.Get("exports").(*goja.Object)
	o.Set("env", p.env)
}

func Enable(runtime *goja.Runtime) {
	runtime.Set("process", require.Require(runtime, "process"))
}

func init() {
	require.RegisterNativeModule("process", Require)
}
