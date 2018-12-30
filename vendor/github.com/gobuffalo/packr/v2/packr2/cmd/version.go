package cmd

import (
	"fmt"

	packr "github.com/gobuffalo/packr/v2"
	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "shows packr version",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Print(packr.Version)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
