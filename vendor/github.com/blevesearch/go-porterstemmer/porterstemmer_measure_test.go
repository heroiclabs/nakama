package porterstemmer



import (
    "testing"
)



func TestMeasure(t *testing.T) {

	tests := make([]struct {
		S []rune
		Expected uint
	}, 27)


	tests[0].S         = []rune("ya")
	tests[0].Expected  = 0

	tests[1].S         = []rune("cyan")
	tests[1].Expected  = 1

	tests[2].S         = []rune("connects")
	tests[2].Expected  = 2

	tests[3].S         = []rune("yellow")
	tests[3].Expected  = 2

	tests[4].S         = []rune("excellent")
	tests[4].Expected  = 3

	tests[5].S         = []rune("yuk")
	tests[5].Expected  = 1

	tests[6].S         = []rune("syzygy")
	tests[6].Expected  = 2

	tests[7].S         = []rune("school")
	tests[7].Expected  = 1

	tests[8].S         = []rune("pay")
	tests[8].Expected  = 1

	tests[9].S         = []rune("golang")
	tests[9].Expected  = 2

	// NOTE: The Porter Stemmer technical should make a mistake on the second "y".
	//       Really, both the 1st and 2nd "y" are consontants. But
	tests[10].S        = []rune("sayyid")
	tests[10].Expected = 2

	tests[11].S        = []rune("ya")
	tests[11].Expected = 0

	tests[12].S        = []rune("")
	tests[12].Expected = 0

	tests[13].S        = []rune("tr")
	tests[13].Expected = 0

	tests[14].S        = []rune("ee")
	tests[14].Expected = 0

	tests[15].S        = []rune("tree")
	tests[15].Expected = 0

	tests[16].S        = []rune("t")
	tests[16].Expected = 0

	tests[18].S        = []rune("by")
	tests[18].Expected = 0

	tests[19].S        = []rune("trouble")
	tests[19].Expected = 1

	tests[20].S        = []rune("oats")
	tests[20].Expected = 1

	tests[21].S        = []rune("trees")
	tests[21].Expected = 1

	tests[22].S        = []rune("ivy")
	tests[22].Expected = 1

	tests[23].S        = []rune("troubles")
	tests[23].Expected = 2

	tests[24].S        = []rune("private")
	tests[24].Expected = 2

	tests[25].S        = []rune("oaten")
	tests[25].Expected = 2

	tests[26].S        = []rune("orrery")
	tests[26].Expected = 2

	for _,datum := range tests {
		if actual := measure(datum.S) ; actual != datum.Expected {
			t.Errorf("Did NOT get what was expected for calling measure() on [%s]. Expect [%d] but got [%d]", string(datum.S), datum.Expected, actual)
		}
	}
}

