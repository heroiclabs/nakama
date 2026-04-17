module github.com/ivx/nakama-analytics-metrics

// Go version MUST match what heroiclabs/nakama-pluginbuilder:3.35.0 ships.
// Go plugins are strictly ABI-coupled to the main binary; a mismatch here
// produces "plugin was built with a different version of package ..." at
// load time. Per the Nakama 3.35.0 release notes, nakama-common v1.44.0 is
// required, which in turn requires Go 1.25.
go 1.25

require (
	// MUST be v1.44.0 for Nakama 3.35.0 — see release notes.
	github.com/heroiclabs/nakama-common v1.44.0

	// prometheus/client_golang is NOT imported by nakama-common, so any
	// recent version works. v1.20.5 is pinned for reproducibility.
	github.com/prometheus/client_golang v1.20.5
)
