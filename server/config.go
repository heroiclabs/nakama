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

	"github.com/satori/go.uuid"
)

// Config interface is the Nakama Core configuration
type Config interface {
	GetName() string
	GetDataDir() string
	GetPort() int
	GetOpsPort() int
	GetDSNS() []string
	GetSession() *SessionConfig
	GetTransport() *TransportConfig
	GetDatabase() *DatabaseConfig
	GetSocial() *SocialConfig
}

type config struct {
	Name      string           `yaml:"name"`
	Datadir   string           `yaml:"data_dir"`
	Port      int              `yaml:"port"`
	OpsPort   int              `yaml:"ops_port"`
	Dsns      []string         `yaml:"dsns"`
	Session   *SessionConfig   `yaml:"session"`
	Transport *TransportConfig `yaml:"transport"`
	Database  *DatabaseConfig  `yaml:"database"`
	Social    *SocialConfig    `yaml:"social"`
}

// NewConfig constructs a Config struct which represents server settings.
func NewConfig() *config {
	cwd, _ := os.Getwd()
	dataDirectory := filepath.FromSlash(cwd + "/data")
	nodeName := "nakama-" + strings.Split(uuid.NewV4().String(), "-")[3]
	return &config{
		Name:      nodeName,
		Datadir:   dataDirectory,
		Port:      7350,
		OpsPort:   7351,
		Dsns:      []string{"root@localhost:26257"},
		Session:   NewSessionConfig(),
		Transport: NewTransportConfig(),
		Database:  NewDatabaseConfig(),
		Social:    NewSocialConfig(),
	}
}

func (c *config) GetName() string {
	return c.Name
}

func (c *config) GetDataDir() string {
	return c.Datadir
}

func (c *config) GetPort() int {
	return c.Port
}

func (c *config) GetOpsPort() int {
	return c.OpsPort
}

func (c *config) GetDSNS() []string {
	return c.Dsns
}

func (c *config) GetSession() *SessionConfig {
	return c.Session
}

func (c *config) GetTransport() *TransportConfig {
	return c.Transport
}

func (c *config) GetDatabase() *DatabaseConfig {
	return c.Database
}

func (c *config) GetSocial() *SocialConfig {
	return c.Social
}

// SessionConfig is configuration relevant to the session
type SessionConfig struct {
	EncryptionKey string `yaml:"encryption_key"`
	TokenExpiryMs int64  `yaml:"token_expiry_ms"`
}

// NewSessionConfig creates a new SessionConfig struct
func NewSessionConfig() *SessionConfig {
	return &SessionConfig{
		EncryptionKey: "defaultencryptionkey",
		TokenExpiryMs: 60000,
	}
}

// TransportConfig is configuration relevant to the transport socket and protocol
type TransportConfig struct {
	ServerKey           string `yaml:"server_key"`
	MaxMessageSizeBytes int64  `yaml:"max_message_size_bytes"`
	WriteWaitMs         int    `yaml:"write_wait_ms"`
	PongWaitMs          int    `yaml:"pong_wait_ms"`
	PingPeriodMs        int    `yaml:"ping_period_ms"`
}

// NewTransportConfig creates a new TransportConfig struct
func NewTransportConfig() *TransportConfig {
	return &TransportConfig{
		ServerKey:           "defaultkey",
		MaxMessageSizeBytes: 1024,
		WriteWaitMs:         5000,
		PongWaitMs:          10000,
		PingPeriodMs:        8000,
	}
}

// DatabaseConfig is configuration relevant to the Database storage
type DatabaseConfig struct {
	ConnMaxLifetimeMs int `yaml:"conn_max_lifetime_ms"`
	MaxOpenConns      int `yaml:"max_open_conns"`
	MaxIdleConns      int `yaml:"max_idle_conns"`
}

// NewDatabaseConfig creates a new DatabaseConfig struct
func NewDatabaseConfig() *DatabaseConfig {
	return &DatabaseConfig{
		ConnMaxLifetimeMs: 60000,
		MaxOpenConns:      0,
		MaxIdleConns:      0,
	}
}

// SocialConfig is configuration relevant to the Social providers
type SocialConfig struct {
	Steam *SocialConfigSteam `yaml:"steam"`
}

// SocialConfigSteam is configuration relevant to Steam
type SocialConfigSteam struct {
	PublisherKey string `yaml:"publisher_key"`
	AppID        int    `yaml:"app_id"`
}

// NewSocialConfig creates a new SocialConfig struct
func NewSocialConfig() *SocialConfig {
	return &SocialConfig{
		Steam: &SocialConfigSteam{
			PublisherKey: "",
			AppID:        0,
		},
	}
}
