package porterstemmer



import (
    "testing"
)



func TestHasSuffix(t *testing.T) {

	tests := make([]struct {
		S []rune
		Suffix []rune
		Expected bool
	}, 82)



	i := 0


	tests[i].S         = []rune("ran")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runner")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("runnar")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runned")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runnre")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("er")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("re")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++



	tests[i].S         = []rune("ran")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runner")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runnar")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runned")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("runnre")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("er")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("re")
	tests[i].Suffix    = []rune("ER")
	tests[i].Expected  = false
	i++



	tests[i].S         = []rune("")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++

	tests[i].S         = []rune("e")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = false
	i++



	tests[i].S         = []rune("caresses")
	tests[i].Suffix    = []rune("sses")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("ponies")
	tests[i].Suffix    = []rune("ies")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("caress")
	tests[i].Suffix    = []rune("ss")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("cats")
	tests[i].Suffix    = []rune("s")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("feed")
	tests[i].Suffix    = []rune("eed")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("agreed")
	tests[i].Suffix    = []rune("eed")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("plastered")
	tests[i].Suffix    = []rune("ed")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("bled")
	tests[i].Suffix    = []rune("ed")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("motoring")
	tests[i].Suffix    = []rune("ing")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("sing")
	tests[i].Suffix    = []rune("ing")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("conflat")
	tests[i].Suffix    = []rune("at")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("troubl")
	tests[i].Suffix    = []rune("bl")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("siz")
	tests[i].Suffix    = []rune("iz")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("happy")
	tests[i].Suffix    = []rune("y")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("sky")
	tests[i].Suffix    = []rune("y")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("relational")
	tests[i].Suffix    = []rune("ational")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("conditional")
	tests[i].Suffix    = []rune("tional")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("rational")
	tests[i].Suffix    = []rune("tional")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("valenci")
	tests[i].Suffix    = []rune("enci")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("hesitanci")
	tests[i].Suffix    = []rune("anci")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("digitizer")
	tests[i].Suffix    = []rune("izer")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("conformabli")
	tests[i].Suffix    = []rune("abli")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("radicalli")
	tests[i].Suffix    = []rune("alli")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("differentli")
	tests[i].Suffix    = []rune("entli")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("vileli")
	tests[i].Suffix    = []rune("eli")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("analogousli")
	tests[i].Suffix    = []rune("ousli")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("vietnamization")
	tests[i].Suffix    = []rune("ization")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("predication")
	tests[i].Suffix    = []rune("ation")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("operator")
	tests[i].Suffix    = []rune("ator")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("feudalism")
	tests[i].Suffix    = []rune("alism")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("decisiveness")
	tests[i].Suffix    = []rune("iveness")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("hopefulness")
	tests[i].Suffix    = []rune("fulness")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("callousness")
	tests[i].Suffix    = []rune("ousness")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("formaliti")
	tests[i].Suffix    = []rune("aliti")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("sensitiviti")
	tests[i].Suffix    = []rune("iviti")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("sensibiliti")
	tests[i].Suffix    = []rune("biliti")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("triplicate")
	tests[i].Suffix    = []rune("icate")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("formative")
	tests[i].Suffix    = []rune("ative")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("formalize")
	tests[i].Suffix    = []rune("alize")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("electriciti")
	tests[i].Suffix    = []rune("iciti")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("electrical")
	tests[i].Suffix    = []rune("ical")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("hopeful")
	tests[i].Suffix    = []rune("ful")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("goodness")
	tests[i].Suffix    = []rune("ness")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("revival")
	tests[i].Suffix    = []rune("al")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("allowance")
	tests[i].Suffix    = []rune("ance")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("inference")
	tests[i].Suffix    = []rune("ence")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("airliner")
	tests[i].Suffix    = []rune("er")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("gyroscopic")
	tests[i].Suffix    = []rune("ic")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("adjustable")
	tests[i].Suffix    = []rune("able")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("defensible")
	tests[i].Suffix    = []rune("ible")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("irritant")
	tests[i].Suffix    = []rune("ant")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("replacement")
	tests[i].Suffix    = []rune("ement")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("adjustment")
	tests[i].Suffix    = []rune("ment")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("dependent")
	tests[i].Suffix    = []rune("ent")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("adoption")
	tests[i].Suffix    = []rune("ion")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("homologou")
	tests[i].Suffix    = []rune("ou")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("communism")
	tests[i].Suffix    = []rune("ism")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("activate")
	tests[i].Suffix    = []rune("ate")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("angulariti")
	tests[i].Suffix    = []rune("iti")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("homologous")
	tests[i].Suffix    = []rune("ous")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("effective")
	tests[i].Suffix    = []rune("ive")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("bowdlerize")
	tests[i].Suffix    = []rune("ize")
	tests[i].Expected  = true
	i++



	tests[i].S         = []rune("probate")
	tests[i].Suffix    = []rune("e")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("rate")
	tests[i].Suffix    = []rune("e")
	tests[i].Expected  = true
	i++

	tests[i].S         = []rune("cease")
	tests[i].Suffix    = []rune("e")
	tests[i].Expected  = true
	i++

	for _,datum := range tests {
		if actual := hasSuffix(datum.S, datum.Suffix) ; actual != datum.Expected {
			t.Errorf("Did NOT get what was expected for calling hasSuffix() on [%s] with suffix [%s]. Expect [%d] but got [%d]", string(datum.S), string(datum.Suffix), datum.Expected, actual)
		}
	}
}

