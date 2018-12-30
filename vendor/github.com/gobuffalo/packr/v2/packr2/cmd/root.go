package cmd

import (
	"os"

	"github.com/gobuffalo/genny"
	"github.com/gobuffalo/logger"
	"github.com/gobuffalo/packr/v2/plog"
	"github.com/spf13/cobra"
)

var globalOptions = struct {
	Verbose       bool
	IgnoreImports bool
	Legacy        bool
	Silent        bool
	StoreCmd      string
}{}

var rootCmd = &cobra.Command{
	Use:   "packr2",
	Short: "Packr is a simple solution for bundling static assets inside of Go binaries.",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		genny.DefaultLogLvl = logger.ErrorLevel
		for _, a := range args {
			if a == "--legacy" {
				globalOptions.Legacy = true
				continue
			}
			if a == "-v" || a == "--verbose" {
				globalOptions.Verbose = true
				continue
			}
		}
		if globalOptions.Verbose {
			genny.DefaultLogLvl = logger.DebugLevel
			plog.Logger = logger.New(logger.DebugLevel)
		}
		if globalOptions.Silent {
			genny.DefaultLogLvl = logger.FatalLevel
			plog.Logger = logger.New(logger.FatalLevel)
		}
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		return pack(args...)
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&globalOptions.Verbose, "verbose", "v", false, "enables verbose logging")
	rootCmd.PersistentFlags().BoolVar(&globalOptions.Legacy, "legacy", false, "uses the legacy resolution and packing system (assumes first arg || pwd for input path)")
	rootCmd.PersistentFlags().BoolVar(&globalOptions.Silent, "silent", false, "silences all output")
	rootCmd.PersistentFlags().BoolVar(&globalOptions.IgnoreImports, "ignore-imports", false, "when set to true packr won't resolve imports for boxes")
	rootCmd.PersistentFlags().StringVar(&globalOptions.StoreCmd, "store-cmd", "", "sub command to use for packing")
}
