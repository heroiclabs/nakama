package porterstemmer



import (
    "testing"
)



func TestStep1b(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 17)


	tests[i].S        = []rune("feed")
	tests[i].Expected = []rune("feed")
	i++

	tests[i].S        = []rune("agreed")
	tests[i].Expected = []rune("agree")
	i++

	tests[i].S        = []rune("plastered")
	tests[i].Expected = []rune("plaster")
	i++

	tests[i].S        = []rune("bled")
	tests[i].Expected = []rune("bled")
	i++

	tests[i].S        = []rune("motoring")
	tests[i].Expected = []rune("motor")
	i++

	tests[i].S        = []rune("sing")
	tests[i].Expected = []rune("sing")
	i++



	tests[i].S        = []rune("conflated")
	tests[i].Expected = []rune("conflate")
	i++

	tests[i].S        = []rune("troubled")
	tests[i].Expected = []rune("trouble")
	i++

	tests[i].S        = []rune("sized")
	tests[i].Expected = []rune("size")
	i++

	tests[i].S        = []rune("hopping")
	tests[i].Expected = []rune("hop")
	i++

	tests[i].S        = []rune("tanned")
	tests[i].Expected = []rune("tan")
	i++

	tests[i].S        = []rune("falling")
	tests[i].Expected = []rune("fall")
	i++

	tests[i].S        = []rune("hissing")
	tests[i].Expected = []rune("hiss")
	i++

	tests[i].S        = []rune("fizzed")
	tests[i].Expected = []rune("fizz")
	i++

	tests[i].S        = []rune("failing")
	tests[i].Expected = []rune("fail")
	i++

	tests[i].S        = []rune("filing")
	tests[i].Expected = []rune("file")
	i++

	for _,datum := range tests {

		actual := make([]rune, len(datum.S))
		copy(actual, datum.S)

		actual = step1b(actual)

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
			t.Errorf("Did NOT get what was expected for calling step1b() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
		}
	}
}
