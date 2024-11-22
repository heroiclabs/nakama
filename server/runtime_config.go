package server

import "github.com/heroiclabs/nakama-common/runtime"

type runtimeConfig struct {
	name          string
	shutdownGrace int
	logger        runtime.LoggerConfig
	session       runtime.SessionConfig
	socket        runtime.SocketConfig
	social        runtime.SocialConfig
	runtime       runtime.RuntimeConfig
	iap           runtime.IAPConfig
	googleAuth    runtime.GoogleAuthConfig
	satori        runtime.SatoriConfig
}

func (c runtimeConfig) GetName() string {
	return c.name
}
func (c runtimeConfig) GetShutdownGraceSec() int {
	return c.shutdownGrace
}
func (c runtimeConfig) GetLogger() runtime.LoggerConfig {
	return c.logger
}
func (c runtimeConfig) GetSession() runtime.SessionConfig {
	return c.session
}
func (c runtimeConfig) GetSocket() runtime.SocketConfig {
	return c.socket
}
func (c runtimeConfig) GetSocial() runtime.SocialConfig {
	return c.social
}
func (c runtimeConfig) GetRuntime() runtime.RuntimeConfig {
	return c.runtime
}
func (c runtimeConfig) GetIAP() runtime.IAPConfig {
	return c.iap
}
func (c runtimeConfig) GetGoogleAuth() runtime.GoogleAuthConfig {
	return c.googleAuth
}
func (c runtimeConfig) GetSatori() runtime.SatoriConfig {
	return c.satori
}
