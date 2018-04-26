package porterstemmer



import (
    "testing"
)



func TestStep4(t *testing.T) {

	i := 0

	tests := make([]struct {
		S []rune
		Expected []rune
	}, 20)


	tests[i].S        = []rune("revival")
	tests[i].Expected = []rune("reviv")
	i++

	tests[i].S        = []rune("allowance")
	tests[i].Expected = []rune("allow")
	i++

	tests[i].S        = []rune("inference")
	tests[i].Expected = []rune("infer")
	i++

	tests[i].S        = []rune("airliner")
	tests[i].Expected = []rune("airlin")
	i++

	tests[i].S        = []rune("gyroscopic")
	tests[i].Expected = []rune("gyroscop")
	i++

	tests[i].S        = []rune("adjustable")
	tests[i].Expected = []rune("adjust")
	i++

	tests[i].S        = []rune("defensible")
	tests[i].Expected = []rune("defens")
	i++

	tests[i].S        = []rune("irritant")
	tests[i].Expected = []rune("irrit")
	i++

	tests[i].S        = []rune("replacement")
	tests[i].Expected = []rune("replac")
	i++

	tests[i].S        = []rune("adjustment")
	tests[i].Expected = []rune("adjust")
	i++

	tests[i].S        = []rune("dependent")
	tests[i].Expected = []rune("depend")
	i++

	tests[i].S        = []rune("adoption")
	tests[i].Expected = []rune("adopt")
	i++

	tests[i].S        = []rune("homologou")
	tests[i].Expected = []rune("homolog")
	i++

	tests[i].S        = []rune("communism")
	tests[i].Expected = []rune("commun")
	i++

	tests[i].S        = []rune("activate")
	tests[i].Expected = []rune("activ")
	i++

	tests[i].S        = []rune("angulariti")
	tests[i].Expected = []rune("angular")
	i++

	tests[i].S        = []rune("homologous")
	tests[i].Expected = []rune("homolog")
	i++

	tests[i].S        = []rune("effective")
	tests[i].Expected = []rune("effect")
	i++

	tests[i].S        = []rune("bowdlerize")
	tests[i].Expected = []rune("bowdler")
	i++


	for _,datum := range tests {

		actual := make([]rune, len(datum.S))
		copy(actual, datum.S)

		actual = step4(actual)

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
			t.Errorf("Did NOT get what was expected for calling step4() on [%s]. Expect [%s] but got [%s]", string(datum.S), string(datum.Expected), string(actual))
		}
	}
}
