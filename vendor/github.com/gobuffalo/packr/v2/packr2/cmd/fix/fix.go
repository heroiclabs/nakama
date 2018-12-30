package fix

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/gobuffalo/envy"
	"github.com/gobuffalo/packr/v2/jam/store"
	"github.com/pkg/errors"
)

var modsOn = (strings.TrimSpace(envy.Get("GO111MODULE", "off")) == "on")

//YesToAll will be used by the command to skip the questions
var YesToAll bool

var replace = map[string]string{
	"github.com/gobuffalo/packr": "github.com/gobuffalo/packr/v2",
}

var ic = ImportConverter{
	Data: replace,
}

var checks = []Check{
	// packrClean,
	ic.Process,
}

func packrClean(r *Runner) error {
	pwd, err := os.Getwd()
	if err != nil {
		return errors.WithStack(err)
	}
	store.Clean(pwd)
	return nil
}

func ask(q string) bool {
	if YesToAll {
		return true
	}

	fmt.Printf("? %s [y/n]\n", q)

	reader := bufio.NewReader(os.Stdin)
	text, _ := reader.ReadString('\n')

	text = strings.ToLower(strings.TrimSpace(text))
	return text == "y" || text == "yes"
}
