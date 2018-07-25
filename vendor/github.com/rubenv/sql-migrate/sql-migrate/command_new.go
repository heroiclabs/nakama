package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path"
	"strings"
	"text/template"
	"time"
)

var templateContent = `
-- +migrate Up

-- +migrate Down
`
var tpl *template.Template

func init() {
	tpl = template.Must(template.New("new_migration").Parse(templateContent))
}

type NewCommand struct {
}

func (c *NewCommand) Help() string {
	helpText := `
Usage: sql-migrate new [options] name

  Create a new a database migration.

Options:

  -config=dbconfig.yml   Configuration file to use.
  -env="development"     Environment.
  name                   The name of the migration
`
	return strings.TrimSpace(helpText)
}

func (c *NewCommand) Synopsis() string {
	return "Create a new migration"
}

func (c *NewCommand) Run(args []string) int {
	cmdFlags := flag.NewFlagSet("new", flag.ContinueOnError)
	cmdFlags.Usage = func() { ui.Output(c.Help()) }
	ConfigFlags(cmdFlags)

	if len(args) < 1 {
		err := errors.New("A name for the migration is needed")
		ui.Error(err.Error())
		return 1
	}

	if err := cmdFlags.Parse(args); err != nil {
		return 1
	}

	if err := CreateMigration(cmdFlags.Arg(0)); err != nil {
		ui.Error(err.Error())
		return 1
	}
	return 0
}

func CreateMigration(name string) error {
	env, err := GetEnvironment()
	if err != nil {
		return err
	}

	if _, err := os.Stat(env.Dir); os.IsNotExist(err) {
		return err
	}

	fileName := fmt.Sprintf("%s-%s.sql", time.Now().Format("20060102150405"), strings.TrimSpace(name))
	pathName := path.Join(env.Dir, fileName)
	f, err := os.Create(pathName)

	if err != nil {
		return err
	}
	defer f.Close()

	if err := tpl.Execute(f, nil); err != nil {
		return err
	}

	ui.Output(fmt.Sprintf("Created migration %s", pathName))
	return nil
}
