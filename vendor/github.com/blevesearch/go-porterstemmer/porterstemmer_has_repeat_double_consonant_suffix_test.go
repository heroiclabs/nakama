package porterstemmer



import (
    "testing"
)



func TestHasDoubleConsonantSuffix(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected bool
	}, 12)


	tests[i].S        = []rune("apple")
	tests[i].Expected = false
	i++

	tests[i].S        = []rune("hiss")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("fizz")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("fill")
	tests[i].Expected = true
	i++

	tests[i].S        = []rune("ahaa")
	tests[i].Expected = false
	i++


	for _,datum := range tests {

		if  actual := hasRepeatDoubleConsonantSuffix(datum.S) ; actual != datum.Expected   {
			t.Errorf("Did NOT get what was expected for calling hasDoubleConsonantSuffix() on [%s]. Expect [%t] but got [%t]", string(datum.S), datum.Expected, actual)
		}
	}
}

