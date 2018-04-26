package porterstemmer



import (
    "testing"
)



func TestStep2(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 22)


	tests[i].S        = []rune("relational")
	tests[i].Expected = []rune("relate")
	i++

	tests[i].S        = []rune("conditional")
	tests[i].Expected = []rune("condition")
	i++

	tests[i].S        = []rune("rational")
	tests[i].Expected = []rune("rational")
	i++

	tests[i].S        = []rune("valenci")
	tests[i].Expected = []rune("valence")
	i++

	tests[i].S        = []rune("hesitanci")
	tests[i].Expected = []rune("hesitance")
	i++

	tests[i].S        = []rune("digitizer")
	tests[i].Expected = []rune("digitize")
	i++

	tests[i].S        = []rune("conformabli")
	tests[i].Expected = []rune("conformable")
	i++

	tests[i].S        = []rune("radicalli")
	tests[i].Expected = []rune("radical")
	i++

	tests[i].S        = []rune("differentli")
	tests[i].Expected = []rune("different")
	i++

	tests[i].S        = []rune("vileli")
	tests[i].Expected = []rune("vile")
	i++

	tests[i].S        = []rune("analogousli")
	tests[i].Expected = []rune("analogous")
	i++

	tests[i].S        = []rune("vietnamization")
	tests[i].Expected = []rune("vietnamize")
	i++

	tests[i].S        = []rune("predication")
	tests[i].Expected = []rune("predicate")
	i++

	tests[i].S        = []rune("operator")
	tests[i].Expected = []rune("operate")
	i++

	tests[i].S        = []rune("feudalism")
	tests[i].Expected = []rune("feudal")
	i++

	tests[i].S        = []rune("decisiveness")
	tests[i].Expected = []rune("decisive")
	i++

	tests[i].S        = []rune("hopefulness")
	tests[i].Expected = []rune("hopeful")
	i++

	tests[i].S        = []rune("callousness")
	tests[i].Expected = []rune("callous")
	i++

	tests[i].S        = []rune("formaliti")
	tests[i].Expected = []rune("formal")
	i++

	tests[i].S        = []rune("sensitiviti")
	tests[i].Expected = []rune("sensitive")
	i++

	tests[i].S        = []rune("sensibiliti")
	tests[i].Expected = []rune("sensible")
	i++


	for _,datum := range tests {

		actual := make([]rune, len(datum.S))
		copy(actual, datum.S)

		actual = step2(actual)

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
			t.Errorf("Did NOT get what was expected for calling step2() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
		}
	}
}
