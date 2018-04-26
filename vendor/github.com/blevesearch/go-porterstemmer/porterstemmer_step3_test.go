package porterstemmer



import (
    "testing"
)



func TestStep3(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 22)


	tests[i].S        = []rune("triplicate")
	tests[i].Expected = []rune("triplic")
	i++

	tests[i].S        = []rune("formative")
	tests[i].Expected = []rune("form")
	i++

	tests[i].S        = []rune("formalize")
	tests[i].Expected = []rune("formal")
	i++

	tests[i].S        = []rune("electriciti")
	tests[i].Expected = []rune("electric")
	i++

	tests[i].S        = []rune("electrical")
	tests[i].Expected = []rune("electric")
	i++

	tests[i].S        = []rune("hopeful")
	tests[i].Expected = []rune("hope")
	i++

	tests[i].S        = []rune("goodness")
	tests[i].Expected = []rune("good")
	i++


	for _,datum := range tests {

		actual := make([]rune, len(datum.S))
		copy(actual, datum.S)

		actual = step3(actual)

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
			t.Errorf("Did NOT get what was expected for calling step3() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
		}
	}
}
