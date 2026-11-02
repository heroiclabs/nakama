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
	L.Push(LNumber(numActiveUserDatas))
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

func TestMergingLoadNilBug2(t *testing.T) {
	// there was a bug where the LOADNIL merging optimisation would merge LOADNILs that were the targets of
	// JMP instructions, causing the JMP to jump to the wrong location and breaking the logic and resulting in
	// a panic.
	s := `
	id = "foo"

	function get_def()
	  return {}
	end

	function test()
	  local def = id ~= nil and get_def() or nil
	  if def ~= nil then
		print("def is not nil")
	  end
	end

	test()
`
	L := NewState()
	defer L.Close()
	if err := L.DoString(s); err != nil {
		t.Error(err)
	}
}

func TestMergingLoadNilBug(t *testing.T) {
	// there was a bug where a multiple load nils were being incorrectly merged, and the following code exposed it
	s := `
    function test()
        local a = 0
        local b = 1
        local c = 2
        local d = 3
        local e = 4		-- reg 4
        local f = 5
        local g = 6
        local h = 7

        if e == 4 then
            e = nil		-- should clear reg 4, but clears regs 4-8 by mistake
        end
        if f == nil then
            error("bad f")
        end
        if g == nil then
            error("bad g")
        end
        if h == nil then
            error("bad h")
        end
    end

    test()
`

	L := NewState()
	defer L.Close()
	if err := L.DoString(s); err != nil {
		t.Error(err)
	}
}

// This test is disabled because the LOADNIL merging optimisation has been disabled. See the comment in the
// AddLoadNil() function for more information.
//func TestMergingLoadNil(t *testing.T) {
//	// multiple nil assignments to consecutive registers should be merged
//	s := `
//		function test()
//			local a = 0
//			local b = 1
//			local c = 2
//
//			-- this should generate just one LOADNIL byte code instruction
//			a = nil
//			b = nil
//			c = nil
//
//			print(a,b,c)
//		end
//
//		test()`
//
//	chunk, err := parse.Parse(strings.NewReader(s), "test")
//	if err != nil {
//		t.Fatal(err)
//	}
//
//	compiled, err := Compile(chunk, "test")
//	if err != nil {
//		t.Fatal(err)
//	}
//
//	if len(compiled.FunctionPrototypes) != 1 {
//		t.Fatal("expected 1 function prototype")
//	}
//
//	// there should be exactly 1 LOADNIL instruction in the byte code generated for the above
//	// anymore, and the LOADNIL merging is not working correctly
//	count := 0
//	for _, instr := range compiled.FunctionPrototypes[0].Code {
//		if opGetOpCode(instr) == OP_LOADNIL {
//			count++
//		}
//	}
//
//	if count != 1 {
//		t.Fatalf("expected 1 LOADNIL instruction, found %d", count)
//	}
//}
