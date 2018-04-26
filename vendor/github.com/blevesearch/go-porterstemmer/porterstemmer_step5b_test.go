package porterstemmer



import (
    "testing"
)



func TestStep5b(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 3)


	tests[i].S        = []rune("controll")
	tests[i].Expected = []rune("control")
	i++

	tests[i].S        = []rune("roll")
	tests[i].Expected = []rune("roll")
	i++


	for _,datum := range tests {

		actual := make([]rune, len(datum.S))
		copy(actual, datum.S)

		actual = step5b(actual)

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
			t.Errorf("Did NOT get what was expected for calling step5b() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
		}
	}
}
