package porterstemmer



import (
    "testing"
)



func TestIsConsontant(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []bool
	}, 12)


	tests[i].S        = []rune("apple")
	tests[i].Expected = []bool{false, true, true, true, false}
	i++

	tests[i].S        = []rune("cyan")
	tests[i].Expected = []bool{true, false, false, true}
	i++

	tests[i].S        = []rune("connects")
	tests[i].Expected = []bool{true, false, true, true, false, true, true, true}
	i++

	tests[i].S        = []rune("yellow")
	tests[i].Expected = []bool{true, false, true, true, false, true}
	i++

	tests[i].S        = []rune("excellent")
	tests[i].Expected = []bool{false, true, true, false, true, true, false, true, true}
	i++

	tests[i].S        = []rune("yuk")
	tests[i].Expected = []bool{true, false, true}
	i++

	tests[i].S        = []rune("syzygy")
	tests[i].Expected = []bool{true, false, true, false, true, false}
	i++

	tests[i].S        = []rune("school")
	tests[i].Expected = []bool{true, true, true, false, false, true}
	i++

	tests[i].S        = []rune("pay")
	tests[i].Expected = []bool{true, false, true}
	i++

	tests[i].S        = []rune("golang")
	tests[i].Expected = []bool{true, false, true, false, true, true}
	i++

	// NOTE: The Porter Stemmer technical should make a mistake on the second "y".
	//       Really, both the 1st and 2nd "y" are consontants. But
	tests[i].S        = []rune("sayyid")
	tests[i].Expected = []bool{true, false, true, false, false, true}
	i++

	tests[i].S        = []rune("ya")
	tests[i].Expected = []bool{true, false}
	i++

	for _,datum := range tests {
		for i = 0 ; i < len(datum.S) ; i++ {

			if  actual := isConsonant(datum.S, i) ; actual != datum.Expected[i]   {
				t.Errorf("Did NOT get what was expected for calling isConsonant() on [%s] at [%d] (i.e., [%s]). Expect [%t] but got [%t]", string(datum.S), i, string(datum.S[i]), datum.Expected[i], actual)
			}
		} // for
	}
}

