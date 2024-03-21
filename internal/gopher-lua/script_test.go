package lua

import (
	"fmt"
	"os"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/heroiclabs/nakama/v3/internal/gopher-lua/parse"
)

const maxMemory = 40

var gluaTests []string = []string{
	"base.lua",
	"coroutine.lua",
	"db.lua",
	"issues.lua",
	"os.lua",
	"table.lua",
	"vm.lua",
	"math.lua",
	"strings.lua",
	"goto.lua",
}

var luaTests []string = []string{
	"attrib.lua",
	"calls.lua",
	"closure.lua",
	"constructs.lua",
	"events.lua",
	"literals.lua",
	"locals.lua",
	"math.lua",
	"sort.lua",
	"strings.lua",
	"vararg.lua",
	"pm.lua",
	"files.lua",
}

func testScriptCompile(t *testing.T, script string) {
	file, err := os.Open(script)
	if err != nil {
		t.Fatal(err)
		return
	}
	chunk, err2 := parse.Parse(file, script)
	if err2 != nil {
		t.Fatal(err2)
		return
	}
	parse.Dump(chunk)
	proto, err3 := Compile(chunk, script)
	if err3 != nil {
		t.Fatal(err3)
		return
	}
	nop := func(s string) {}
	nop(proto.String())
}

func testScriptDir(t *testing.T, tests []string, directory string) {
	if err := os.Chdir(directory); err != nil {
		t.Error(err)
	}
	defer os.Chdir("..")

	for _, script := range tests {
		fmt.Printf("testing %s/%s\n", directory, script)
		testScriptCompile(t, script)
		L := NewState(Options{
			RegistrySize:        1024 * 20,
			CallStackSize:       1024,
			IncludeGoStackTrace: true,
		})
		L.SetMx(maxMemory)
		if err := L.DoFile(script); err != nil {
			t.Error(err)
		}
		L.Close()
	}
}

var numActiveUserDatas int32 = 0

type finalizerStub struct{ x byte }

func allocFinalizerUserData(L *LState) int {
	ud := L.NewUserData()
	atomic.AddInt32(&numActiveUserDatas, 1)
	a := finalizerStub{}
	ud.Value = &a
	runtime.SetFinalizer(&a, func(aa *finalizerStub) {
		atomic.AddInt32(&numActiveUserDatas, -1)
	})
	L.Push(ud)
	return 1
}

func sleep(L *LState) int {
	time.Sleep(time.Duration(L.CheckInt(1)) * time.Millisecond)
	return 0
}

func countFinalizers(L *LState) int {
	L.Push(LNumber(atomic.LoadInt32(&numActiveUserDatas)))
	return 1
}

// TestLocalVarFree verifies that tables and user user datas which are no longer referenced by the lua script are
// correctly gc-ed. There was a bug in gopher lua where local vars were not being gc-ed in all circumstances.
func TestLocalVarFree(t *testing.T) {
	s := `
		function Test(a, b, c)
			local a = { v = allocFinalizer() }
			local b = { v = allocFinalizer() }
			return a
		end
		Test(1,2,3)
		for i = 1, 100 do
			collectgarbage()
			if countFinalizers() == 0 then
				return
			end
			sleep(100)
		end
		error("user datas not finalized after 100 gcs")
`
	L := NewState()
	L.SetGlobal("allocFinalizer", L.NewFunction(allocFinalizerUserData))
	L.SetGlobal("sleep", L.NewFunction(sleep))
	L.SetGlobal("countFinalizers", L.NewFunction(countFinalizers))
	defer L.Close()
	if err := L.DoString(s); err != nil {
		t.Error(err)
	}
}

func TestGlua(t *testing.T) {
	testScriptDir(t, gluaTests, "_glua-tests")
}

func TestLua(t *testing.T) {
	testScriptDir(t, luaTests, "_lua5.1-tests")
}
