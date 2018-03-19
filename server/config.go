// Copyright 2017 The Nakama Authors
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
	"nakama/pkg/flags"

	"net"

	"github.com/go-yaml/yaml"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

// Config interface is the Nakama Core configuration
type Config interface {
	GetName() string
	GetDataDir() string
	GetDashboard() *DashboardConfig
	GetLog() *LogConfig
	GetSession() *SessionConfig
	GetSocket() *SocketConfig
	GetDatabase() *DatabaseConfig
	GetSocial() *SocialConfig
	GetRuntime() *RuntimeConfig
	GetPurchase() *PurchaseConfig
}

func ParseArgs(logger *zap.Logger, args []string) Config {
	// parse args to get path to a config file if passed in
	configFilePath := NewConfig()
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

	// parse config file if path is set
	mainConfig := NewConfig()
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

	// override config with those passed from command-line
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

	// if the runtime path is not overridden, set it to `datadir/modules`
	if mainConfig.GetRuntime().Path == "" {
		mainConfig.GetRuntime().Path = filepath.Join(mainConfig.GetDataDir(), "modules")
	}

	// Enforce rules for parameters with strict requirements.
	if len(mainConfig.GetSession().UdpKey) != 32 {
		logger.Fatal("session.udp_key must be exactly 32 characters")
	}
	if net.ParseIP(mainConfig.GetSocket().ListenAddress) == nil {
		logger.Fatal("socket.listen_address must be a valid IP address")
	}
	if net.ParseIP(mainConfig.GetSocket().PublicAddress) == nil {
		logger.Fatal("socket.public_address must be a valid IP address")
	}

	// Log warnings for insecure default parameter values.
	if mainConfig.GetSocket().ServerKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "socket.server_key"))
	}
	if mainConfig.GetSession().EncryptionKey == "defaultencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.encryption_key"))
	}
	if mainConfig.GetSession().UdpKey == "1234567890abcdef1234567890abcdef" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.udp_key"))
	}
	if mainConfig.GetRuntime().HTTPKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "runtime.http_key"))
	}

	return mainConfig
}

type config struct {
	Name      string           `yaml:"name" json:"name" usage:"Nakama server’s node name - must be unique"`
	Config    string           `yaml:"config" json:"config" usage:"The absolute file path to configuration YAML file."`
	Datadir   string           `yaml:"data_dir" json:"data_dir" usage:"An absolute path to a writeable folder where Nakama will store its data."`
	Dashboard *DashboardConfig `yaml:"dashboard" json:"dashboard" usage:"Dashboard configuration"`
	Log       *LogConfig       `yaml:"log" json:"log" usage:"Log levels and output"`
	Session   *SessionConfig   `yaml:"session" json:"session" usage:"Session authentication settings"`
	Socket    *SocketConfig    `yaml:"socket" json:"socket" usage:"Socket configurations"`
	Database  *DatabaseConfig  `yaml:"database" json:"database" usage:"Database connection settings"`
	Social    *SocialConfig    `yaml:"social" json:"social" usage:"Properties for social providers"`
	Runtime   *RuntimeConfig   `yaml:"runtime" json:"runtime" usage:"Script Runtime properties"`
	Purchase  *PurchaseConfig  `yaml:"purchase" json:"purchase" usage:"In-App Purchase provider configuration"`
}

// NewConfig constructs a Config struct which represents server settings.
func NewConfig() *config {
	cwd, _ := os.Getwd()
	dataDirectory := filepath.Join(cwd, "data")
	nodeName := "nakama-" + strings.Split(uuid.NewV4().String(), "-")[3]
	return &config{
		Name:      nodeName,
		Datadir:   dataDirectory,
		Dashboard: NewDashboardConfig(),
		Log:       NewLogConfig(),
		Session:   NewSessionConfig(),
		Socket:    NewSocketConfig(),
		Database:  NewDatabaseConfig(),
		Social:    NewSocialConfig(),
		Runtime:   NewRuntimeConfig(),
		Purchase:  NewPurchaseConfig(),
	}
}

func (c *config) GetName() string {
	return c.Name
}

func (c *config) GetDataDir() string {
	return c.Datadir
}

func (c *config) GetDashboard() *DashboardConfig {
	return c.Dashboard
}

func (c *config) GetLog() *LogConfig {
	return c.Log
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

func (c *config) GetPurchase() *PurchaseConfig {
	return c.Purchase
}

// DashboardConfig is configuration relevant to the dashboard
type DashboardConfig struct {
	Port int `yaml:"port" json:"port" usage:"The port for accepting connections to the dashboard, listening on all interfaces."`
}

// NewSessionConfig creates a new SessionConfig struct
func NewDashboardConfig() *DashboardConfig {
	return &DashboardConfig{
		Port: 7351,
	}
}

// LogConfig is configuration relevant to logging levels and output
type LogConfig struct {
	// By default, log all messages with Warn and Error messages to a log file inside Data/Log/<name>.log file. The content will be in JSON.
	// if --log.verbose is passed, log messages with Debug and higher levels.
	// if --log.stdout is passed, logs are only printed to stdout.
	// In all cases, Error messages trigger the stacktrace to be dumped as well.

	Verbose bool `yaml:"verbose" json:"verbose" usage:"Turn verbose logging on"`
	Stdout  bool `yaml:"stdout" json:"stdout" usage:"Log to stdout instead of file"`
}

// NewLogConfig creates a new LogConfig struct
func NewLogConfig() *LogConfig {
	return &LogConfig{
		Verbose: false,
		Stdout:  false,
	}
}

// SessionConfig is configuration relevant to the session
type SessionConfig struct {
	EncryptionKey string `yaml:"encryption_key" json:"encryption_key" usage:"The encryption key used to produce the client token."`
	UdpKey        string `yaml:"udp_key" json:"udp_key" usage:"The UDP key used to produce the raw UDP connection token."`
	TokenExpiryMs int64  `yaml:"token_expiry_ms" json:"token_expiry_ms" usage:"Token expiry in milliseconds."`
}

// NewSessionConfig creates a new SessionConfig struct
func NewSessionConfig() *SessionConfig {
	return &SessionConfig{
		EncryptionKey: "defaultencryptionkey",
		UdpKey:        "1234567890abcdef1234567890abcdef",
		TokenExpiryMs: 60000,
	}
}

// SocketConfig is configuration relevant to the transport socket and protocol
type SocketConfig struct {
	ServerKey           string `yaml:"server_key" json:"server_key" usage:"Server key to use to establish a connection to the server."`
	ListenAddress       string `yaml:"listen_address" json:"listen_address" usage:"IP address to listen for traffic on."`
	PublicAddress       string `yaml:"public_address" json:"public_address" usage:"IP address to advertise to clients."`
	Port                int    `yaml:"port" json:"port" usage:"The port for accepting connections from the client, listening on all interfaces."`
	MaxMessageSizeBytes int64  `yaml:"max_message_size_bytes" json:"max_message_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from the client socket per message."`
	WriteWaitMs         int    `yaml:"write_wait_ms" json:"write_wait_ms" usage:"Time in milliseconds to wait for an ack from the client when writing data."`
	PongWaitMs          int    `yaml:"pong_wait_ms" json:"pong_wait_ms" usage:"Time in milliseconds to wait for a pong message from the client after sending a ping."`
	PingPeriodMs        int    `yaml:"ping_period_ms" json:"ping_period_ms" usage:"Time in milliseconds to wait between client ping messages. This value must be less than the pong_wait_ms."`
	SSLCertificate      string `yaml:"ssl_certificate" json:"ssl_certificate" usage:"Path to certificate file if you want the server to use SSL directly. Must also supply ssl_private_key"`
	SSLPrivateKey       string `yaml:"ssl_private_key" json:"ssl_private_key" usage:"Path to private key file if you want the server to use SSL directly. Must also supply ssl_certificate"`
}

// NewTransportConfig creates a new TransportConfig struct
func NewSocketConfig() *SocketConfig {
	return &SocketConfig{
		ServerKey:           "defaultkey",
		ListenAddress:       "0.0.0.0",
		PublicAddress:       "127.0.0.1",
		Port:                7350,
		MaxMessageSizeBytes: 1024,
		WriteWaitMs:         5000,
		PongWaitMs:          10000,
		PingPeriodMs:        8000,
		SSLCertificate:      "",
		SSLPrivateKey:       "",
	}
}

// DatabaseConfig is configuration relevant to the Database storage
type DatabaseConfig struct {
	Addresses         []string `yaml:"address" json:"address" usage:"List of CockroachDB servers (username:password@address:port/dbname)"`
	ConnMaxLifetimeMs int      `yaml:"conn_max_lifetime_ms" json:"conn_max_lifetime_ms" usage:"Time in milliseconds to reuse a database connection before the connection is killed and a new one is created."`
	MaxOpenConns      int      `yaml:"max_open_conns" json:"max_open_conns" usage:"Maximum number of allowed open connections to the database."`
	MaxIdleConns      int      `yaml:"max_idle_conns" json:"max_idle_conns" usage:"Maximum number of allowed open but unused connections to the database."`
}

// NewDatabaseConfig creates a new DatabaseConfig struct
func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Addresses:         []string{"root@localhost:26257"},
		ConnMaxLifetimeMs: 60000,
		MaxOpenConns:      0,
		MaxIdleConns:      0,
	}
}

// SocialConfig is configuration relevant to the Social providers
type SocialConfig struct {
	Notification *NotificationConfig `yaml:"notification" json:"notification" usage:"Notification configuration"`
	Steam        *SocialConfigSteam  `yaml:"steam" json:"steam" usage:"Steam configuration"`
}

// SocialConfigSteam is configuration relevant to Steam
type SocialConfigSteam struct {
	PublisherKey string `yaml:"publisher_key" json:"publisher_key" usage:"Steam Publisher Key value."`
	AppID        int    `yaml:"app_id" json:"app_id" usage:"Steam App ID."`
}

// NotificationConfig is configuration relevant to notification center
type NotificationConfig struct {
	ExpiryMs int64 `yaml:"expiry_ms" json:"expiry_ms" usage:"Notification expiry in milliseconds."`
}

// NewSocialConfig creates a new SocialConfig struct
func NewSocialConfig() *SocialConfig {
	return &SocialConfig{
		Steam: &SocialConfigSteam{
			PublisherKey: "",
			AppID:        0,
		},
		Notification: &NotificationConfig{
			ExpiryMs: 86400000, // one day expiry
		},
	}
}

// RuntimeConfig is configuration relevant to the Runtime Lua VM
type RuntimeConfig struct {
	Environment map[string]interface{} `yaml:"env" json:"env"` // not supported in FlagOverrides
	Path        string                 `yaml:"path" json:"path" usage:"Path of modules for the server to scan."`
	HTTPKey     string                 `yaml:"http_key" json:"http_key" usage:"Runtime HTTP Invocation key"`
}

// NewRuntimeConfig creates a new RuntimeConfig struct
func NewRuntimeConfig() *RuntimeConfig {
	return &RuntimeConfig{
		Environment: make(map[string]interface{}),
		Path:        "",
		HTTPKey:     "defaultkey",
	}
}

// PurchaseConfig is configuration relevant to the In-App Purchase providers.
type PurchaseConfig struct {
	Apple  *ApplePurchaseProviderConfig  `yaml:"apple" json:"apple" usage:"Apple In-App Purchase configuration"`
	Google *GooglePurchaseProviderConfig `yaml:"google" json:"google" usage:"Google In-App Purchase configuration"`
}

// NewPurchaseConfig creates a new PurchaseConfig struct
func NewPurchaseConfig() *PurchaseConfig {
	return &PurchaseConfig{
		Apple:  &ApplePurchaseProviderConfig{TimeoutMs: 1500},
		Google: &GooglePurchaseProviderConfig{TimeoutMs: 1500},
	}
}

type ApplePurchaseProviderConfig struct {
	Password   string `yaml:"password" json:"password" usage:"In-App Purchase password"`
	Production bool   `yaml:"production" json:"production" usage:"If set, the server will try Production environment then sandbox."`
	TimeoutMs  int    `yaml:"timeout_ms" json:"timeout_ms" usage:"Apple connection timeout in milliseconds"`
}

type GooglePurchaseProviderConfig struct {
	PackageName        string `yaml:"package" json:"package" usage:"Android package name"`
	ServiceKeyFilePath string `yaml:"service_key_file" json:"service_key_file" usage:"Absolute file path to the service key JSON file."`
	TimeoutMs          int    `yaml:"timeout_ms" json:"timeout_ms" usage:"Google connection timeout in milliseconds"`
}
