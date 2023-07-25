
-- issue #10
local function inspect(options)
    options = options or {}
    return type(options)
end
assert(inspect(nil) == "table")

local function inspect(options)
    options = options or setmetatable({}, {__mode = "test"})
    return type(options)
end
assert(inspect(nil) == "table")

-- issue #16
local ok, msg = pcall(function()
  local a = {}
  a[nil] = 1
end)
assert(not ok and string.find(msg, "table index is nil", 1, true))

-- issue #19
local tbl = {1,2,3,4,5}
assert(#tbl == 5)
assert(table.remove(tbl) == 5)
assert(#tbl == 4)
assert(table.remove(tbl, 3) == 3)
assert(#tbl == 3)

-- issue #24
local tbl = {string.find('hello.world', '.', 0)}
assert(tbl[1] == 1 and tbl[2] == 1)
assert(string.sub('hello.world', 0, 2) == "he")

-- issue 33
local a,b
a = function ()
  pcall(function()
  end)
  coroutine.yield("a")
  return b()
end

b = function ()
  return "b"
end

local co = coroutine.create(a)
assert(select(2, coroutine.resume(co)) == "a")
assert(select(2, coroutine.resume(co)) == "b")
assert(coroutine.status(co) == "dead")

-- issue 37
function test(a, b, c)
    b = b or string.format("b%s", a)
    c = c or string.format("c%s", a)
    assert(a == "test")
    assert(b == "btest")
    assert(c == "ctest")
end
test("test")

-- issue 39
assert(string.match("あいうえお", ".*あ.*") == "あいうえお")
assert(string.match("あいうえお", "あいうえお") == "あいうえお")

-- issue 47
assert(string.gsub("A\nA", ".", "A") == "AAA")

-- issue 62
local function level4() error("error!") end
local function level3() level4() end
local function level2() level3() end
local function level1() level2() end
local ok, result = xpcall(level1, function(err)
  return debug.traceback("msg", 10)
end)
assert(result == [[msg
stack traceback:]])
ok, result = xpcall(level1, function(err)
  return debug.traceback("msg", 9)
end)
assert(result == string.gsub([[msg
stack traceback:
@TAB@[G]: ?]], "@TAB@", "\t"))
local ok, result = xpcall(level1, function(err)
  return debug.traceback("msg", 0)
end)

assert(result == string.gsub([[msg
stack traceback:
@TAB@[G]: in function 'traceback'
@TAB@issues.lua:87: in function <issues.lua:86>
@TAB@[G]: in function 'error'
@TAB@issues.lua:71: in function 'level4'
@TAB@issues.lua:72: in function 'level3'
@TAB@issues.lua:73: in function 'level2'
@TAB@issues.lua:74: in function <issues.lua:74>
@TAB@[G]: in function 'xpcall'
@TAB@issues.lua:86: in main chunk
@TAB@[G]: ?]], "@TAB@", "\t"))

local ok, result = xpcall(level1, function(err)
  return debug.traceback("msg", 3)
end)

assert(result == string.gsub([[msg
stack traceback:
@TAB@issues.lua:71: in function 'level4'
@TAB@issues.lua:72: in function 'level3'
@TAB@issues.lua:73: in function 'level2'
@TAB@issues.lua:74: in function <issues.lua:74>
@TAB@[G]: in function 'xpcall'
@TAB@issues.lua:103: in main chunk
@TAB@[G]: ?]], "@TAB@", "\t"))

-- issue 81
local tbl = {
        [-1] = "a",
        [0] = "b",
        [1] = "c",
}
local a, b = next(tbl, nil)
assert( a == -1 and b == "a" or a == 0 and b == "b" or a == 1 and b == "c")
local a, b = next(tbl, a)
assert( a == -1 and b == "a" or a == 0 and b == "b" or a == 1 and b == "c")
local a, b = next(tbl, a)
assert( a == -1 and b == "a" or a == 0 and b == "b" or a == 1 and b == "c")
local a, b = next(tbl, a)
assert( a == nil and b == nil)

local tbl = {'a', 'b'}
local a, b = next(tbl, nil)
assert(a == 1 and b == "a")
local a, b = next(tbl, a)
assert(a == 2 and b == "b")
local a, b = next(tbl, a)
assert(a == nil and b == nil)

-- issue 82
local cr = function()
        return coroutine.wrap(function()
                coroutine.yield(1, "a")
                coroutine.yield(2, "b")
        end)
end

local f = cr()
local a, b = f()
assert(a == 1 and b == "a")
local a, b = f()
assert(a == 2 and b == "b")

-- issue 91, 92
local url = "www.aaa.bbb_abc123-321-cba_abc123"
assert(string.match(url, ".-([%w-]*)[.]*") == "www")

local s = "hello.world"
assert(s:match("([^.]+).world") == "hello")

local s = "hello-world"
assert(s:match("([^-]+)-world") == "hello")

-- issue 93
local t = {}
local ok, msg = pcall(function() t.notfound() end)
assert(not ok and string.find(msg, "attempt to call a non-function object", 1, true))

-- issue 150
local util = {
  fn = function() end
}
local b
local x = util.fn(
  1,
  (b or {}).x)

local s = [=[["a"]['b'][9] - ["a"]['b'][8] > ]=]
local result = {}
for i in s:gmatch([=[[[][^%s,]*[]]]=]) do
  table.insert(result, i)
end
assert(result[1] == [=[["a"]['b'][9]]=])
assert(result[2] == [=[["a"]['b'][8]]=])

-- issue 168
local expected = 1

local result = math.random(1)

assert(result == expected)

-- issue 202
local t = {}
ok, res = pcall(table.remove, t)
if not ok or not res then
    table.insert(t, {})
else
    assert(false)
end
ok, res = pcall(table.remove, t)
ok, res = pcall(table.remove, t)
assert(not ok or not res)

-- issue 204
local ok, message = pcall(nil)
assert(not ok)
assert(message == "attempt to call a nil value")

local ok, message = pcall(1)
assert(not ok)
assert(message == "attempt to call a number value")

ok, message = pcall(function()
  pcall()
end)
assert(not ok and string.find(message, "bad argument #1 to pcall", 1, true))

-- issue 216
local function bar()
  return "bar"
end

local function test(foo)
  local should_not_change
  foo = foo or bar()
  print(should_not_change)
  return should_not_change
end

assert(test(nil) == nil)

-- issue 220
function test()
  function f(v)
    return v
  end
  local tbl = {y=0}
  local a,b
  a, b = f(10), f(20)
  assert(tbl.y == 0)
end
test()

-- issue 222
function test()
  local m = {n=2}

  function m:f1()
    return self:f3() >= self.n
  end

  function m:f2()
    local v1, v2, v3 = m:f1()
    assert(v1 == true)
    assert(v2 == nil)
    assert(v3 == nil)
  end

  function m:f3()
    return 3
  end

  m:f2()
end
test()

-- issue #292
function test()
  t0 = {}
	t0.year = 2006
	t0.month = 1
	t0.day = 2
	t0.hour = 15
	t0.min = 4
	t0.sec = 5

	t1 = {}
	t1.year = "2006"
	t1.month = "1"
	t1.day = "2"
	t1.hour = "15"
	t1.min = "4"
	t1.sec = "5"

	assert(os.time(t0) == os.time(t1))

	t2 = {}
	t2.year = "  2006"--prefix blank space
	t2.month = "1"
	t2.day = "2"
	t2.hour = "15"
	t2.min = "4"
	t2.sec = "5"
	assert(os.time(t0) == os.time(t2))

	t3 = {}
	t3.year = "  0002006"--prefix blank space and 0
	t3.month = "1"
	t3.day = "2"
	t3.hour = "15"
	t3.min = "4"
	t3.sec = "5"
	assert(os.time(t1) == os.time(t3))

	t4 = {}
	t4.year = "0002006"--prefix 0
	t4.month = "1"
	t4.day = "2"
	t4.hour = "15"
	t4.min = "4"
	t4.sec = "5"
	assert(os.time(t1) == os.time(t4))

	t5 = {}
	t5.year = "0x7d6"--prefix 0x
	t5.month = "1"
	t5.day = "2"
	t5.hour = "15"
	t5.min = "4"
	t5.sec = "5"
	assert(os.time(t1) == os.time(t5))

	t6 = {}
	t6.year = "0X7d6"--prefix 0X
	t6.month = "1"
	t6.day = "2"
	t6.hour = "15"
	t6.min = "4"
	t6.sec = "5"
	assert(os.time(t1) == os.time(t6))
end
test()

--issue #331
--[[
function test()
	local select_a = function()
		return select(3, "1")
	end
	assert(true == pcall(select_a))
	local select_b = function()
		return select(0)
	end
	assert(false == pcall(select_b))
	local select_c = function()
		return select(1/9)
	end
	assert(false == pcall(select_c))
	local select_d = function()
		return select(1, "a")
	end
	assert("a" == select_d())
	local select_e = function()
		return select(3, "a", "b", "c")
	end
	assert("c" == select_e())
	local select_f = function()
		return select(0)(select(1/9))
	end
	assert(false == pcall(select_f))
end
test()
--]]

-- issue #363
-- Any expression enclosed in parentheses always results in only one value.
function test()
    function ret2(a, b)
        return a, b
    end
    function enclosed_ret()
        return (ret2(1, 2))
    end
    local a,b = enclosed_ret()
    assert(a == 1 and b == nil)

    function enclosed_vararg_ret(...)
        return (...)
    end
    local a,b,c=enclosed_vararg_ret(1, 2, 3)
    assert(a == 1 and b == nil and c == nil)

    function enclosed_vararg_assign(...)
        local a,b,c = (...)
        return a,b,c
    end
    local a,b,c=enclosed_vararg_assign(1, 2, 3)
    assert(a == 1 and b == nil and c == nil)
end
test()

-- issue #412
-- issue #418
-- Conversion from symmetric modulo is incorrect.
function test()
    assert(-2 % -2 == 0)
    assert(-1 % -2 == -1)
    assert(0 % -2 == 0)
    assert(1 % -2 == -1)
    assert(2 % -2 == 0)
    assert(-2 % 2 == 0)
    assert(-1 % 2 == 1)
    assert(0 % 2 == 0)
    assert(1 % 2 == 1)
    assert(2 % 2 == 0)
end
test()

-- issue #355
function test()
  local x = "valid"
  assert(x == "valid")
  assert(zzz == nil)
  x = zzz and "not-valid" or x
  assert(x == "valid")
end
test()

function test()
  local x = "valid"
  local z = nil
  assert(x == "valid")
  assert(z == nil)
  x = z and "not-valid" or x
  assert(x == "valid")
end
test()

function test()
  local x = "valid"
  assert(x == "valid")
  assert(zzz == nil)
  x = zzz and "not-valid" or "still " .. x
  assert(x == "still valid")
end
test()

-- issue #315
function test()
  local a = {}
  local d = 'e'
  local f = 1
  
  f, a.d = f, d
  
  assert(f..", "..a.d == "1, e")
end
test()

-- issue #423
function test()
  local a, b, c = "1", "3", "1"
  a, b, c= tonumber(a), tonumber(b) or a, tonumber(c)
  assert(a == 1)
  assert(type(a) == "number")
  assert(b == 3)
  assert(type(b) == "number")
  assert(c == 1)
  assert(type(c) == "number")
end
