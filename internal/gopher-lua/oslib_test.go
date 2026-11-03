package lua

import (
	"testing"
)

// correctly gc-ed. There was a bug in gopher lua where local vars were not being gc-ed in all circumstances.
func TestOsWrite(t *testing.T) {
	s := `
		local function write(filename, content)
		local f = assert(io.open(filename, "w"))
		  f:write(content)
		  assert(f:close())
		end

		local filename = os.tmpname()
		write(filename, "abc")
		write(filename, "d")
		local f = assert(io.open(filename, "r"))
		local content = f:read("*all"):gsub("%s+", "")
		f:close()
		os.remove(filename)
		local expected = "d"
		if content ~= expected then
			error(string.format("Invalid content: Expecting \"%s\", got \"%s\"", expected, content))
		end
`
	L := NewState()
	defer L.Close()
	if err := L.DoString(s); err != nil {
		t.Error(err)
	}
}
