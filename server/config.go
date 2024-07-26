// Copyright 2018 The Nakama Authors
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

package server

import (
	"crypto/tls"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/heroiclabs/nakama/v3/flags"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gopkg.in/yaml.v3"
)

// Config interface is the Nakama core configuration.
type Config interface {
	GetName() string
	GetDataDir() string
	GetShutdownGraceSec() int
	GetLogger() *LoggerConfig
	GetMetrics() *MetricsConfig
	GetSession() *SessionConfig
	GetSocket() *SocketConfig
	GetDatabase() *DatabaseConfig
	GetSocial() *SocialConfig
	GetRuntime() *RuntimeConfig
	GetMatch() *MatchConfig
	GetTracker() *TrackerConfig
	GetConsole() *ConsoleConfig
	GetLeaderboard() *LeaderboardConfig
	GetMatchmaker() *MatchmakerConfig
	GetIAP() *IAPConfig
	GetGoogleAuth() *GoogleAuthConfig
	GetSatori() *SatoriConfig
	GetStorage() *StorageConfig
	GetLimit() int

	Clone() (Config, error)
}

func ParseArgs(logger *zap.Logger, args []string) Config {
	// Parse args to get path to a config file if passed in.
	configFilePath := NewConfig(logger)
	configFileFlagSet := flag.NewFlagSet("nakama", flag.ExitOnError)
	configFileFlagMaker := flags.NewFlagMakerFlagSet(&flags.FlagMakingOptions{
		UseLowerCase: true,
		Flatten:      false,
		TagName:      "yaml",
		TagUsage:     "usage",
	}, configFileFlagSet)

	if _, err := configFileFlagMaker.ParseArgs(configFilePath, args[1:]); err != nil {
		logger.Fatal("Could not parse command line arguments", zap.Error(err))
	}

	// Parse config file if path is set.
	mainConfig := NewConfig(logger)
	runtimeEnvironment := mainConfig.GetRuntime().Environment
	for _, cfg := range configFilePath.Config {
		data, err := os.ReadFile(cfg)
		if err != nil {
			logger.Fatal("Could not read config file", zap.String("path", cfg), zap.Error(err))
		}

		err = yaml.Unmarshal(data, mainConfig)
		if err != nil {
			logger.Fatal("Could not parse config file", zap.String("path", cfg), zap.Error(err))
		}

		// Convert and preserve the runtime environment key-value pairs.
		runtimeEnvironment = convertRuntimeEnv(logger, runtimeEnvironment, mainConfig.GetRuntime().Env)
		logger.Info("Successfully loaded config file", zap.String("path", cfg))
	}
	// Preserve the config file path arguments.
	mainConfig.Config = configFilePath.Config

	// Override config with those passed from command-line.
	mainFlagSet := flag.NewFlagSet("nakama", flag.ExitOnError)
	mainFlagMaker := flags.NewFlagMakerFlagSet(&flags.FlagMakingOptions{
		UseLowerCase: true,
		Flatten:      false,
		TagName:      "yaml",
		TagUsage:     "usage",
	}, mainFlagSet)

	if _, err := mainFlagMaker.ParseArgs(mainConfig, args[1:]); err != nil {
		logger.Fatal("Could not parse command line arguments", zap.Error(err))
	}

	mainConfig.GetRuntime().Environment = convertRuntimeEnv(logger, runtimeEnvironment, mainConfig.GetRuntime().Env)
	mainConfig.GetRuntime().Env = make([]string, 0, len(mainConfig.GetRuntime().Environment))
	for k, v := range mainConfig.GetRuntime().Environment {
		mainConfig.GetRuntime().Env = append(mainConfig.GetRuntime().Env, fmt.Sprintf("%v=%v", k, v))
	}
	sort.Strings(mainConfig.GetRuntime().Env)

	if mainConfig.GetGoogleAuth() != nil && mainConfig.GetGoogleAuth().CredentialsJSON != "" {
		cnf, err := google.ConfigFromJSON([]byte(mainConfig.GetGoogleAuth().CredentialsJSON))
		if err != nil {
			logger.Fatal("Failed to parse Google's credentials JSON", zap.Error(err))
		}
		mainConfig.GetGoogleAuth().OAuthConfig = cnf
	}

	return mainConfig
}

func ValidateConfig(logger *zap.Logger, c Config) map[string]string {
	// Fail fast on invalid values.
	ValidateConfigDatabase(logger, c)
	if l := len(c.GetName()); l < 1 || l > 16 {
		logger.Fatal("Name must be 1-16 characters", zap.String("param", "name"))
	}
	if c.GetShutdownGraceSec() < 0 {
		logger.Fatal("Shutdown grace period must be >= 0", zap.Int("shutdown_grace_sec", c.GetShutdownGraceSec()))
	}
	if c.GetSocket().ServerKey == "" {
		logger.Fatal("Server key must be set", zap.String("param", "socket.server_key"))
	}
	if c.GetSession().TokenExpirySec < 1 {
		logger.Fatal("Token expiry seconds must be >= 1", zap.String("param", "session.token_expiry_sec"))
	}
	if c.GetSession().EncryptionKey == "" {
		logger.Fatal("Encryption key must be set", zap.String("param", "session.encryption_key"))
	}
	if c.GetSession().RefreshEncryptionKey == "" {
		logger.Fatal("Refresh token encryption key must be set", zap.String("param", "session.refresh_encryption_key"))
	}
	if c.GetSession().RefreshTokenExpirySec < 1 {
		logger.Fatal("Refresh token expiry seconds must be >= 1", zap.String("param", "session.refresh_token_expiry_sec"))
	}
	if c.GetSession().EncryptionKey == c.GetSession().RefreshEncryptionKey {
		logger.Fatal("Encryption key and refresh token encryption cannot match", zap.Strings("param", []string{"session.encryption_key", "session.refresh_encryption_key"}))
	}
	if c.GetSession().SingleMatch && !c.GetSession().SingleSocket {
		logger.Fatal("Single match cannot be enabled without single socket", zap.Strings("param", []string{"session.single_match", "session.single_socket"}))
	}
	if c.GetSession().SingleParty && !c.GetSession().SingleSocket {
		logger.Fatal("Single party cannot be enabled without single socket", zap.Strings("param", []string{"session.single_party", "session.single_socket"}))
	}
	if c.GetRuntime().HTTPKey == "" {
		logger.Fatal("Runtime HTTP key must be set", zap.String("param", "runtime.http_key"))
	}
	if c.GetConsole().MaxMessageSizeBytes < 1 {
		logger.Fatal("Console max message size bytes must be >= 1", zap.Int64("console.max_message_size_bytes", c.GetConsole().MaxMessageSizeBytes))
	}
	if c.GetConsole().ReadTimeoutMs < 1 {
		logger.Fatal("Console read timeout milliseconds must be >= 1", zap.Int("console.read_timeout_ms", c.GetConsole().ReadTimeoutMs))
	}
	if c.GetConsole().WriteTimeoutMs < 1 {
		logger.Fatal("Console write timeout milliseconds must be >= 1", zap.Int("console.write_timeout_ms", c.GetConsole().WriteTimeoutMs))
	}
	if c.GetConsole().IdleTimeoutMs < 1 {
		logger.Fatal("Console idle timeout milliseconds must be >= 1", zap.Int("console.idle_timeout_ms", c.GetConsole().IdleTimeoutMs))
	}
	if c.GetConsole().Username == "" || !usernameRegex.MatchString(c.GetConsole().Username) {
		logger.Fatal("Console username must be set and valid", zap.String("param", "console.username"))
	}
	if c.GetConsole().Password == "" {
		logger.Fatal("Console password must be set", zap.String("param", "console.password"))
	}
	if c.GetConsole().SigningKey == "" {
		logger.Fatal("Console signing key must be set", zap.String("param", "console.signing_key"))
	}
	if p := c.GetSocket().Protocol; p != "tcp" && p != "tcp4" && p != "tcp6" {
		logger.Fatal("Socket protocol must be one of: tcp, tcp4, tcp6", zap.String("socket.protocol", c.GetSocket().Protocol))
	}
	if c.GetSocket().MaxMessageSizeBytes < 1 {
		logger.Fatal("Socket max message size bytes must be >= 1", zap.Int64("socket.max_message_size_bytes", c.GetSocket().MaxMessageSizeBytes))
	}
	if c.GetSocket().MaxRequestSizeBytes < 1 {
		logger.Fatal("Socket max request size bytes must be >= 1", zap.Int64("socket.max_request_size_bytes", c.GetSocket().MaxRequestSizeBytes))
	}
	if c.GetSocket().ReadBufferSizeBytes < 1 {
		logger.Fatal("Socket read buffer size bytes must be >= 1", zap.Int("socket.read_buffer_size_bytes", c.GetSocket().ReadBufferSizeBytes))
	}
	if c.GetSocket().WriteBufferSizeBytes < 1 {
		logger.Fatal("Socket write buffer size bytes must be >= 1", zap.Int("socket.write_buffer_size_bytes", c.GetSocket().WriteBufferSizeBytes))
	}
	if c.GetSocket().ReadTimeoutMs < 1 {
		logger.Fatal("Socket read timeout milliseconds must be >= 1", zap.Int("socket.read_timeout_ms", c.GetSocket().ReadTimeoutMs))
	}
	if c.GetSocket().WriteTimeoutMs < 1 {
		logger.Fatal("Socket write timeout milliseconds must be >= 1", zap.Int("socket.write_timeout_ms", c.GetSocket().WriteTimeoutMs))
	}
	if c.GetSocket().IdleTimeoutMs < 1 {
		logger.Fatal("Socket idle timeout milliseconds must be >= 1", zap.Int("socket.idle_timeout_ms", c.GetSocket().IdleTimeoutMs))
	}
	if c.GetSocket().PingPeriodMs >= c.GetSocket().PongWaitMs {
		logger.Fatal("Ping period value must be less than pong wait value", zap.Int("socket.ping_period_ms", c.GetSocket().PingPeriodMs), zap.Int("socket.pong_wait_ms", c.GetSocket().PongWaitMs))
	}
	if c.GetRuntime().GetLuaMinCount() < 0 {
		logger.Fatal("Minimum Lua runtime instance count must be >= 0", zap.Int("runtime.lua_min_count", c.GetRuntime().GetLuaMinCount()))
	}
	if c.GetRuntime().GetLuaMaxCount() < 1 {
		logger.Fatal("Maximum Lua runtime instance count must be >= 1", zap.Int("runtime.lua_max_count", c.GetRuntime().GetLuaMinCount()))
	}
	if c.GetRuntime().GetLuaMinCount() > c.GetRuntime().GetLuaMaxCount() {
		logger.Fatal("Minimum Lua runtime instance count must be less than or equal to maximum Lua runtime instance count", zap.Int("runtime.lua_min_count", c.GetRuntime().GetLuaMinCount()), zap.Int("runtime.lua_max_count", c.GetRuntime().GetLuaMaxCount()))
	}
	if c.GetRuntime().GetLuaCallStackSize() < 1 {
		logger.Fatal("Lua runtime instance call stack size must be >= 1", zap.Int("runtime.lua_call_stack_size", c.GetRuntime().GetLuaCallStackSize()))
	}
	if c.GetRuntime().GetLuaRegistrySize() < 128 {
		logger.Fatal("Lua runtime instance registry size must be >= 128", zap.Int("runtime.registry_size", c.GetRuntime().GetLuaRegistrySize()))
	}
	if c.GetRuntime().JsMinCount < 0 {
		logger.Fatal("Minimum JavaScript runtime instance count must be >= 0", zap.Int("runtime.js_min_count", c.GetRuntime().JsMinCount))
	}
	if c.GetRuntime().JsMaxCount < 1 {
		logger.Fatal("Maximum JavaScript runtime instance count must be >= 1", zap.Int("runtime.js_max_count", c.GetRuntime().JsMinCount))
	}
	if c.GetRuntime().JsMinCount > c.GetRuntime().JsMaxCount {
		logger.Fatal("Minimum JavaScript runtime instance count must be less than or equal to maximum JavaScript runtime instance count", zap.Int("runtime.js_min_count", c.GetRuntime().JsMinCount), zap.Int("runtime.js_max_count", c.GetRuntime().JsMaxCount))
	}
	if c.GetRuntime().EventQueueSize < 1 {
		logger.Fatal("Runtime event queue stack size must be >= 1", zap.Int("runtime.event_queue_size", c.GetRuntime().EventQueueSize))
	}
	if c.GetRuntime().EventQueueWorkers < 1 {
		logger.Fatal("Runtime event queue workers must be >= 1", zap.Int("runtime.event_queue_workers", c.GetRuntime().EventQueueWorkers))
	}
	if c.GetMatch().InputQueueSize < 1 {
		logger.Fatal("Match input queue size must be >= 1", zap.Int("match.input_queue_size", c.GetMatch().InputQueueSize))
	}
	if c.GetMatch().CallQueueSize < 1 {
		logger.Fatal("Match call queue size must be >= 1", zap.Int("match.call_queue_size", c.GetMatch().CallQueueSize))
	}
	if c.GetMatch().SignalQueueSize < 1 {
		logger.Fatal("Match signal queue size must be >= 1", zap.Int("match.signal_queue_size", c.GetMatch().SignalQueueSize))
	}
	if c.GetMatch().JoinAttemptQueueSize < 1 {
		logger.Fatal("Match join attempt queue size must be >= 1", zap.Int("match.join_attempt_queue_size", c.GetMatch().JoinAttemptQueueSize))
	}
	if c.GetMatch().DeferredQueueSize < 1 {
		logger.Fatal("Match deferred queue size must be >= 1", zap.Int("match.deferred_queue_size", c.GetMatch().DeferredQueueSize))
	}
	if c.GetMatch().JoinMarkerDeadlineMs < 1 {
		logger.Fatal("Match join marker deadline must be >= 1", zap.Int("match.join_marker_deadline_ms", c.GetMatch().JoinMarkerDeadlineMs))
	}
	if c.GetMatch().MaxEmptySec < 0 {
		logger.Fatal("Match max idle seconds must be >= 0", zap.Int("match.max_empty_sec", c.GetMatch().MaxEmptySec))
	}
	if c.GetMatch().LabelUpdateIntervalMs < 1 {
		logger.Fatal("Match label update interval milliseconds must be > 0", zap.Int("match.label_update_interval_ms", c.GetMatch().LabelUpdateIntervalMs))
	}
	if c.GetTracker().EventQueueSize < 1 {
		logger.Fatal("Tracker presence event queue size must be >= 1", zap.Int("tracker.event_queue_size", c.GetTracker().EventQueueSize))
	}
	if c.GetLeaderboard().CallbackQueueSize < 1 {
		logger.Fatal("Leaderboard callback queue stack size must be >= 1", zap.Int("leaderboard.callback_queue_size", c.GetLeaderboard().CallbackQueueSize))
	}
	if c.GetLeaderboard().CallbackQueueWorkers < 1 {
		logger.Fatal("Leaderboard callback queue workers must be >= 1", zap.Int("leaderboard.callback_queue_workers", c.GetLeaderboard().CallbackQueueWorkers))
	}
	if c.GetMatchmaker().MaxTickets < 1 {
		logger.Fatal("Matchmaker maximum ticket count must be >= 1", zap.Int("matchmaker.max_tickets", c.GetMatchmaker().MaxTickets))
	}
	if c.GetMatchmaker().IntervalSec < 1 {
		logger.Fatal("Matchmaker interval time seconds must be >= 1", zap.Int("matchmaker.interval_sec", c.GetMatchmaker().IntervalSec))
	}
	if c.GetMatchmaker().MaxIntervals < 1 {
		logger.Fatal("Matchmaker max intervals must be >= 1", zap.Int("matchmaker.max_intervals", c.GetMatchmaker().MaxIntervals))
	}
	if c.GetMatchmaker().RevThreshold < 0 {
		logger.Fatal("Matchmaker reverse matching threshold must be >= 0", zap.Int("matchmaker.rev_threshold", c.GetMatchmaker().RevThreshold))
	}
	if c.GetMatchmaker().MaxIntervals < 1 {
		logger.Fatal("Matchmaker max intervals must be >= 1", zap.Int("matchmaker.max_intervals", c.GetMatchmaker().MaxIntervals))
	}
	if c.GetMatchmaker().RevThreshold < 0 {
		logger.Fatal("Matchmaker reverse matching threshold must be >= 0", zap.Int("matchmaker.rev_threshold", c.GetMatchmaker().RevThreshold))
	}
	if c.GetLimit() != -1 {
		logger.Warn("WARNING: 'limit' is only valid if used with the migrate command", zap.String("param", "limit"))
	}

	// If the runtime path is not overridden, set it to `datadir/modules`.
	if c.GetRuntime().Path == "" {
		c.GetRuntime().Path = filepath.Join(c.GetDataDir(), "modules")
	}

	// If JavaScript entrypoint is set, make sure it points to a valid file.
	if c.GetRuntime().JsEntrypoint != "" {
		p := filepath.Join(c.GetRuntime().Path, c.GetRuntime().JsEntrypoint)
		info, err := os.Stat(p)
		if err != nil {
			logger.Fatal("JavaScript entrypoint must be a valid path", zap.Error(err))
		}
		if filepath.Ext(info.Name()) != ".js" {
			logger.Fatal("JavaScript entrypoint must point to a .js file", zap.String("runtime.js_entrypoint", p))
		}
	}

	if c.GetIAP().Google.RefundCheckPeriodMin != 0 {
		if c.GetIAP().Google.RefundCheckPeriodMin < 15 {
			logger.Fatal("Google IAP refund check period must be >= 15 min")
		}
	}

	configWarnings := make(map[string]string, 8)

	// Log warnings for insecure default parameter values.
	if c.GetConsole().Username == "admin" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.username"))
		configWarnings["console.username"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetConsole().Password == "password" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.password"))
		configWarnings["console.password"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetConsole().SigningKey == "defaultsigningkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.signing_key"))
		configWarnings["console.signing_key"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetSocket().ServerKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "socket.server_key"))
		configWarnings["socket.server_key"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetSession().EncryptionKey == "defaultencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.encryption_key"))
		configWarnings["session.encryption_key"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetSession().RefreshEncryptionKey == "defaultrefreshencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.refresh_encryption_key"))
		configWarnings["session.refresh_encryption_key"] = "Insecure default parameter value, change this for production!"
	}
	if c.GetRuntime().HTTPKey == "defaulthttpkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "runtime.http_key"))
		configWarnings["runtime.http_key"] = "Insecure default parameter value, change this for production!"
	}

	// Log warnings for deprecated c parameters.
	if c.GetRuntime().MinCount != 0 {
		logger.Warn("WARNING: deprecated configuration parameter", zap.String("deprecated", "runtime.min_count"), zap.String("param", "runtime.lua_min_count"))
		configWarnings["runtime.min_count"] = "Deprecated configuration parameter"
	}
	if c.GetRuntime().MaxCount != 0 {
		logger.Warn("WARNING: deprecated configuration parameter", zap.String("deprecated", "runtime.max_count"), zap.String("param", "runtime.lua_max_count"))
		configWarnings["runtime.max_count"] = "Deprecated configuration parameter"
	}
	if c.GetRuntime().CallStackSize != 0 {
		logger.Warn("WARNING: deprecated configuration parameter", zap.String("deprecated", "runtime.call_stack_size"), zap.String("param", "runtime.lua_call_stack_size"))
		configWarnings["runtime.call_stack_size"] = "Deprecated configuration parameter"
	}
	if c.GetRuntime().RegistrySize != 0 {
		logger.Warn("WARNING: deprecated configuration parameter", zap.String("deprecated", "runtime.registry_size"), zap.String("param", "runtime.lua_registry_size"))
		configWarnings["runtime.registry_size"] = "Deprecated configuration parameter"
	}
	if !c.GetRuntime().ReadOnlyGlobals {
		logger.Warn("WARNING: deprecated configuration parameter", zap.String("deprecated", "runtime.read_only_globals"), zap.String("param", "runtime.lua_read_only_globals"))
		configWarnings["runtime.read_only_globals"] = "Deprecated configuration parameter"
	}

	if l := len(c.GetSocket().ResponseHeaders); l > 0 {
		c.GetSocket().Headers = make(map[string]string, l)
		for _, header := range c.GetSocket().ResponseHeaders {
			parts := strings.SplitN(header, "=", 2)
			if len(parts) != 2 {
				logger.Fatal("Response headers configuration invalid, format must be 'key=value'", zap.String("param", "socket.response_headers"))
			}
			c.GetSocket().Headers[parts[0]] = parts[1]
		}
	}

	// Log warnings for SSL usage.
	if c.GetSocket().SSLCertificate != "" && c.GetSocket().SSLPrivateKey == "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_certificate"))
	}
	if c.GetSocket().SSLCertificate == "" && c.GetSocket().SSLPrivateKey != "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_private_key"))
	}
	if c.GetSocket().SSLCertificate != "" && c.GetSocket().SSLPrivateKey != "" {
		logger.Warn("WARNING: enabling direct SSL termination is not recommended, use an SSL-capable proxy or load balancer for production!")
		certPEMBlock, err := os.ReadFile(c.GetSocket().SSLCertificate)
		if err != nil {
			logger.Fatal("Error loading SSL certificate cert file", zap.Error(err))
		}
		keyPEMBlock, err := os.ReadFile(c.GetSocket().SSLPrivateKey)
		if err != nil {
			logger.Fatal("Error loading SSL certificate key file", zap.Error(err))
		}
		cert, err := tls.X509KeyPair(certPEMBlock, keyPEMBlock)
		if err != nil {
			logger.Fatal("Error loading SSL certificate", zap.Error(err))
		}
		configWarnings["socket.ssl_certificate"] = "Enabling direct SSL termination is not recommended, use an SSL-capable proxy or load balancer for production!"
		configWarnings["socket.ssl_private_key"] = "Enabling direct SSL termination is not recommended, use an SSL-capable proxy or load balancer for production!"
		logger.Info("SSL mode enabled")
		c.GetSocket().CertPEMBlock = certPEMBlock
		c.GetSocket().KeyPEMBlock = keyPEMBlock
		c.GetSocket().TLSCert = []tls.Certificate{cert}
	}

	c.GetSatori().Validate(logger)

	return configWarnings
}

func ValidateConfigDatabase(logger *zap.Logger, c Config) {
	if len(c.GetDatabase().Addresses) < 1 {
		logger.Fatal("At least one database address must be specified", zap.Strings("database.address", c.GetDatabase().Addresses))
	}
	for _, address := range c.GetDatabase().Addresses {
		rawURL := fmt.Sprintf("postgresql://%s", address)
		if _, err := url.Parse(rawURL); err != nil {
			logger.Fatal("Bad database connection URL", zap.String("database.address", address), zap.Error(err))
		}
	}
	if c.GetDatabase().DnsScanIntervalSec < 1 {
		logger.Fatal("Database DNS scan interval seconds must be > 0", zap.Int("database.dns_scan_interval_sec", c.GetDatabase().DnsScanIntervalSec))
	}
}

func convertRuntimeEnv(logger *zap.Logger, existingEnv map[string]string, mergeEnv []string) map[string]string {
	envMap := make(map[string]string, len(existingEnv))
	for k, v := range existingEnv {
		envMap[k] = v
	}

	for _, e := range mergeEnv {
		if !strings.Contains(e, "=") {
			logger.Fatal("Invalid runtime environment value.", zap.String("value", e))
		}

		kv := strings.SplitN(e, "=", 2) // the value can contain the character "=" many times over.
		if len(kv) == 1 {
			envMap[kv[0]] = ""
		} else if len(kv) == 2 {
			envMap[kv[0]] = kv[1]
		}
	}
	return envMap
}

type config struct {
	Name             string             `yaml:"name" json:"name" usage:"Nakama server’s node name - must be unique."`
	Config           []string           `yaml:"config" json:"config" usage:"The absolute file path to configuration YAML file."`
	ShutdownGraceSec int                `yaml:"shutdown_grace_sec" json:"shutdown_grace_sec" usage:"Maximum number of seconds to wait for the server to complete work before shutting down. Default is 0 seconds. If 0 the server will shut down immediately when it receives a termination signal."`
	Datadir          string             `yaml:"data_dir" json:"data_dir" usage:"An absolute path to a writeable folder where Nakama will store its data."`
	Logger           *LoggerConfig      `yaml:"logger" json:"logger" usage:"Logger levels and output."`
	Metrics          *MetricsConfig     `yaml:"metrics" json:"metrics" usage:"Metrics settings."`
	Session          *SessionConfig     `yaml:"session" json:"session" usage:"Session authentication settings."`
	Socket           *SocketConfig      `yaml:"socket" json:"socket" usage:"Socket configuration."`
	Database         *DatabaseConfig    `yaml:"database" json:"database" usage:"Database connection settings."`
	Social           *SocialConfig      `yaml:"social" json:"social" usage:"Properties for social provider integrations."`
	Runtime          *RuntimeConfig     `yaml:"runtime" json:"runtime" usage:"Script Runtime properties."`
	Match            *MatchConfig       `yaml:"match" json:"match" usage:"Authoritative realtime match properties."`
	Tracker          *TrackerConfig     `yaml:"tracker" json:"tracker" usage:"Presence tracker properties."`
	Console          *ConsoleConfig     `yaml:"console" json:"console" usage:"Console settings."`
	Leaderboard      *LeaderboardConfig `yaml:"leaderboard" json:"leaderboard" usage:"Leaderboard settings."`
	Matchmaker       *MatchmakerConfig  `yaml:"matchmaker" json:"matchmaker" usage:"Matchmaker settings."`
	IAP              *IAPConfig         `yaml:"iap" json:"iap" usage:"In-App Purchase settings."`
	GoogleAuth       *GoogleAuthConfig  `yaml:"google_auth" json:"google_auth" usage:"Google's auth settings."`
	Satori           *SatoriConfig      `yaml:"satori" json:"satori" usage:"Satori integration settings."`
	Storage          *StorageConfig     `yaml:"storage" json:"storage" usage:"Storage settings."`
	Limit            int                `json:"-"` // Only used for migrate command.
}

// NewConfig constructs a Config struct which represents server settings, and populates it with default values.
func NewConfig(logger *zap.Logger) *config {
	cwd, err := os.Getwd()
	if err != nil {
		logger.Fatal("Error getting current working directory.", zap.Error(err))
	}
	return &config{
		Name:             "nakama",
		Datadir:          filepath.Join(cwd, "data"),
		ShutdownGraceSec: 0,
		Logger:           NewLoggerConfig(),
		Metrics:          NewMetricsConfig(),
		Session:          NewSessionConfig(),
		Socket:           NewSocketConfig(),
		Database:         NewDatabaseConfig(),
		Social:           NewSocialConfig(),
		Runtime:          NewRuntimeConfig(),
		Match:            NewMatchConfig(),
		Tracker:          NewTrackerConfig(),
		Console:          NewConsoleConfig(),
		Leaderboard:      NewLeaderboardConfig(),
		Matchmaker:       NewMatchmakerConfig(),
		IAP:              NewIAPConfig(),
		GoogleAuth:       NewGoogleAuthConfig(),
		Satori:           NewSatoriConfig(),
		Storage:          NewStorageConfig(),
		Limit:            -1,
	}
}

func (c *config) Clone() (Config, error) {
	configLogger := *(c.Logger)
	configMetrics := *(c.Metrics)
	configSession := *(c.Session)
	configSocket := *(c.Socket)
	configDatabase := *(c.Database)
	configSocial := *(c.Social)
	configRuntime := *(c.Runtime)
	configMatch := *(c.Match)
	configTracker := *(c.Tracker)
	configConsole := *(c.Console)
	configLeaderboard := *(c.Leaderboard)
	configMatchmaker := *(c.Matchmaker)
	configIAP := *(c.IAP)
	configSatori := *(c.Satori)
	configStorage := *(c.Storage)
	configGoogleAuth := *(c.GoogleAuth)
	nc := &config{
		Name:             c.Name,
		Datadir:          c.Datadir,
		ShutdownGraceSec: c.ShutdownGraceSec,
		Logger:           &configLogger,
		Metrics:          &configMetrics,
		Session:          &configSession,
		Socket:           &configSocket,
		Database:         &configDatabase,
		Social:           &configSocial,
		Runtime:          &configRuntime,
		Match:            &configMatch,
		Tracker:          &configTracker,
		Console:          &configConsole,
		Leaderboard:      &configLeaderboard,
		Matchmaker:       &configMatchmaker,
		IAP:              &configIAP,
		Satori:           &configSatori,
		GoogleAuth:       &configGoogleAuth,
		Storage:          &configStorage,
	}
	nc.Socket.CertPEMBlock = make([]byte, len(c.Socket.CertPEMBlock))
	copy(nc.Socket.CertPEMBlock, c.Socket.CertPEMBlock)
	nc.Socket.KeyPEMBlock = make([]byte, len(c.Socket.KeyPEMBlock))
	copy(nc.Socket.KeyPEMBlock, c.Socket.KeyPEMBlock)
	if len(c.Socket.TLSCert) != 0 {
		cert, err := tls.X509KeyPair(nc.Socket.CertPEMBlock, nc.Socket.KeyPEMBlock)
		if err != nil {
			return nil, err
		}
		nc.Socket.TLSCert = []tls.Certificate{cert}
	}
	nc.Database.Addresses = make([]string, len(c.Database.Addresses))
	copy(nc.Database.Addresses, c.Database.Addresses)
	nc.Runtime.Env = make([]string, len(c.Runtime.Env))
	copy(nc.Runtime.Env, c.Runtime.Env)
	nc.Runtime.Environment = make(map[string]string, len(c.Runtime.Environment))
	for k, v := range c.Runtime.Environment {
		nc.Runtime.Environment[k] = v
	}
	nc.Leaderboard.BlacklistRankCache = make([]string, len(c.Leaderboard.BlacklistRankCache))
	copy(nc.Leaderboard.BlacklistRankCache, c.Leaderboard.BlacklistRankCache)

	return nc, nil
}

func (c *config) GetName() string {
	return c.Name
}

func (c *config) GetDataDir() string {
	return c.Datadir
}

func (c *config) GetShutdownGraceSec() int {
	return c.ShutdownGraceSec
}

func (c *config) GetLogger() *LoggerConfig {
	return c.Logger
}

func (c *config) GetMetrics() *MetricsConfig {
	return c.Metrics
}

func (c *config) GetSession() *SessionConfig {
	return c.Session
}

func (c *config) GetSocket() *SocketConfig {
	return c.Socket
}

func (c *config) GetDatabase() *DatabaseConfig {
	return c.Database
}

func (c *config) GetSocial() *SocialConfig {
	return c.Social
}

func (c *config) GetRuntime() *RuntimeConfig {
	return c.Runtime
}

func (c *config) GetMatch() *MatchConfig {
	return c.Match
}

func (c *config) GetTracker() *TrackerConfig {
	return c.Tracker
}

func (c *config) GetConsole() *ConsoleConfig {
	return c.Console
}

func (c *config) GetLeaderboard() *LeaderboardConfig {
	return c.Leaderboard
}

func (c *config) GetMatchmaker() *MatchmakerConfig {
	return c.Matchmaker
}

func (c *config) GetIAP() *IAPConfig {
	return c.IAP
}

func (c *config) GetGoogleAuth() *GoogleAuthConfig {
	return c.GoogleAuth
}

func (c *config) GetSatori() *SatoriConfig {
	return c.Satori
}

func (c *config) GetStorage() *StorageConfig {
	return c.Storage
}

func (c *config) GetLimit() int {
	return c.Limit
}

// LoggerConfig is configuration relevant to logging levels and output.
type LoggerConfig struct {
	Level    string `yaml:"level" json:"level" usage:"Log level to set. Valid values are 'debug', 'info', 'warn', 'error'. Default 'info'."`
	Stdout   bool   `yaml:"stdout" json:"stdout" usage:"Log to standard console output (as well as to a file if set). Default true."`
	File     string `yaml:"file" json:"file" usage:"Log output to a file (as well as stdout if set). Make sure that the directory and the file is writable."`
	Rotation bool   `yaml:"rotation" json:"rotation" usage:"Rotate log files. Default is false."`
	// Reference: https://godoc.org/gopkg.in/natefinch/lumberjack.v2
	MaxSize    int    `yaml:"max_size" json:"max_size" usage:"The maximum size in megabytes of the log file before it gets rotated. It defaults to 100 megabytes."`
	MaxAge     int    `yaml:"max_age" json:"max_age" usage:"The maximum number of days to retain old log files based on the timestamp encoded in their filename. The default is not to remove old log files based on age."`
	MaxBackups int    `yaml:"max_backups" json:"max_backups" usage:"The maximum number of old log files to retain. The default is to retain all old log files (though MaxAge may still cause them to get deleted.)"`
	LocalTime  bool   `yaml:"local_time" json:"local_time" usage:"This determines if the time used for formatting the timestamps in backup files is the computer's local time. The default is to use UTC time."`
	Compress   bool   `yaml:"compress" json:"compress" usage:"This determines if the rotated log files should be compressed using gzip."`
	Format     string `yaml:"format" json:"format" usage:"Set logging output format. Can either be 'JSON' or 'Stackdriver'. Default is 'JSON'."`
}

func NewLoggerConfig() *LoggerConfig {
	return &LoggerConfig{
		Level:      "info",
		Stdout:     true,
		File:       "",
		Rotation:   false,
		MaxSize:    100,
		MaxAge:     0,
		MaxBackups: 0,
		LocalTime:  false,
		Compress:   false,
		Format:     "json",
	}
}

// MetricsConfig is configuration relevant to metrics capturing and output.
type MetricsConfig struct {
	ReportingFreqSec int    `yaml:"reporting_freq_sec" json:"reporting_freq_sec" usage:"Frequency of metrics exports. Default is 60 seconds."`
	Namespace        string `yaml:"namespace" json:"namespace" usage:"Namespace for Prometheus metrics. It will always prepend node name."`
	PrometheusPort   int    `yaml:"prometheus_port" json:"prometheus_port" usage:"Port to expose Prometheus. If '0' Prometheus exports are disabled."`
	Prefix           string `yaml:"prefix" json:"prefix" usage:"Prefix for metric names. Default is 'nakama', empty string '' disables the prefix."`
	CustomPrefix     string `yaml:"custom_prefix" json:"custom_prefix" usage:"Prefix for custom runtime metric names. Default is 'custom', empty string '' disables the prefix."`
}

func NewMetricsConfig() *MetricsConfig {
	return &MetricsConfig{
		ReportingFreqSec: 60,
		Namespace:        "",
		PrometheusPort:   0,
		Prefix:           "nakama",
		CustomPrefix:     "custom",
	}
}

// SessionConfig is configuration relevant to the session.
type SessionConfig struct {
	EncryptionKey         string `yaml:"encryption_key" json:"encryption_key" usage:"The encryption key used to produce the client token."`
	TokenExpirySec        int64  `yaml:"token_expiry_sec" json:"token_expiry_sec" usage:"Token expiry in seconds."`
	RefreshEncryptionKey  string `yaml:"refresh_encryption_key" json:"refresh_encryption_key" usage:"The encryption key used to produce the client refresh token."`
	RefreshTokenExpirySec int64  `yaml:"refresh_token_expiry_sec" json:"refresh_token_expiry_sec" usage:"Refresh token expiry in seconds."`
	SingleSocket          bool   `yaml:"single_socket" json:"single_socket" usage:"Only allow one socket per user. Older sessions are disconnected. Default false."`
	SingleMatch           bool   `yaml:"single_match" json:"single_match" usage:"Only allow one match per user. Older matches receive a leave. Requires single socket to enable. Default false."`
	SingleParty           bool   `yaml:"single_party" json:"single_party" usage:"Only allow one party per user. Older parties receive a leave. Requires single socket to enable. Default false."`
	SingleSession         bool   `yaml:"single_session" json:"single_session" usage:"Only allow one session token per user. Older session tokens are invalidated in the session cache. Default false."`
}

func NewSessionConfig() *SessionConfig {
	return &SessionConfig{
		EncryptionKey:         "defaultencryptionkey",
		TokenExpirySec:        60,
		RefreshEncryptionKey:  "defaultrefreshencryptionkey",
		RefreshTokenExpirySec: 3600,
	}
}

// SocketConfig is configuration relevant to the transport socket and protocol.
type SocketConfig struct {
	ServerKey            string            `yaml:"server_key" json:"server_key" usage:"Server key to use to establish a connection to the server."`
	Port                 int               `yaml:"port" json:"port" usage:"The port for accepting connections from the client for the given interface(s), address(es), and protocol(s). Default 7350."`
	Address              string            `yaml:"address" json:"address" usage:"The IP address of the interface to listen for client traffic on. Default listen on all available addresses/interfaces."`
	Protocol             string            `yaml:"protocol" json:"protocol" usage:"The network protocol to listen for traffic on. Possible values are 'tcp' for both IPv4 and IPv6, 'tcp4' for IPv4 only, or 'tcp6' for IPv6 only. Default 'tcp'."`
	MaxMessageSizeBytes  int64             `yaml:"max_message_size_bytes" json:"max_message_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from the client socket per message. Used for real-time connections."`
	MaxRequestSizeBytes  int64             `yaml:"max_request_size_bytes" json:"max_request_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from clients per request. Used for gRPC and HTTP connections."`
	ReadBufferSizeBytes  int               `yaml:"read_buffer_size_bytes" json:"read_buffer_size_bytes" usage:"Size in bytes of the pre-allocated socket read buffer. Default 4096."`
	WriteBufferSizeBytes int               `yaml:"write_buffer_size_bytes" json:"write_buffer_size_bytes" usage:"Size in bytes of the pre-allocated socket write buffer. Default 4096."`
	ReadTimeoutMs        int               `yaml:"read_timeout_ms" json:"read_timeout_ms" usage:"Maximum duration in milliseconds for reading the entire request. Used for HTTP connections."`
	WriteTimeoutMs       int               `yaml:"write_timeout_ms" json:"write_timeout_ms" usage:"Maximum duration in milliseconds before timing out writes of the response. Used for HTTP connections."`
	IdleTimeoutMs        int               `yaml:"idle_timeout_ms" json:"idle_timeout_ms" usage:"Maximum amount of time in milliseconds to wait for the next request when keep-alives are enabled. Used for HTTP connections."`
	WriteWaitMs          int               `yaml:"write_wait_ms" json:"write_wait_ms" usage:"Time in milliseconds to wait for an ack from the client when writing data. Used for real-time connections."`
	PongWaitMs           int               `yaml:"pong_wait_ms" json:"pong_wait_ms" usage:"Time in milliseconds to wait between pong messages received from the client. Used for real-time connections."`
	PingPeriodMs         int               `yaml:"ping_period_ms" json:"ping_period_ms" usage:"Time in milliseconds to wait between sending ping messages to the client. This value must be less than the pong_wait_ms. Used for real-time connections."`
	PingBackoffThreshold int               `yaml:"ping_backoff_threshold" json:"ping_backoff_threshold" usage:"Minimum number of messages received from the client during a single ping period that will delay the sending of a ping until the next ping period, to avoid sending unnecessary pings on regularly active connections. Default 20."`
	OutgoingQueueSize    int               `yaml:"outgoing_queue_size" json:"outgoing_queue_size" usage:"The maximum number of messages waiting to be sent to the client. If this is exceeded the client is considered too slow and will disconnect. Used when processing real-time connections."`
	SSLCertificate       string            `yaml:"ssl_certificate" json:"ssl_certificate" usage:"Path to certificate file if you want the server to use SSL directly. Must also supply ssl_private_key. NOT recommended for production use."`
	SSLPrivateKey        string            `yaml:"ssl_private_key" json:"ssl_private_key" usage:"Path to private key file if you want the server to use SSL directly. Must also supply ssl_certificate. NOT recommended for production use."`
	ResponseHeaders      []string          `yaml:"response_headers" json:"response_headers" usage:"Additional headers to send to clients with every response. Values here are only used if the response would not otherwise contain a value for the specified headers."`
	Headers              map[string]string `yaml:"-" json:"-"` // Created by parsing ResponseHeaders above, not set from input args directly.
	CertPEMBlock         []byte            `yaml:"-" json:"-"` // Created by fully reading the file contents of SSLCertificate, not set from input args directly.
	KeyPEMBlock          []byte            `yaml:"-" json:"-"` // Created by fully reading the file contents of SSLPrivateKey, not set from input args directly.
	TLSCert              []tls.Certificate `yaml:"-" json:"-"` // Created by processing CertPEMBlock and KeyPEMBlock, not set from input args directly.
}

func NewSocketConfig() *SocketConfig {
	return &SocketConfig{
		ServerKey:            "defaultkey",
		Port:                 7350,
		Address:              "",
		Protocol:             "tcp",
		MaxMessageSizeBytes:  4096,
		MaxRequestSizeBytes:  262_144, // 256 KB.
		ReadBufferSizeBytes:  4096,
		WriteBufferSizeBytes: 4096,
		ReadTimeoutMs:        10 * 1000,
		WriteTimeoutMs:       10 * 1000,
		IdleTimeoutMs:        60 * 1000,
		WriteWaitMs:          5000,
		PongWaitMs:           25000,
		PingPeriodMs:         15000,
		PingBackoffThreshold: 20,
		OutgoingQueueSize:    64,
		SSLCertificate:       "",
		SSLPrivateKey:        "",
	}
}

// DatabaseConfig is configuration relevant to the Database storage.
type DatabaseConfig struct {
	Addresses          []string `yaml:"address" json:"address" usage:"List of database servers (username:password@address:port/dbname). Default 'root@localhost:26257'."`
	ConnMaxLifetimeMs  int      `yaml:"conn_max_lifetime_ms" json:"conn_max_lifetime_ms" usage:"Time in milliseconds to reuse a database connection before the connection is killed and a new one is created. Default 3600000 (1 hour)."`
	MaxOpenConns       int      `yaml:"max_open_conns" json:"max_open_conns" usage:"Maximum number of allowed open connections to the database. Default 100."`
	MaxIdleConns       int      `yaml:"max_idle_conns" json:"max_idle_conns" usage:"Maximum number of allowed open but unused connections to the database. Default 100."`
	DnsScanIntervalSec int      `yaml:"dns_scan_interval_sec" json:"dns_scan_interval_sec" usage:"Number of seconds between scans looking for DNS resolution changes for the database hostname. Default 60."`
}

func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Addresses:          []string{"root@localhost:26257"},
		ConnMaxLifetimeMs:  3600000,
		MaxOpenConns:       100,
		MaxIdleConns:       100,
		DnsScanIntervalSec: 60,
	}
}

// SocialConfig is configuration relevant to the social authentication providers.
type SocialConfig struct {
	Steam                *SocialConfigSteam                `yaml:"steam" json:"steam" usage:"Steam configuration."`
	FacebookInstantGame  *SocialConfigFacebookInstantGame  `yaml:"facebook_instant_game" json:"facebook_instant_game" usage:"Facebook Instant Game configuration."`
	FacebookLimitedLogin *SocialConfigFacebookLimitedLogin `yaml:"facebook_limited_login" json:"facebook_limited_login" usage:"Facebook Limited Login configuration."`
	Apple                *SocialConfigApple                `yaml:"apple" json:"apple" usage:"Apple Sign In configuration."`
}

// SocialConfigSteam is configuration relevant to Steam.
type SocialConfigSteam struct {
	PublisherKey string `yaml:"publisher_key" json:"publisher_key" usage:"Steam Publisher Key value."`
	AppID        int    `yaml:"app_id" json:"app_id" usage:"Steam App ID."`
}

// SocialConfigFacebookInstantGame is configuration relevant to Facebook Instant Games.
type SocialConfigFacebookInstantGame struct {
	AppSecret string `yaml:"app_secret" json:"app_secret" usage:"Facebook Instant App secret."`
}

// SocialConfigFacebookLimitedLogin is configuration relevant to Facebook Limited Login.
type SocialConfigFacebookLimitedLogin struct {
	AppId string `yaml:"app_id" json:"app_id" usage:"Facebook Limited Login App ID."`
}

// SocialConfigApple is configuration relevant to Apple Sign In.
type SocialConfigApple struct {
	BundleId string `yaml:"bundle_id" json:"bundle_id" usage:"Apple Sign In bundle ID."`
}

func NewSocialConfig() *SocialConfig {
	return &SocialConfig{
		Steam: &SocialConfigSteam{
			PublisherKey: "",
			AppID:        0,
		},
		FacebookInstantGame: &SocialConfigFacebookInstantGame{
			AppSecret: "",
		},
		FacebookLimitedLogin: &SocialConfigFacebookLimitedLogin{
			AppId: "",
		},
		Apple: &SocialConfigApple{
			BundleId: "",
		},
	}
}

// RuntimeConfig is configuration relevant to the Runtimes.
type RuntimeConfig struct {
	Environment        map[string]string `yaml:"-" json:"-"`
	Env                []string          `yaml:"env" json:"env" usage:"Values to pass into Runtime as environment variables."`
	Path               string            `yaml:"path" json:"path" usage:"Path for the server to scan for Lua and Go library files."`
	HTTPKey            string            `yaml:"http_key" json:"http_key" usage:"Runtime HTTP Invocation key."`
	MinCount           int               `yaml:"min_count" json:"min_count" usage:"Minimum number of Lua runtime instances to allocate. Default 0."` // Kept for backwards compatibility
	LuaMinCount        int               `yaml:"lua_min_count" json:"lua_min_count" usage:"Minimum number of Lua runtime instances to allocate. Default 16."`
	MaxCount           int               `yaml:"max_count" json:"max_count" usage:"Maximum number of Lua runtime instances to allocate. Default 0."` // Kept for backwards compatibility
	LuaMaxCount        int               `yaml:"lua_max_count" json:"lua_max_count" usage:"Maximum number of Lua runtime instances to allocate. Default 48."`
	JsMinCount         int               `yaml:"js_min_count" json:"js_min_count" usage:"Maximum number of Javascript runtime instances to allocate. Default 16."`
	JsMaxCount         int               `yaml:"js_max_count" json:"js_max_count" usage:"Maximum number of Javascript runtime instances to allocate. Default 32."`
	CallStackSize      int               `yaml:"call_stack_size" json:"call_stack_size" usage:"Size of each runtime instance's call stack. Default 0."` // Kept for backwards compatibility
	LuaCallStackSize   int               `yaml:"lua_call_stack_size" json:"lua_call_stack_size" usage:"Size of each runtime instance's call stack. Default 128."`
	RegistrySize       int               `yaml:"registry_size" json:"registry_size" usage:"Size of each Lua runtime instance's registry. Default 0."` // Kept for backwards compatibility
	LuaRegistrySize    int               `yaml:"lua_registry_size" json:"lua_registry_size" usage:"Size of each Lua runtime instance's registry. Default 512."`
	EventQueueSize     int               `yaml:"event_queue_size" json:"event_queue_size" usage:"Size of the event queue buffer. Default 65536."`
	EventQueueWorkers  int               `yaml:"event_queue_workers" json:"event_queue_workers" usage:"Number of workers to use for concurrent processing of events. Default 8."`
	ReadOnlyGlobals    bool              `yaml:"read_only_globals" json:"read_only_globals" usage:"When enabled marks all Lua runtime global tables as read-only to reduce memory footprint. Default true."` // Kept for backwards compatibility
	LuaReadOnlyGlobals bool              `yaml:"lua_read_only_globals" json:"lua_read_only_globals" usage:"When enabled marks all Lua runtime global tables as read-only to reduce memory footprint. Default true."`
	JsReadOnlyGlobals  bool              `yaml:"js_read_only_globals" json:"js_read_only_globals" usage:"When enabled marks all Javascript runtime globals as read-only to reduce memory footprint. Default true."`
	LuaApiStacktrace   bool              `yaml:"lua_api_stacktrace" json:"lua_api_stacktrace" usage:"Include the Lua stacktrace in error responses returned to the client. Default false."`
	JsEntrypoint       string            `yaml:"js_entrypoint" json:"js_entrypoint" usage:"Specifies the location of the bundled JavaScript runtime source code."`
}

// Function to allow backwards compatibility for MinCount config
func (r *RuntimeConfig) GetLuaMinCount() int {
	if r.MinCount != 0 {
		return r.MinCount
	}
	return r.LuaMinCount
}

// Function to allow backwards compatibility for MaxCount config
func (r *RuntimeConfig) GetLuaMaxCount() int {
	if r.MaxCount != 0 {
		return r.MaxCount
	}
	return r.LuaMaxCount
}

// Function to allow backwards compatibility for CallStackSize config
func (r *RuntimeConfig) GetLuaCallStackSize() int {
	if r.CallStackSize != 0 {
		return r.CallStackSize
	}
	return r.LuaCallStackSize
}

// Function to allow backwards compatibility for RegistrySize config
func (r *RuntimeConfig) GetLuaRegistrySize() int {
	if r.RegistrySize != 0 {
		return r.RegistrySize
	}
	return r.LuaRegistrySize
}

// Function to allow backwards compatibility for LuaReadOnlyGlobals config
func (r *RuntimeConfig) GetLuaReadOnlyGlobals() bool {
	if !r.ReadOnlyGlobals {
		return r.ReadOnlyGlobals
	}
	return r.LuaReadOnlyGlobals
}

func NewRuntimeConfig() *RuntimeConfig {
	return &RuntimeConfig{
		Environment:        make(map[string]string, 0),
		Env:                make([]string, 0),
		Path:               "",
		HTTPKey:            "defaulthttpkey",
		LuaMinCount:        16,
		LuaMaxCount:        48,
		LuaCallStackSize:   128,
		LuaRegistrySize:    512,
		JsMinCount:         16,
		JsMaxCount:         32,
		EventQueueSize:     65536,
		EventQueueWorkers:  8,
		ReadOnlyGlobals:    true,
		LuaReadOnlyGlobals: true,
		JsReadOnlyGlobals:  true,
		LuaApiStacktrace:   false,
	}
}

// MatchConfig is configuration relevant to authoritative realtime multiplayer matches.
type MatchConfig struct {
	InputQueueSize        int `yaml:"input_queue_size" json:"input_queue_size" usage:"Size of the authoritative match buffer that stores client messages until they can be processed by the next tick. Default 128."`
	CallQueueSize         int `yaml:"call_queue_size" json:"call_queue_size" usage:"Size of the authoritative match buffer that sequences calls to match handler callbacks to ensure no overlaps. Default 128."`
	SignalQueueSize       int `yaml:"signal_queue_size" json:"signal_queue_size" usage:"Size of the authoritative match buffer that sequences signal operations to match handler callbacks to ensure no overlaps. Default 10."`
	JoinAttemptQueueSize  int `yaml:"join_attempt_queue_size" json:"join_attempt_queue_size" usage:"Size of the authoritative match buffer that limits the number of in-progress join attempts. Default 128."`
	DeferredQueueSize     int `yaml:"deferred_queue_size" json:"deferred_queue_size" usage:"Size of the authoritative match buffer that holds deferred message broadcasts until the end of each loop execution. Default 128."`
	JoinMarkerDeadlineMs  int `yaml:"join_marker_deadline_ms" json:"join_marker_deadline_ms" usage:"Deadline in milliseconds that client authoritative match joins will wait for match handlers to acknowledge joins. Default 15000."`
	MaxEmptySec           int `yaml:"max_empty_sec" json:"max_empty_sec" usage:"Maximum number of consecutive seconds that authoritative matches are allowed to be empty before they are stopped. 0 indicates no maximum. Default 0."`
	LabelUpdateIntervalMs int `yaml:"label_update_interval_ms" json:"label_update_interval_ms" usage:"Time in milliseconds between match label update batch processes. Default 1000."`
}

func NewMatchConfig() *MatchConfig {
	return &MatchConfig{
		InputQueueSize:        128,
		CallQueueSize:         128,
		SignalQueueSize:       10,
		JoinAttemptQueueSize:  128,
		DeferredQueueSize:     128,
		JoinMarkerDeadlineMs:  15000,
		MaxEmptySec:           0,
		LabelUpdateIntervalMs: 1000,
	}
}

// TrackerConfig is configuration relevant to the presence tracker.
type TrackerConfig struct {
	EventQueueSize int `yaml:"event_queue_size" json:"event_queue_size" usage:"Size of the tracker presence event buffer. Increase if the server is expected to generate a large number of presence events in a short time. Default 1024."`
}

func NewTrackerConfig() *TrackerConfig {
	return &TrackerConfig{
		EventQueueSize: 1024,
	}
}

// ConsoleConfig is configuration relevant to the embedded console.
type ConsoleConfig struct {
	Port                int    `yaml:"port" json:"port" usage:"The port for accepting connections for the embedded console, listening on all interfaces."`
	Address             string `yaml:"address" json:"address" usage:"The IP address of the interface to listen for console traffic on. Default listen on all available addresses/interfaces."`
	MaxMessageSizeBytes int64  `yaml:"max_message_size_bytes" json:"max_message_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from the client socket per message."`
	ReadTimeoutMs       int    `yaml:"read_timeout_ms" json:"read_timeout_ms" usage:"Maximum duration in milliseconds for reading the entire request."`
	WriteTimeoutMs      int    `yaml:"write_timeout_ms" json:"write_timeout_ms" usage:"Maximum duration in milliseconds before timing out writes of the response."`
	IdleTimeoutMs       int    `yaml:"idle_timeout_ms" json:"idle_timeout_ms" usage:"Maximum amount of time in milliseconds to wait for the next request when keep-alives are enabled."`
	Username            string `yaml:"username" json:"username" usage:"Username for the embedded console. Default username is 'admin'."`
	Password            string `yaml:"password" json:"password" usage:"Password for the embedded console. Default password is 'password'."`
	TokenExpirySec      int64  `yaml:"token_expiry_sec" json:"token_expiry_sec" usage:"Token expiry in seconds. Default 86400."`
	SigningKey          string `yaml:"signing_key" json:"signing_key" usage:"Key used to sign console session tokens."`
}

func NewConsoleConfig() *ConsoleConfig {
	return &ConsoleConfig{
		Port:                7351,
		MaxMessageSizeBytes: 4_194_304, // 4 MB.
		ReadTimeoutMs:       10 * 1000,
		WriteTimeoutMs:      60 * 1000,
		IdleTimeoutMs:       300 * 1000,
		Username:            "admin",
		Password:            "password",
		TokenExpirySec:      86400,
		SigningKey:          "defaultsigningkey",
	}
}

// LeaderboardConfig is configuration relevant to the leaderboard system.
type LeaderboardConfig struct {
	BlacklistRankCache   []string `yaml:"blacklist_rank_cache" json:"blacklist_rank_cache" usage:"Disable rank cache for leaderboards with matching identifiers. To disable rank cache entirely, use '*', otherwise leave blank to enable rank cache."`
	CallbackQueueSize    int      `yaml:"callback_queue_size" json:"callback_queue_size" usage:"Size of the leaderboard and tournament callback queue that sequences expiry/reset/end invocations. Default 65536."`
	CallbackQueueWorkers int      `yaml:"callback_queue_workers" json:"callback_queue_workers" usage:"Number of workers to use for concurrent processing of leaderboard and tournament callbacks. Default 8."`
	RankCacheWorkers     int      `yaml:"rank_cache_workers" json:"rank_cache_workers" usage:"The number of parallel workers to use while populating leaderboard rank cache from the database. Higher number of workers usually makes the process faster but at the cost of increased database load. Default 1."`
}

func NewLeaderboardConfig() *LeaderboardConfig {
	return &LeaderboardConfig{
		BlacklistRankCache:   []string{},
		CallbackQueueSize:    65536,
		CallbackQueueWorkers: 8,
		RankCacheWorkers:     1,
	}
}

type MatchmakerConfig struct {
	MaxTickets   int  `yaml:"max_tickets" json:"max_tickets" usage:"Maximum number of concurrent matchmaking tickets allowed per session or party. Default 3."`
	IntervalSec  int  `yaml:"interval_sec" json:"interval_sec" usage:"How quickly the matchmaker attempts to form matches, in seconds. Default 15."`
	MaxIntervals int  `yaml:"max_intervals" json:"max_intervals" usage:"How many intervals the matchmaker attempts to find matches at the max player count, before allowing min count. Default 2."`
	RevPrecision bool `yaml:"rev_precision" json:"rev_precision" usage:"Reverse matching precision. Default false."`
	RevThreshold int  `yaml:"rev_threshold" json:"rev_threshold" usage:"Reverse matching threshold. Default 1."`
}

func NewMatchmakerConfig() *MatchmakerConfig {
	return &MatchmakerConfig{
		MaxTickets:   3,
		IntervalSec:  15,
		MaxIntervals: 2,
		RevPrecision: false,
		RevThreshold: 1,
	}
}

type IAPConfig struct {
	Apple           *IAPAppleConfig           `yaml:"apple" json:"apple" usage:"Apple App Store purchase validation configuration."`
	Google          *IAPGoogleConfig          `yaml:"google" json:"google" usage:"Google Play Store purchase validation configuration."`
	Huawei          *IAPHuaweiConfig          `yaml:"huawei" json:"huawei" usage:"Huawei purchase validation configuration."`
	FacebookInstant *IAPFacebookInstantConfig `yaml:"facebook_instant" json:"facebook_instant" usage:"Facebook Instant purchase validation configuration."`
}

func NewIAPConfig() *IAPConfig {
	return &IAPConfig{
		Apple:           &IAPAppleConfig{},
		Google:          &IAPGoogleConfig{},
		Huawei:          &IAPHuaweiConfig{},
		FacebookInstant: &IAPFacebookInstantConfig{},
	}
}

type IAPAppleConfig struct {
	SharedPassword          string `yaml:"shared_password" json:"shared_password" usage:"Your Apple Store App IAP shared password. Only necessary for validation of auto-renewable subscriptions."`
	NotificationsEndpointId string `yaml:"notifications_endpoint_id" json:"notifications_endpoint_id" usage:"The callback endpoint identifier for Apple Store subscription notifications."`
}

type IAPGoogleConfig struct {
	ClientEmail             string `yaml:"client_email" json:"client_email" usage:"Google Service Account client email."`
	PrivateKey              string `yaml:"private_key" json:"private_key" usage:"Google Service Account private key."`
	NotificationsEndpointId string `yaml:"notifications_endpoint_id" json:"notifications_endpoint_id" usage:"The callback endpoint identifier for Android subscription notifications."`
	RefundCheckPeriodMin    int    `yaml:"refund_check_period_min" json:"refund_check_period_min" usage:"Defines the polling interval in minutes of the Google IAP refund API."`
	PackageName             string `yaml:"package_name" json:"package_name" usage:"Google Play Store App Package Name."`
}

func (iapg *IAPGoogleConfig) Enabled() bool {
	if iapg.PrivateKey != "" && iapg.PackageName != "" {
		return true
	}
	return false
}

type SatoriConfig struct {
	Url        string `yaml:"url" json:"url" usage:"Satori URL."`
	ApiKeyName string `yaml:"api_key_name" json:"api_key_name" usage:"Satori Api key name."`
	ApiKey     string `yaml:"api_key" json:"api_key" usage:"Satori Api key."`
	SigningKey string `yaml:"signing_key" json:"signing_key" usage:"Key used to sign Satori session tokens."`
}

func NewSatoriConfig() *SatoriConfig {
	return &SatoriConfig{}
}

func (sc *SatoriConfig) Validate(logger *zap.Logger) {
	satoriUrl, err := url.Parse(sc.Url) // Empty string is a valid URL
	if err != nil {
		logger.Fatal("Satori URL is invalid", zap.String("satori_url", sc.Url), zap.Error(err))
	}

	if satoriUrl.String() != "" {
		if sc.ApiKeyName == "" {
			logger.Fatal("Satori configuration incomplete: api_key_name not set")
		}
		if sc.ApiKey == "" {
			logger.Fatal("Satori configuration incomplete: api_key not set")
		}
		if sc.SigningKey == "" {
			logger.Fatal("Satori configuration incomplete: signing_key not set")
		}
	} else if sc.ApiKeyName != "" || sc.ApiKey != "" || sc.SigningKey != "" {
		logger.Fatal("Satori configuration incomplete: url not set")
	}
}

type IAPHuaweiConfig struct {
	PublicKey    string `yaml:"public_key" json:"public_key" usage:"Huawei IAP store Base64 encoded Public Key."`
	ClientID     string `yaml:"client_id" json:"client_id" usage:"Huawei OAuth client secret."`
	ClientSecret string `yaml:"client_secret" json:"client_secret" usage:"Huawei OAuth app client secret."`
}

type IAPFacebookInstantConfig struct {
	AppSecret string `yaml:"app_secret" json:"app_secret" usage:"Facebook Instant OAuth app client secret."`
}

type GoogleAuthConfig struct {
	CredentialsJSON string         `yaml:"credentials_json" json:"credentials_json" usage:"Google's Access Credentials."`
	OAuthConfig     *oauth2.Config `yaml:"-" json:"-"`
}

func NewGoogleAuthConfig() *GoogleAuthConfig {
	return &GoogleAuthConfig{
		CredentialsJSON: "",
		OAuthConfig:     nil,
	}
}

type StorageConfig struct {
	DisableIndexOnly bool `yaml:"disable_index_only" json:"disable_index_only" usage:"Override and disable 'index_only' storage indices config and fallback to reading from the database."`
}

func NewStorageConfig() *StorageConfig {
	return &StorageConfig{}
}
