package porterstemmer



import (
    "testing"
)



func TestContainsVowel(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected bool
	}, 15)


	tests[i].S        = []rune("apple")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("f")
	tests[i].Expected = false
	i++



	tests[i].S        = []rune("a")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("e")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("i")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("o")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("u")
	tests[i].Expected = true
	i++



	tests[i].S        = []rune("y")
	tests[i].Expected = false
	i++



	tests[i].S        = []rune("cy")
	tests[i].Expected = true
	i++


	for _,datum := range tests {
		if  actual := containsVowel(datum.S) ; actual != datum.Expected   {
			t.Errorf("Did NOT get what was expected for calling containsVowel() on [%s]. Expect [%t] but got [%t]", string(datum.S), datum.Expected, actual)
		}
	}
}

