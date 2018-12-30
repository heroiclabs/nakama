package fix

import (
	"fmt"

	packr "github.com/gobuffalo/packr/v2"
	"github.com/pkg/errors"
)

// Check interface for runnable checker functions
type Check func(*Runner) error

// Runner will run all compatible checks
type Runner struct {
	Warnings []string
}

// Run all compatible checks
func Run() error {
	fmt.Printf("! This updater will attempt to update your application to packr version: %s\n", packr.Version)
	if !ask("Do you wish to continue?") {
		fmt.Println("~~~ cancelling update ~~~")
		return nil
	}

	r := &Runner{
		Warnings: []string{},
	}

	defer func() {
		if len(r.Warnings) == 0 {
			return
		}

		fmt.Println("\n\n----------------------------")
		fmt.Printf("!!! (%d) Warnings Were Found !!!\n\n", len(r.Warnings))
		for _, w := range r.Warnings {
			fmt.Printf("[WARNING]: %s\n", w)
		}
	}()

	for _, c := range checks {
		if err := c(r); err != nil {
			return errors.WithStack(err)
		}
	}
	return nil
}
