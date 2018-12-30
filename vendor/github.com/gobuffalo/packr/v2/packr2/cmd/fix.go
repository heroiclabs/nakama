package cmd

import (
	"fmt"

	packr "github.com/gobuffalo/packr/v2"
	"github.com/gobuffalo/packr/v2/packr2/cmd/fix"
	"github.com/spf13/cobra"
)

// fixCmd represents the info command
var fixCmd = &cobra.Command{
	Use:   "fix",
	Short: fmt.Sprintf("will attempt to fix a application's API to match packr version %s", packr.Version),
	RunE: func(cmd *cobra.Command, args []string) error {
		return fix.Run()
	},
}

func init() {
	fixCmd.Flags().BoolVarP(&fix.YesToAll, "y", "", false, "update all without asking for confirmation")
	rootCmd.AddCommand(fixCmd)
}
