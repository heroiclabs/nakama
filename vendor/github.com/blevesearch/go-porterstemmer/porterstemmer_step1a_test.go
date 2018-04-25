package porterstemmer



import (
    "testing"
)



func TestStep1a(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 12)


	tests[i].S        = []rune("caresses")
	tests[i].Expected = []rune("caress")
	i++

	tests[i].S        = []rune("ponies")
	tests[i].Expected = []rune("poni")
	i++

	tests[i].S        = []rune("ties")
	tests[i].Expected = []rune("ti")
	i++

	tests[i].S        = []rune("caress")
	tests[i].Expected = []rune("caress")
	i++

	tests[i].S        = []rune("cats")
	tests[i].Expected = []rune("cat")
	i++


	for _,datum := range tests {
		for i = 0 ; i < len(datum.S) ; i++ {

			actual := make([]rune, len(datum.S))
			copy(actual, datum.S)

			actual = step1a(actual)

			lenActual   := len(actual)
			lenExpected := len(datum.Expected)

			equal := true
			if 0 == lenActual && 0 == lenExpected {
				equal = true
			} else if lenActual != lenExpected {
				equal = false
			} else if actual[0] != datum.Expected[0]  {
				equal = false
			} else if actual[lenActual-1] != datum.Expected[lenExpected-1]  {
				equal = false
			} else {
				for j := 0 ; j < lenActual ; j++ {

					if actual[j] != datum.Expected[j]  {
						equal = false
					}
				}
			}

			if !equal {
				t.Errorf("Did NOT get what was expected for calling step1a() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
			}
		} // for
	}
}

