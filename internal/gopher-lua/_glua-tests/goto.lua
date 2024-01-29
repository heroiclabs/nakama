local function errmsg (code, m)
  local st, msg = loadstring(code)
  assert(not st and string.find(msg, m))
end

-- cannot see label inside block
errmsg([[ goto l1; do ::l1:: end ]], "label 'l1'")
errmsg([[ do ::l1:: end goto l1; ]], "label 'l1'")

-- repeated label
errmsg([[ ::l1:: ::l1:: ]], "label 'l1'")


-- undefined label
errmsg([[ goto l1; local aa ::l1:: ::l2:: print(3) ]], "local 'aa'")

-- jumping over variable definition
errmsg([[
do local bb, cc; goto l1; end
local aa
::l1:: print(3)
]], "local 'aa'")

-- jumping into a block
errmsg([[ do ::l1:: end goto l1 ]], "label 'l1'")
errmsg([[ goto l1 do ::l1:: end ]], "label 'l1'")

-- cannot continue a repeat-until with variables
errmsg([[
  repeat
    if x then goto cont end
    local xuxu = 10
    ::cont::
  until xuxu < x
]], "local 'xuxu'")

-- simple gotos
local x
do
  local y = 12
  goto l1
  ::l2:: x = x + 1; goto l3
  ::l1:: x = y; goto l2
end
::l3:: ::l3_1:: assert(x == 13)


-- long labels
do
  local prog = [[
  do
    local a = 1
    goto l%sa; a = a + 1
   ::l%sa:: a = a + 10
    goto l%sb; a = a + 2
   ::l%sb:: a = a + 20
    return a
  end
  ]]
  local label = string.rep("0123456789", 40)
  prog = string.format(prog, label, label, label, label)
  assert(assert(loadstring(prog))() == 31)
end

-- goto to correct label when nested
do goto l3; ::l3:: end   -- does not loop jumping to previous label 'l3'

-- ok to jump over local dec. to end of block
do
  goto l1
  local a = 23
  x = a
  ::l1::;
end

while true do
  goto l4
  goto l1  -- ok to jump over local dec. to end of block
  goto l1  -- multiple uses of same label
  local x = 45
  ::l1:: ;;;
end
::l4:: assert(x == 13)

if print then
  goto l1   -- ok to jump over local dec. to end of block
  error("should not be here")
  goto l2   -- ok to jump over local dec. to end of block
  local x
  ::l1:: ; ::l2:: ;;
else end

-- to repeat a label in a different function is OK
local function foo ()
  local a = {}
  goto l3
  ::l1:: a[#a + 1] = 1; goto l2;
  ::l2:: a[#a + 1] = 2; goto l5;
  ::l3::
  ::l3a:: a[#a + 1] = 3; goto l1;
  ::l4:: a[#a + 1] = 4; goto l6;
  ::l5:: a[#a + 1] = 5; goto l4;
  ::l6:: assert(a[1] == 3 and a[2] == 1 and a[3] == 2 and
    a[4] == 5 and a[5] == 4)
  if not a[6] then a[6] = true; goto l3a end   -- do it twice
end

::l6:: foo()



--------------------------------------------------------------------------------
-- testing closing of upvalues

local function foo ()
  local a = {}
  do
    local i = 1
    local k = 0
    a[0] = function (y) k = y end
    ::l1:: do
    local x
    if i > 2 then goto l2 end
    a[i] = function (y) if y then x = y else return x + k end end
    i = i + 1
    goto l1
  end
  end
  ::l2:: return a
end

local a = foo()
a[1](10); a[2](20)
assert(a[1]() == 10 and a[2]() == 20 and a[3] == nil)
a[0](13)
assert(a[1]() == 23 and a[2]() == 33)

--------------------------------------------------------------------------------
-- testing if x goto optimizations

local function testG (a)
  if a == 1 then
    goto l1
    error("should never be here!")
  elseif a == 2 then goto l2
  elseif a == 3 then goto l3
  elseif a == 4 then
    goto l1  -- go to inside the block
    error("should never be here!")
    ::l1:: a = a + 1   -- must go to 'if' end
  else
    goto l4
    ::l4a:: a = a * 2; goto l4b
    error("should never be here!")
    ::l4:: goto l4a
    error("should never be here!")
    ::l4b::
  end
  do return a end
  ::l2:: do return "2" end
  ::l3:: do return "3" end
  ::l1:: return "1"
end

assert(testG(1) == "1")
assert(testG(2) == "2")
assert(testG(3) == "3")
assert(testG(4) == 5)
assert(testG(5) == 10)
--------------------------------------------------------------------------------


print'OK'
