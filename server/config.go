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
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"flag"
	"io/ioutil"

	"github.com/heroiclabs/nakama/v2/flags"

	"crypto/tls"

	"go.uber.org/zap"
	"gopkg.in/yaml.v2"
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
	var runtimeEnvironmentList []string
	for _, cfg := range configFilePath.Config {
		data, err := ioutil.ReadFile(cfg)
		if err != nil {
			logger.Fatal("Could not read config file", zap.String("path", cfg), zap.Error(err))
		}

		err = yaml.Unmarshal(data, mainConfig)
		if err != nil {
			logger.Fatal("Could not parse config file", zap.String("path", cfg), zap.Error(err))
		}

		// Convert and preserve the runtime environment key-value pairs.
		runtimeEnvironment = convertRuntimeEnv(logger, runtimeEnvironment, mainConfig.GetRuntime().Env)
		runtimeEnvironmentList = append(runtimeEnvironmentList, mainConfig.GetRuntime().Env...)
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
	mainConfig.GetRuntime().Env = append(runtimeEnvironmentList, mainConfig.GetRuntime().Env...)

	return mainConfig
}

func CheckConfig(logger *zap.Logger, config Config) map[string]string {
	// Fail fast on invalid values.
	if l := len(config.GetName()); l < 1 || l > 16 {
		logger.Fatal("Name must be 1-16 characters", zap.String("param", "name"))
	}
	if config.GetShutdownGraceSec() < 0 {
		logger.Fatal("Shutdown grace period must be >= 0", zap.Int("shutdown_grace_sec", config.GetShutdownGraceSec()))
	}
	if config.GetSocket().ServerKey == "" {
		logger.Fatal("Server key must be set", zap.String("param", "socket.server_key"))
	}
	if config.GetSession().EncryptionKey == "" {
		logger.Fatal("Encryption key must be set", zap.String("param", "session.encryption_key"))
	}
	if config.GetRuntime().HTTPKey == "" {
		logger.Fatal("Runtime HTTP key must be set", zap.String("param", "runtime.http_key"))
	}
	if config.GetConsole().MaxMessageSizeBytes < 1 {
		logger.Fatal("Console max message size bytes must be >= 1", zap.Int64("console.max_message_size_bytes", config.GetConsole().MaxMessageSizeBytes))
	}
	if config.GetConsole().ReadTimeoutMs < 1 {
		logger.Fatal("Console read timeout milliseconds must be >= 1", zap.Int("console.read_timeout_ms", config.GetConsole().ReadTimeoutMs))
	}
	if config.GetConsole().WriteTimeoutMs < 1 {
		logger.Fatal("Console write timeout milliseconds must be >= 1", zap.Int("console.write_timeout_ms", config.GetConsole().WriteTimeoutMs))
	}
	if config.GetConsole().IdleTimeoutMs < 1 {
		logger.Fatal("Console idle timeout milliseconds must be >= 1", zap.Int("console.idle_timeout_ms", config.GetConsole().IdleTimeoutMs))
	}
	if config.GetConsole().Username == "" {
		logger.Fatal("Console username must be set", zap.String("param", "console.username"))
	}
	if config.GetConsole().Password == "" {
		logger.Fatal("Console password must be set", zap.String("param", "console.password"))
	}
	if config.GetConsole().SigningKey == "" {
		logger.Fatal("Console signing key must be set", zap.String("param", "console.signing_key"))
	}
	if p := config.GetSocket().Protocol; p != "tcp" && p != "tcp4" && p != "tcp6" {
		logger.Fatal("Socket protocol must be one of: tcp, tcp4, tcp6", zap.String("socket.protocol", config.GetSocket().Protocol))
	}
	if config.GetSocket().MaxMessageSizeBytes < 1 {
		logger.Fatal("Socket max message size bytes must be >= 1", zap.Int64("socket.max_message_size_bytes", config.GetSocket().MaxMessageSizeBytes))
	}
	if config.GetSocket().ReadTimeoutMs < 1 {
		logger.Fatal("Socket read timeout milliseconds must be >= 1", zap.Int("socket.read_timeout_ms", config.GetSocket().ReadTimeoutMs))
	}
	if config.GetSocket().WriteTimeoutMs < 1 {
		logger.Fatal("Socket write timeout milliseconds must be >= 1", zap.Int("socket.write_timeout_ms", config.GetSocket().WriteTimeoutMs))
	}
	if config.GetSocket().IdleTimeoutMs < 1 {
		logger.Fatal("Socket idle timeout milliseconds must be >= 1", zap.Int("socket.idle_timeout_ms", config.GetSocket().IdleTimeoutMs))
	}
	if config.GetSocket().PingPeriodMs >= config.GetSocket().PongWaitMs {
		logger.Fatal("Ping period value must be less than pong wait value", zap.Int("socket.ping_period_ms", config.GetSocket().PingPeriodMs), zap.Int("socket.pong_wait_ms", config.GetSocket().PongWaitMs))
	}
	if len(config.GetDatabase().Addresses) < 1 {
		logger.Fatal("At least one database address must be specified", zap.Strings("database.address", config.GetDatabase().Addresses))
	}
	for _, address := range config.GetDatabase().Addresses {
		rawURL := fmt.Sprintf("postgresql://%s", address)
		if _, err := url.Parse(rawURL); err != nil {
			logger.Fatal("Bad database connection URL", zap.String("database.address", address), zap.Error(err))
		}
	}
	if config.GetRuntime().MinCount < 0 {
		logger.Fatal("Minimum runtime instance count must be >= 0", zap.Int("runtime.min_count", config.GetRuntime().MinCount))
	}
	if config.GetRuntime().MaxCount < 1 {
		logger.Fatal("Maximum runtime instance count must be >= 1", zap.Int("runtime.max_count", config.GetRuntime().MaxCount))
	}
	if config.GetRuntime().MinCount > config.GetRuntime().MaxCount {
		logger.Fatal("Minimum runtime instance count must be less than or equal to maximum runtime instance count", zap.Int("runtime.min_count", config.GetRuntime().MinCount), zap.Int("runtime.max_count", config.GetRuntime().MaxCount))
	}
	if config.GetRuntime().CallStackSize < 1 {
		logger.Fatal("Runtime instance call stack size must be >= 1", zap.Int("runtime.call_stack_size", config.GetRuntime().CallStackSize))
	}
	if config.GetRuntime().EventQueueSize < 1 {
		logger.Fatal("Runtime event queue stack size must be >= 1", zap.Int("runtime.event_queue_size", config.GetRuntime().EventQueueSize))
	}
	if config.GetRuntime().EventQueueWorkers < 1 {
		logger.Fatal("Runtime event queue workers must be >= 1", zap.Int("runtime.event_queue_workers", config.GetRuntime().EventQueueWorkers))
	}
	if config.GetRuntime().RegistrySize < 128 {
		logger.Fatal("Runtime instance registry size must be >= 128", zap.Int("runtime.registry_size", config.GetRuntime().RegistrySize))
	}
	if config.GetMatch().InputQueueSize < 1 {
		logger.Fatal("Match input queue size must be >= 1", zap.Int("match.input_queue_size", config.GetMatch().InputQueueSize))
	}
	if config.GetMatch().CallQueueSize < 1 {
		logger.Fatal("Match call queue size must be >= 1", zap.Int("match.call_queue_size", config.GetMatch().CallQueueSize))
	}
	if config.GetMatch().JoinAttemptQueueSize < 1 {
		logger.Fatal("Match join attempt queue size must be >= 1", zap.Int("match.join_attempt_queue_size", config.GetMatch().JoinAttemptQueueSize))
	}
	if config.GetMatch().DeferredQueueSize < 1 {
		logger.Fatal("Match deferred queue size must be >= 1", zap.Int("match.deferred_queue_size", config.GetMatch().DeferredQueueSize))
	}
	if config.GetMatch().JoinMarkerDeadlineMs < 1 {
		logger.Fatal("Match join marker deadline must be >= 1", zap.Int("match.join_marker_deadline_ms", config.GetMatch().JoinMarkerDeadlineMs))
	}
	if config.GetTracker().EventQueueSize < 1 {
		logger.Fatal("Tracker presence event queue size must be >= 1", zap.Int("tracker.event_queue_size", config.GetTracker().EventQueueSize))
	}
	if config.GetLeaderboard().CallbackQueueSize < 1 {
		logger.Fatal("Leaderboard callback queue stack size must be >= 1", zap.Int("leaderboard.callback_queue_size", config.GetLeaderboard().CallbackQueueSize))
	}
	if config.GetLeaderboard().CallbackQueueWorkers < 1 {
		logger.Fatal("Leaderboard callback queue workers must be >= 1", zap.Int("leaderboard.callback_queue_workers", config.GetLeaderboard().CallbackQueueWorkers))
	}

	// If the runtime path is not overridden, set it to `datadir/modules`.
	if config.GetRuntime().Path == "" {
		config.GetRuntime().Path = filepath.Join(config.GetDataDir(), "modules")
	}

	configWarnings := make(map[string]string, 8)

	// Log warnings for insecure default parameter values.
	if config.GetConsole().Username == "admin" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.username"))
		configWarnings["console.username"] = "Insecure default parameter value, change this for production!"
	}
	if config.GetConsole().Password == "password" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.password"))
		configWarnings["console.password"] = "Insecure default parameter value, change this for production!"
	}
	if config.GetConsole().SigningKey == "defaultsigningkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.signing_key"))
		configWarnings["console.signing_key"] = "Insecure default parameter value, change this for production!"
	}
	if config.GetSocket().ServerKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "socket.server_key"))
		configWarnings["socket.server_key"] = "Insecure default parameter value, change this for production!"
	}
	if config.GetSession().EncryptionKey == "defaultencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.encryption_key"))
		configWarnings["session.encryption_key"] = "Insecure default parameter value, change this for production!"
	}
	if config.GetRuntime().HTTPKey == "defaulthttpkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "runtime.http_key"))
		configWarnings["runtime.http_key"] = "Insecure default parameter value, change this for production!"
	}

	// Log warnings for SSL usage.
	if config.GetSocket().SSLCertificate != "" && config.GetSocket().SSLPrivateKey == "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_certificate"))
	}
	if config.GetSocket().SSLCertificate == "" && config.GetSocket().SSLPrivateKey != "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_private_key"))
	}
	if config.GetSocket().SSLCertificate != "" && config.GetSocket().SSLPrivateKey != "" {
		logger.Warn("WARNING: enabling direct SSL termination is not recommended, use an SSL-capable proxy or load balancer for production!")
		certPEMBlock, err := ioutil.ReadFile(config.GetSocket().SSLCertificate)
		if err != nil {
			logger.Fatal("Error loading SSL certificate cert file", zap.Error(err))
		}
		keyPEMBlock, err := ioutil.ReadFile(config.GetSocket().SSLPrivateKey)
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
		config.GetSocket().CertPEMBlock = certPEMBlock
		config.GetSocket().KeyPEMBlock = keyPEMBlock
		config.GetSocket().TLSCert = []tls.Certificate{cert}
	}

	// Set backwards-compatible defaults if overrides are not used.
	if config.GetSocket().MaxRequestSizeBytes <= 0 {
		config.GetSocket().MaxRequestSizeBytes = config.GetSocket().MaxMessageSizeBytes
	}

	return configWarnings
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

// NewLoggerConfig creates a new LoggerConfig struct.
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
	ReportingFreqSec     int    `yaml:"reporting_freq_sec" json:"reporting_freq_sec" usage:"Frequency of metrics exports. Default is 60 seconds."`
	StackdriverProjectID string `yaml:"stackdriver_projectid" json:"stackdriver_projectid" usage:"This is the identifier of the Stackdriver project the server is uploading the stats data to. Setting this enables metrics to be exported to Stackdriver."`
	Namespace            string `yaml:"namespace" json:"namespace" usage:"Namespace for Prometheus or prefix for Stackdriver metrics. It will always prepend node name."`
	PrometheusPort       int    `yaml:"prometheus_port" json:"prometheus_port" usage:"Port to expose Prometheus. If '0' Prometheus exports are disabled."`
}

// NewMetricsConfig creates a new MatricsConfig struct.
func NewMetricsConfig() *MetricsConfig {
	return &MetricsConfig{
		ReportingFreqSec:     60,
		StackdriverProjectID: "",
		Namespace:            "",
		PrometheusPort:       0,
	}
}

// SessionConfig is configuration relevant to the session.
type SessionConfig struct {
	EncryptionKey  string `yaml:"encryption_key" json:"encryption_key" usage:"The encryption key used to produce the client token."`
	TokenExpirySec int64  `yaml:"token_expiry_sec" json:"token_expiry_sec" usage:"Token expiry in seconds."`
}

// NewSessionConfig creates a new SessionConfig struct.
func NewSessionConfig() *SessionConfig {
	return &SessionConfig{
		EncryptionKey:  "defaultencryptionkey",
		TokenExpirySec: 60,
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
	CertPEMBlock         []byte            `yaml:"-" json:"-"` // Created by fully reading the file contents of SSLCertificate, not set from input args directly.
	KeyPEMBlock          []byte            `yaml:"-" json:"-"` // Created by fully reading the file contents of SSLPrivateKey, not set from input args directly.
	TLSCert              []tls.Certificate `yaml:"-" json:"-"` // Created by processing CertPEMBlock and KeyPEMBlock, not set from input args directly.
}

// NewTransportConfig creates a new TransportConfig struct.
func NewSocketConfig() *SocketConfig {
	return &SocketConfig{
		ServerKey:            "defaultkey",
		Port:                 7350,
		Address:              "",
		Protocol:             "tcp",
		MaxMessageSizeBytes:  4096,
		MaxRequestSizeBytes:  0,
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
	Addresses         []string `yaml:"address" json:"address" usage:"List of database servers (username:password@address:port/dbname). Default 'root@localhost:26257'."`
	ConnMaxLifetimeMs int      `yaml:"conn_max_lifetime_ms" json:"conn_max_lifetime_ms" usage:"Time in milliseconds to reuse a database connection before the connection is killed and a new one is created. Default 3600000 (1 hour)."`
	MaxOpenConns      int      `yaml:"max_open_conns" json:"max_open_conns" usage:"Maximum number of allowed open connections to the database. Default 100."`
	MaxIdleConns      int      `yaml:"max_idle_conns" json:"max_idle_conns" usage:"Maximum number of allowed open but unused connections to the database. Default 100."`
}

// NewDatabaseConfig creates a new DatabaseConfig struct.
func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Addresses:         []string{"root@localhost:26257"},
		ConnMaxLifetimeMs: 3600000,
		MaxOpenConns:      100,
		MaxIdleConns:      100,
	}
}

// SocialConfig is configuration relevant to the social authentication providers.
type SocialConfig struct {
	Steam *SocialConfigSteam `yaml:"steam" json:"steam" usage:"Steam configuration."`
}

// SocialConfigSteam is configuration relevant to Steam
type SocialConfigSteam struct {
	PublisherKey string `yaml:"publisher_key" json:"publisher_key" usage:"Steam Publisher Key value."`
	AppID        int    `yaml:"app_id" json:"app_id" usage:"Steam App ID."`
}

// NewSocialConfig creates a new SocialConfig struct.
func NewSocialConfig() *SocialConfig {
	return &SocialConfig{
		Steam: &SocialConfigSteam{
			PublisherKey: "",
			AppID:        0,
		},
	}
}

// RuntimeConfig is configuration relevant to the Runtime Lua VM.
type RuntimeConfig struct {
	Environment       map[string]string `yaml:"-" json:"-"`
	Env               []string          `yaml:"env" json:"env" usage:"Values to pass into Runtime as environment variables."`
	Path              string            `yaml:"path" json:"path" usage:"Path for the server to scan for Lua and Go library files."`
	HTTPKey           string            `yaml:"http_key" json:"http_key" usage:"Runtime HTTP Invocation key."`
	MinCount          int               `yaml:"min_count" json:"min_count" usage:"Minimum number of runtime instances to allocate. Default 16."`
	MaxCount          int               `yaml:"max_count" json:"max_count" usage:"Maximum number of runtime instances to allocate. Default 256."`
	CallStackSize     int               `yaml:"call_stack_size" json:"call_stack_size" usage:"Size of each runtime instance's call stack. Default 128."`
	RegistrySize      int               `yaml:"registry_size" json:"registry_size" usage:"Size of each runtime instance's registry. Default 512."`
	EventQueueSize    int               `yaml:"event_queue_size" json:"event_queue_size" usage:"Size of the event queue buffer. Default 65536."`
	EventQueueWorkers int               `yaml:"event_queue_workers" json:"event_queue_workers" usage:"Number of workers to use for concurrent processing of events. Default 8."`
}

// NewRuntimeConfig creates a new RuntimeConfig struct.
func NewRuntimeConfig() *RuntimeConfig {
	return &RuntimeConfig{
		Environment:       make(map[string]string, 0),
		Env:               make([]string, 0),
		Path:              "",
		HTTPKey:           "defaulthttpkey",
		MinCount:          16,
		MaxCount:          256,
		CallStackSize:     128,
		RegistrySize:      512,
		EventQueueSize:    65536,
		EventQueueWorkers: 8,
	}
}

// MatchConfig is configuration relevant to authoritative realtime multiplayer matches.
type MatchConfig struct {
	InputQueueSize       int `yaml:"input_queue_size" json:"input_queue_size" usage:"Size of the authoritative match buffer that stores client messages until they can be processed by the next tick. Default 128."`
	CallQueueSize        int `yaml:"call_queue_size" json:"call_queue_size" usage:"Size of the authoritative match buffer that sequences calls to match handler callbacks to ensure no overlaps. Default 128."`
	JoinAttemptQueueSize int `yaml:"join_attempt_queue_size" json:"join_attempt_queue_size" usage:"Size of the authoritative match buffer that limits the number of in-progress join attempts. Default 128."`
	DeferredQueueSize    int `yaml:"deferred_queue_size" json:"deferred_queue_size" usage:"Size of the authoritative match buffer that holds deferred message broadcasts until the end of each loop execution. Default 128."`
	JoinMarkerDeadlineMs int `yaml:"join_marker_deadline_ms" json:"join_marker_deadline_ms" usage:"Deadline in milliseconds that client authoritative match joins will wait for match handlers to acknowledge joins. Default 15000."`
}

// NewMatchConfig creates a new MatchConfig struct.
func NewMatchConfig() *MatchConfig {
	return &MatchConfig{
		InputQueueSize:       128,
		CallQueueSize:        128,
		JoinAttemptQueueSize: 128,
		DeferredQueueSize:    128,
		JoinMarkerDeadlineMs: 15000,
	}
}

// TrackerConfig is configuration relevant to the presence tracker.
type TrackerConfig struct {
	EventQueueSize int `yaml:"event_queue_size" json:"event_queue_size" usage:"Size of the tracker presence event buffer. Increase if the server is expected to generate a large number of presence events in a short time. Default 1024."`
}

// NewTrackerConfig creates a new TrackerConfig struct.
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

// NewConsoleConfig creates a new ConsoleConfig struct.
func NewConsoleConfig() *ConsoleConfig {
	return &ConsoleConfig{
		Port:                7351,
		MaxMessageSizeBytes: 4096,
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
}

// NewLeaderboardConfig creates a new LeaderboardConfig struct.
func NewLeaderboardConfig() *LeaderboardConfig {
	return &LeaderboardConfig{
		BlacklistRankCache:   []string{},
		CallbackQueueSize:    65536,
		CallbackQueueWorkers: 8,
	}
}
