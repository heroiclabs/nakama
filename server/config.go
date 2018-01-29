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
	"github.com/heroiclabs/nakama/flags"
	"io/ioutil"

	"github.com/go-yaml/yaml"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

// Config interface is the Nakama core configuration.
type Config interface {
	GetName() string
	GetDataDir() string
	GetLog() *LogConfig
	GetSession() *SessionConfig
	GetSocket() *SocketConfig
	GetDatabase() *DatabaseConfig
	GetRuntime() *RuntimeConfig
}

func ParseArgs(logger *zap.Logger, args []string) Config {
	// Parse args to get path to a config file if passed in.
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

	// Parse config file if path is set.
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

	// If the runtime path is not overridden, set it to `datadir/modules`.
	if mainConfig.GetRuntime().Path == "" {
		mainConfig.GetRuntime().Path = filepath.Join(mainConfig.GetDataDir(), "modules")
	}

	// Log warnings for insecure default parameter values.
	if mainConfig.GetSocket().ServerKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "socket.server_key"))
	}
	if mainConfig.GetSession().EncryptionKey == "defaultencryptionkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "session.encryption_key"))
	}
	if mainConfig.GetRuntime().HTTPKey == "defaultkey" {
		logger.Warn("WARNING: insecure default parameter value, change this for production!", zap.String("param", "runtime.http_key"))
	}

	return mainConfig
}

type config struct {
	Name     string          `yaml:"name" json:"name" usage:"Nakama server’s node name - must be unique"`
	Config   string          `yaml:"config" json:"config" usage:"The absolute file path to configuration YAML file."`
	Datadir  string          `yaml:"data_dir" json:"data_dir" usage:"An absolute path to a writeable folder where Nakama will store its data."`
	Log      *LogConfig      `yaml:"log" json:"log" usage:"Log levels and output"`
	Session  *SessionConfig  `yaml:"session" json:"session" usage:"Session authentication settings"`
	Socket   *SocketConfig   `yaml:"socket" json:"socket" usage:"Socket configurations"`
	Database *DatabaseConfig `yaml:"database" json:"database" usage:"Database connection settings"`
	Runtime  *RuntimeConfig  `yaml:"runtime" json:"runtime" usage:"Script Runtime properties"`
}

// NewConfig constructs a Config struct which represents server settings, and populates it with default values.
func NewConfig() *config {
	cwd, _ := os.Getwd()
	dataDirectory := filepath.Join(cwd, "data")
	nodeName := "nakama-" + strings.Split(uuid.NewV4().String(), "-")[3]
	return &config{
		Name:     nodeName,
		Datadir:  dataDirectory,
		Log:      NewLogConfig(),
		Session:  NewSessionConfig(),
		Socket:   NewSocketConfig(),
		Database: NewDatabaseConfig(),
		Runtime:  NewRuntimeConfig(),
	}
}

func (c *config) GetName() string {
	return c.Name
}

func (c *config) GetDataDir() string {
	return c.Datadir
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

func (c *config) GetRuntime() *RuntimeConfig {
	return c.Runtime
}

// LogConfig is configuration relevant to logging levels and output.
type LogConfig struct {
	// By default, log all messages with Warn and Error messages to a log file inside Data/Log/<name>.log file. The content will be in JSON.
	// if --log.verbose is passed, log messages with Debug and higher levels.
	// if --log.stdout is passed, logs are only printed to stdout.
	// In all cases, Error messages trigger the stacktrace to be dumped as well.

	Verbose bool `yaml:"verbose" json:"verbose" usage:"Turn verbose logging on"`
	Stdout  bool `yaml:"stdout" json:"stdout" usage:"Log to stdout instead of file"`
}

// NewLogConfig creates a new LogConfig struct.
func NewLogConfig() *LogConfig {
	return &LogConfig{
		Verbose: false,
		Stdout:  false,
	}
}

// SessionConfig is configuration relevant to the session.
type SessionConfig struct {
	EncryptionKey string `yaml:"encryption_key" json:"encryption_key" usage:"The encryption key used to produce the client token."`
	TokenExpiryMs int64  `yaml:"token_expiry_ms" json:"token_expiry_ms" usage:"Token expiry in milliseconds."`
}

// NewSessionConfig creates a new SessionConfig struct.
func NewSessionConfig() *SessionConfig {
	return &SessionConfig{
		EncryptionKey: "defaultencryptionkey",
		TokenExpiryMs: 60000,
	}
}

// SocketConfig is configuration relevant to the transport socket and protocol.
type SocketConfig struct {
	ServerKey           string `yaml:"server_key" json:"server_key" usage:"Server key to use to establish a connection to the server."`
	Port                int    `yaml:"port" json:"port" usage:"The port for accepting connections from the client, listening on all interfaces."`
	MaxMessageSizeBytes int64  `yaml:"max_message_size_bytes" json:"max_message_size_bytes" usage:"Maximum amount of data in bytes allowed to be read from the client socket per message."`
	WriteWaitMs         int    `yaml:"write_wait_ms" json:"write_wait_ms" usage:"Time in milliseconds to wait for an ack from the client when writing data."`
	PongWaitMs          int    `yaml:"pong_wait_ms" json:"pong_wait_ms" usage:"Time in milliseconds to wait for a pong message from the client after sending a ping."`
	PingPeriodMs        int    `yaml:"ping_period_ms" json:"ping_period_ms" usage:"Time in milliseconds to wait between client ping messages. This value must be less than the pong_wait_ms."`
	OutgoingQueueSize   int    `yaml:"outgoing_queue_size" json:"outgoing_queue_size" usage:"The maximum number of messages waiting to be sent to the client. If this is exceeded the client is considered too slow and will disconnect."`
}

// NewTransportConfig creates a new TransportConfig struct.
func NewSocketConfig() *SocketConfig {
	return &SocketConfig{
		ServerKey:           "defaultkey",
		Port:                7350,
		MaxMessageSizeBytes: 2048,
		WriteWaitMs:         5000,
		PongWaitMs:          10000,
		PingPeriodMs:        8000,
		OutgoingQueueSize:   16,
	}
}

// DatabaseConfig is configuration relevant to the Database storage.
type DatabaseConfig struct {
	Addresses         []string `yaml:"address" json:"address" usage:"List of CockroachDB servers (username:password@address:port/dbname)"`
	ConnMaxLifetimeMs int      `yaml:"conn_max_lifetime_ms" json:"conn_max_lifetime_ms" usage:"Time in milliseconds to reuse a database connection before the connection is killed and a new one is created."`
	MaxOpenConns      int      `yaml:"max_open_conns" json:"max_open_conns" usage:"Maximum number of allowed open connections to the database."`
	MaxIdleConns      int      `yaml:"max_idle_conns" json:"max_idle_conns" usage:"Maximum number of allowed open but unused connections to the database."`
}

// NewDatabaseConfig creates a new DatabaseConfig struct.
func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		Addresses:         []string{"root@localhost:26257"},
		ConnMaxLifetimeMs: 60000,
		MaxOpenConns:      0,
		MaxIdleConns:      0,
	}
}

// RuntimeConfig is configuration relevant to the Runtime Lua VM.
type RuntimeConfig struct {
	Environment map[string]interface{} `yaml:"env" json:"env"` // Not supported in FlagOverrides.
	Path        string                 `yaml:"path" json:"path" usage:"Path of modules for the server to scan."`
	HTTPKey     string                 `yaml:"http_key" json:"http_key" usage:"Runtime HTTP Invocation key"`
}

// NewRuntimeConfig creates a new RuntimeConfig struct.
func NewRuntimeConfig() *RuntimeConfig {
	return &RuntimeConfig{
		Environment: make(map[string]interface{}),
		Path:        "",
		HTTPKey:     "defaultkey",
	}
}
