// Copyright 2024 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package runtime

// Config interface is the Nakama core configuration.
type Config interface {
	GetName() string
	GetShutdownGraceSec() int
	GetLogger() LoggerConfig
	GetSession() SessionConfig
	GetSocket() SocketConfig
	GetSocial() SocialConfig
	GetRuntime() RuntimeConfig
	GetIAP() IAPConfig
	GetGoogleAuth() GoogleAuthConfig
	GetSatori() SatoriConfig
}

// LoggerConfig is configuration relevant to logging levels and output.
type LoggerConfig interface {
	GetLevel() string
}

// SessionConfig is configuration relevant to the session.
type SessionConfig interface {
	GetEncryptionKey() string
	GetTokenExpirySec() int64
	GetRefreshEncryptionKey() string
	GetRefreshTokenExpirySec() int64
	GetSingleSocket() bool
	GetSingleMatch() bool
	GetSingleParty() bool
	GetSingleSession() bool
}

// SocketConfig is configuration relevant to the transport socket and protocol.
type SocketConfig interface {
	GetServerKey() string
	GetPort() int
	GetAddress() string
	GetProtocol() string
}

// SocialConfig is configuration relevant to the social authentication providers.
type SocialConfig interface {
	GetSteam() SocialConfigSteam
	GetFacebookInstantGame() SocialConfigFacebookInstantGame
	GetFacebookLimitedLogin() SocialConfigFacebookLimitedLogin
	GetApple() SocialConfigApple
}

// SocialConfigSteam is configuration relevant to Steam.
type SocialConfigSteam interface {
	GetPublisherKey() string
	GetAppID() int
}

// SocialConfigFacebookInstantGame is configuration relevant to Facebook Instant Games.
type SocialConfigFacebookInstantGame interface {
	GetAppSecret() string
}

// SocialConfigFacebookLimitedLogin is configuration relevant to Facebook Limited Login.
type SocialConfigFacebookLimitedLogin interface {
	GetAppId() string
}

// SocialConfigApple is configuration relevant to Apple Sign In.
type SocialConfigApple interface {
	GetBundleId() string
}

// RuntimeConfig is configuration relevant to the Runtimes.
type RuntimeConfig interface {
	GetEnv() []string
	GetHTTPKey() string
}

type IAPConfig interface {
	GetApple() IAPAppleConfig
	GetGoogle() IAPGoogleConfig
	GetHuawei() IAPHuaweiConfig
	GetFacebookInstant() IAPFacebookInstantConfig
}

type IAPAppleConfig interface {
	GetSharedPassword() string
	GetNotificationsEndpointId() string
}

type IAPGoogleConfig interface {
	GetClientEmail() string
	GetPrivateKey() string
	GetNotificationsEndpointId() string
	GetRefundCheckPeriodMin() int
	GetPackageName() string
}

type SatoriConfig interface {
	GetUrl() string
	GetApiKeyName() string
	GetApiKey() string
	GetSigningKey() string
}

type IAPHuaweiConfig interface {
	GetPublicKey() string
	GetClientID() string
	GetClientSecret() string
}

type IAPFacebookInstantConfig interface {
	GetAppSecret() string
}

type GoogleAuthConfig interface {
	GetCredentialsJSON() string
}
