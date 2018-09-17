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
	"os"
	"path/filepath"
	"strings"

	"flag"
	"io/ioutil"

	"github.com/heroiclabs/nakama/flags"

	"crypto/tls"

	"github.com/go-yaml/yaml"
	"go.uber.org/zap"
)

// Config interface is the Nakama core configuration.
type Config interface {
	GetName() string
	GetDataDir() string
	GetLogger() *LoggerConfig
	GetMetrics() *MetricsConfig
	GetSession() *SessionConfig
	GetSocket() *SocketConfig
	GetDatabase() *DatabaseConfig
	GetSocial() *SocialConfig
	GetRuntime() *RuntimeConfig
	GetMatch() *MatchConfig
	GetConsole() *ConsoleConfig
	GetLeaderboard() *LeaderboardConfig
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
	if configFilePath.Config != "" {
		data, err := ioutil.ReadFile(configFilePath.Config)
		if err != nil {
			logger.Fatal("Could not read config file", zap.Error(err))
		} else {
			err = yaml.Unmarshal(data, mainConfig)
			if err != nil {
				logger.Fatal("Could not parse config file", zap.Error(err))
			} else {
				mainConfig.Config = configFilePath.Config
			}
		}
	}
	runtimeEnvironment := convertRuntimeEnv(logger, mainConfig.GetRuntime().Environment, mainConfig.GetRuntime().Env)

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

	// Fail fast on invalid values.
	if l := len(mainConfig.Name); l < 1 || l > 16 {
		logger.Fatal("Name must be 1-16 characters", zap.String("param", "name"))
	}
	if mainConfig.GetSocket().ServerKey == "" {
		logger.Fatal("Server key must be set", zap.String("param", "socket.server_key"))
	}
	if mainConfig.GetSession().EncryptionKey == "" {
		logger.Fatal("Encryption key must be set", zap.String("param", "session.encryption_key"))
	}
	if mainConfig.GetRuntime().HTTPKey == "" {
		logger.Fatal("Runtime HTTP key must be set", zap.String("param", "runtime.http_key"))
	}
	if mainConfig.GetConsole().Username == "" {
		logger.Fatal("Console username must be set", zap.String("param", "console.username"))
	}
	if mainConfig.GetConsole().Password == "" {
		logger.Fatal("Console password must be set", zap.String("param", "console.password"))
	}
	if p := mainConfig.GetSocket().Protocol; p != "tcp" && p != "tcp4" && p != "tcp6" {
		logger.Fatal("Socket protocol must be one of: tcp, tcp4, tcp6", zap.String("socket.protocol", mainConfig.GetSocket().Protocol))
	}
	if mainConfig.GetSocket().PingPeriodMs >= mainConfig.GetSocket().PongWaitMs {
		logger.Fatal("Ping period value must be less than pong wait value", zap.Int("socket.ping_period_ms", mainConfig.GetSocket().PingPeriodMs), zap.Int("socket.pong_wait_ms", mainConfig.GetSocket().PongWaitMs))
	}
	if mainConfig.GetRuntime().MinCount < 0 {
		logger.Fatal("Minimum runtime instance count must be >= 0", zap.Int("runtime.min_count", mainConfig.GetRuntime().MinCount))
	}
	if mainConfig.GetRuntime().MaxCount < 1 {
		logger.Fatal("Maximum runtime instance count must be >= 1", zap.Int("runtime.max_count", mainConfig.GetRuntime().MaxCount))
	}
	if mainConfig.GetRuntime().MinCount > mainConfig.GetRuntime().MaxCount {
		logger.Fatal("Minimum runtime instance count must be less than or equal to maximum runtime instance count", zap.Int("runtime.min_count", mainConfig.GetRuntime().MinCount), zap.Int("runtime.max_count", mainConfig.GetRuntime().MaxCount))
	}
	if mainConfig.GetRuntime().CallStackSize < 1 {
		logger.Fatal("Runtime instance call stack size must be >= 1", zap.Int("runtime.call_stack_size", mainConfig.GetRuntime().CallStackSize))
	}
	if mainConfig.GetRuntime().RegistrySize < 128 {
		logger.Fatal("Runtime instance registry size must be >= 128", zap.Int("runtime.registry_size", mainConfig.GetRuntime().RegistrySize))
	}
	if mainConfig.GetMatch().InputQueueSize < 1 {
		logger.Fatal("Match input queue size must be >= 1", zap.Int("match.input_queue_size", mainConfig.GetMatch().InputQueueSize))
	}
	if mainConfig.GetMatch().CallQueueSize < 1 {
		logger.Fatal("Match call queue size must be >= 1", zap.Int("match.call_queue_size", mainConfig.GetMatch().CallQueueSize))
	}

	// If the runtime path is not overridden, set it to `datadir/modules`.
	if mainConfig.GetRuntime().Path == "" {
		mainConfig.GetRuntime().Path = filepath.Join(mainConfig.GetDataDir(), "modules")
	}

	mainConfig.GetRuntime().Environment = convertRuntimeEnv(logger, runtimeEnvironment, mainConfig.GetRuntime().Env)

	// Log warnings for insecure default parameter values.
	if mainConfig.GetConsole().Username == "admin" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.username"))
	}
	if mainConfig.GetConsole().Password == "password" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "console.password"))
	}
	if mainConfig.GetSocket().ServerKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "socket.server_key"))
	}
	if mainConfig.GetSession().EncryptionKey == "defaultencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.encryption_key"))
	}
	if mainConfig.GetRuntime().HTTPKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "runtime.http_key"))
	}

	// Log warnings for SSL usage.
	if mainConfig.GetSocket().SSLCertificate != "" && mainConfig.GetSocket().SSLPrivateKey == "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_certificate"))
	}
	if mainConfig.GetSocket().SSLCertificate == "" && mainConfig.GetSocket().SSLPrivateKey != "" {
		logger.Fatal("SSL configuration invalid, specify both socket.ssl_certificate and socket.ssl_private_key", zap.String("param", "socket.ssl_private_key"))
	}
	if mainConfig.GetSocket().SSLCertificate != "" && mainConfig.GetSocket().SSLPrivateKey != "" {
		logger.Warn("WARNING: enabling direct SSL termination is not recommended, use an SSL-capable proxy or load balancer for production!")
		cert, err := tls.LoadX509KeyPair(mainConfig.GetSocket().SSLCertificate, mainConfig.GetSocket().SSLPrivateKey)
		if err != nil {
			logger.Fatal("Error loading SSL certificate", zap.Error(err))
		}
		logger.Info("SSL mode enabled")
		mainConfig.Socket.TLSCert = []tls.Certificate{cert}
	}

	return mainConfig
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
	Name        string             `yaml:"name" json:"name" usage:"Nakama server’s node name - must be unique."`
	Config      string             `yaml:"config" json:"config" usage:"The absolute file path to configuration YAML file."`
	Datadir     string             `yaml:"data_dir" json:"data_dir" usage:"An absolute path to a writeable folder where Nakama will store its data."`
	Logger      *LoggerConfig      `yaml:"logger" json:"logger" usage:"Logger levels and output."`
	Metrics     *MetricsConfig     `yaml:"metrics" json:"metrics" usage:"Metrics settings."`
	Session     *SessionConfig     `yaml:"session" json:"session" usage:"Session authentication settings."`
	Socket      *SocketConfig      `yaml:"socket" json:"socket" usage:"Socket configuration."`
	Database    *DatabaseConfig    `yaml:"database" json:"database" usage:"Database connection settings."`
	Social      *SocialConfig      `yaml:"social" json:"social" usage:"Properties for social provider integrations."`
	Runtime     *RuntimeConfig     `yaml:"runtime" json:"runtime" usage:"Script Runtime properties."`
	Match       *MatchConfig       `yaml:"match" json:"match" usage:"Authoritative realtime match properties."`
	Console     *ConsoleConfig     `yaml:"console" json:"console" usage:"Console settings."`
	Leaderboard *LeaderboardConfig `yaml:"leaderboard" json:"leaderboard" usage:"Leaderboard settings."`
}

// NewConfig constructs a Config struct which represents server settings, and populates it with default values.
func NewConfig(logger *zap.Logger) *config {
	cwd, err := os.Getwd()
	if err != nil {
		logger.Fatal("Error getting current working directory.", zap.Error(err))
	}
	return &config{
		Name:        "nakama",
		Datadir:     filepath.Join(cwd, "data"),
		Logger:      NewLoggerConfig(),
		Metrics:     NewMetricsConfig(),
		Session:     NewSessionConfig(),
		Socket:      NewSocketConfig(),
		Database:    NewDatabaseConfig(),
		Social:      NewSocialConfig(),
		Runtime:     NewRuntimeConfig(),
		Match:       NewMatchConfig(),
		Console:     NewConsoleConfig(),
		Leaderboard: NewLeaderboardConfig(),
	}
}

func (c *config) GetName() string {
	return c.Name
}

func (c *config) GetDataDir() string {
	return c.Datadir
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

func (c *config) GetConsole() *ConsoleConfig {
	return c.Console
}

func (c *config) GetLeaderboard() *LeaderboardConfig {
	return c.Leaderboard
}

// LoggerConfig is configuration relevant to logging levels and output.
type LoggerConfig struct {
	Level  string `yaml:"level" json:"level" usage:"Log level to set. Valid values are 'debug', 'info', 'warn', 'error'. "`
	Stdout bool   `yaml:"stdout" json:"stdout" usage:"Log to standard console output (as well as to a file if set)."`
	File   string `yaml:"file" json:"file" usage:"Log output to a file (as well as stdout if set). Make sure that the directory and the file is writable."`
}

// NewLogConfig creates a new LoggerConfig struct.
func NewLoggerConfig() *LoggerConfig {
	return &LoggerConfig{
		Level:  "info",
		Stdout: true,
		File:   "",
	}
}

// MetricsConfig is configuration relevant to metrics capturing and output.
type MetricsConfig struct {
	ReportingFreqSec     int    `yaml:"reporting_freq_sec" json:"reporting_freq_sec" usage:"Frequency of metrics exports. Default is 10 seconds."`
	StackdriverProjectID string `yaml:"stackdriver_projectid" json:"stackdriver_projectid" usage:"This is the identifier of the Stackdriver project the server is uploading the stats data to. Setting this enables metrics to be exported to Stackdriver."`
	Namespace            string `yaml:"namespace" json:"namespace" usage:"Namespace for Prometheus or prefix for Stackdriver metrics. It will always prepend node name."`
	PrometheusPort       int    `yaml:"prometheus_port" json:"prometheus_port" usage:"Port to expose Prometheus. If '0' Prometheus exports are disabled."`
}

// NewMetricsConfig creates a new MatricsConfig struct.
func NewMetricsConfig() *MetricsConfig {
	return &MetricsConfig{
		ReportingFreqSec:     10,
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
	MaxMessageSizeBytes  int64             `yaml:"max_message_size_bytes" json:"max_message_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from the client socket per message. Used for real-time, gRPC and HTTP connections."`
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
	TLSCert              []tls.Certificate // Created by processing SSLCertificate and SSLPrivateKey, not set from input args directly.
}

// NewTransportConfig creates a new TransportConfig struct.
func NewSocketConfig() *SocketConfig {
	return &SocketConfig{
		ServerKey:            "defaultkey",
		Port:                 7350,
		Address:              "",
		Protocol:             "tcp",
		MaxMessageSizeBytes:  4096,
		ReadTimeoutMs:        10 * 1000,
		WriteTimeoutMs:       10 * 1000,
		IdleTimeoutMs:        60 * 1000,
		WriteWaitMs:          5000,
		PongWaitMs:           10000,
		PingPeriodMs:         8000,
		PingBackoffThreshold: 20,
		OutgoingQueueSize:    64,
		SSLCertificate:       "",
		SSLPrivateKey:        "",
	}
}

// DatabaseConfig is configuration relevant to the Database storage.
type DatabaseConfig struct {
	Addresses         []string `yaml:"address" json:"address" usage:"List of CockroachDB servers (username:password@address:port/dbname)."`
	ConnMaxLifetimeMs int      `yaml:"conn_max_lifetime_ms" json:"conn_max_lifetime_ms" usage:"Time in milliseconds to reuse a database connection before the connection is killed and a new one is created."`
	MaxOpenConns      int      `yaml:"max_open_conns" json:"max_open_conns" usage:"Maximum number of allowed open connections to the database."`
	MaxIdleConns      int      `yaml:"max_idle_conns" json:"max_idle_conns" usage:"Maximum number of allowed open but unused connections to the database."`
}

// NewDatabaseConfig creates a new DatabaseConfig struct.
func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Addresses:         []string{"root@127.0.0.1:26257"},
		ConnMaxLifetimeMs: 0,
		MaxOpenConns:      0,
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
	Environment   map[string]string
	Env           []string `yaml:"env" json:"env"`
	Path          string   `yaml:"path" json:"path" usage:"Path for the server to scan for *.lua files."`
	HTTPKey       string   `yaml:"http_key" json:"http_key" usage:"Runtime HTTP Invocation key."`
	MinCount      int      `yaml:"min_count" json:"min_count" usage:"Minimum number of runtime instances to allocate. Default 16."`
	MaxCount      int      `yaml:"max_count" json:"max_count" usage:"Maximum number of runtime instances to allocate. Default 256."`
	CallStackSize int      `yaml:"call_stack_size" json:"call_stack_size" usage:"Size of each runtime instance's call stack. Default 128."`
	RegistrySize  int      `yaml:"registry_size" json:"registry_size" usage:"Size of each runtime instance's registry. Default 512."`
}

// NewRuntimeConfig creates a new RuntimeConfig struct.
func NewRuntimeConfig() *RuntimeConfig {
	return &RuntimeConfig{
		Environment:   make(map[string]string, 0),
		Env:           make([]string, 0),
		Path:          "",
		HTTPKey:       "defaultkey",
		MinCount:      16,
		MaxCount:      256,
		CallStackSize: 128,
		RegistrySize:  512,
	}
}

// MatchConfig is configuration relevant to authoritative realtime multiplayer matches.
type MatchConfig struct {
	InputQueueSize int `yaml:"input_queue_size" json:"input_queue_size" usage:"Size of the authoritative match buffer that stores client messages until they can be processed by the next tick. Default 128."`
	CallQueueSize  int `yaml:"call_queue_size" json:"call_queue_size" usage:"Size of the authoritative match buffer that sequences calls to match handler callbacks to ensure no overlaps. Default 128."`
}

// NewMatchConfig creates a new MatchConfig struct.
func NewMatchConfig() *MatchConfig {
	return &MatchConfig{
		InputQueueSize: 128,
		CallQueueSize:  128,
	}
}

// ConsoleConfig is configuration relevant to the embedded console.
type ConsoleConfig struct {
	Port     int    `yaml:"port" json:"port" usage:"The port for accepting connections for the embedded console, listening on all interfaces."`
	Username string `yaml:"username" json:"username" usage:"Username for the embedded console. Default username is 'admin'."`
	Password string `yaml:"password" json:"password" usage:"Password for the embedded console. Default password is 'password'."`
}

// NewConsoleConfig creates a new ConsoleConfig struct.
func NewConsoleConfig() *ConsoleConfig {
	return &ConsoleConfig{
		Port:     7351,
		Username: "admin",
		Password: "password",
	}
}

// LeaderboardConfig is configuration relevant to the leaderboard system.
type LeaderboardConfig struct {
	BlacklistRankCache []string `yaml:"blacklist_rank_cache" json:"blacklist_rank_cache" usage:"Disable rank cache for leaderboards with matching identifiers. To disable rank cache entirely, use '*', otherwise leave blank to enable rank cache."`
}

// NewLeaderboardConfig creates a new LeaderboardConfig struct.
func NewLeaderboardConfig() *LeaderboardConfig {
	return &LeaderboardConfig{
		BlacklistRankCache: []string{""},
	}
}
