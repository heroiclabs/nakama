// Copyright 2023 The Nakama Authors
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

package satori

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

var _ runtime.Satori = &SatoriClient{}

type SatoriClient struct {
	logger         *zap.Logger
	httpc          *http.Client
	url            *url.URL
	urlString      string
	apiKeyName     string
	apiKey         string
	signingKey     string
	tokenExpirySec int
	invalidConfig  bool
}

func NewSatoriClient(logger *zap.Logger, satoriUrl, apiKeyName, apiKey, signingKey string) *SatoriClient {
	parsedUrl, _ := url.Parse(satoriUrl)

	sc := &SatoriClient{
		logger:         logger,
		urlString:      satoriUrl,
		httpc:          &http.Client{Timeout: 2 * time.Second},
		url:            parsedUrl,
		apiKeyName:     strings.TrimSpace(apiKeyName),
		apiKey:         strings.TrimSpace(apiKey),
		signingKey:     strings.TrimSpace(signingKey),
		tokenExpirySec: 3600,
	}

	if sc.urlString == "" && sc.apiKeyName == "" && sc.apiKey == "" && sc.signingKey == "" {
		sc.invalidConfig = true
	} else if err := sc.validateConfig(); err != nil {
		sc.invalidConfig = true
		logger.Warn(err.Error())
	}

	return sc
}

func (s *SatoriClient) validateConfig() error {
	errorStrings := make([]string, 0)
	satoriUrl, err := url.Parse(s.urlString)
	if err != nil {
		errorStrings = append(errorStrings, fmt.Sprintf("Invalid URL: %s", err.Error()))
	}

	if satoriUrl.String() != "" {
		if s.apiKeyName == "" {
			errorStrings = append(errorStrings, "api_key_name not set")
		}
		if s.apiKey == "" {
			errorStrings = append(errorStrings, "api_key not set")
		}
		if s.signingKey == "" {
			errorStrings = append(errorStrings, "signing_key not set")
		}
	} else if s.apiKeyName != "" || s.apiKey != "" || s.signingKey != "" {
		errorStrings = append(errorStrings, "Satori configuration incomplete: url not set")
	}

	if len(errorStrings) > 0 {
		return fmt.Errorf("Satori configuration invalid: %s.", strings.Join(errorStrings, ", "))
	}

	return nil
}

type sessionTokenClaims struct {
	SessionID  string `json:"sid,omitempty"`
	IdentityId string `json:"iid,omitempty"`
	ExpiresAt  int64  `json:"exp,omitempty"`
	IssuedAt   int64  `json:"iat,omitempty"`
	ApiKeyName string `json:"api,omitempty"`
}

func (stc *sessionTokenClaims) Valid() error {
	// Verify expiry.
	if stc.ExpiresAt <= time.Now().UTC().Unix() {
		vErr := new(jwt.ValidationError)
		vErr.Inner = errors.New("token is expired")
		vErr.Errors |= jwt.ValidationErrorExpired
		return vErr
	}
	return nil
}

func (s *SatoriClient) generateToken(id string) (string, error) {
	timestamp := time.Now().UTC()
	claims := sessionTokenClaims{
		SessionID:  "",
		IdentityId: id,
		ExpiresAt:  timestamp.Add(time.Duration(s.tokenExpirySec) * time.Second).Unix(),
		IssuedAt:   timestamp.Unix(),
		ApiKeyName: s.apiKeyName,
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &claims).SignedString([]byte(s.signingKey))
	if err != nil {
		return "", fmt.Errorf("Failed to generate token for Satori: %s", err.Error())
	}

	return token, nil
}

type authenticateBody struct {
	Id string `json:"id"`
}

// @group satori
// @summary Create a new identity.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param ipAddress(type=string, optional=true) An optional client IP address to pass on to Satori for geo-IP lookup.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) Authenticate(ctx context.Context, id string, ipAddress ...string) error {
	if s.invalidConfig {
		return runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/authenticate"

	body := &authenticateBody{Id: id}

	json, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(json))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(s.apiKey, "")
	if len(ipAddress) > 0 && ipAddress[0] != "" {
		if ipAddr := net.ParseIP(ipAddress[0]); ipAddr != nil {
			req.Header.Set("X-Forwarded-For", ipAddr.String())
		}
	} else if ipAddr, ok := ctx.Value(runtime.RUNTIME_CTX_CLIENT_IP).(string); ok {
		req.Header.Set("X-Forwarded-For", ipAddr)
	}

	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary Get identity properties.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @return properties(*runtime.Properties) The identity properties.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) PropertiesGet(ctx context.Context, id string) (*runtime.Properties, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/properties"

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		var props runtime.Properties
		if err = json.Unmarshal(resBody, &props); err != nil {
			return nil, err
		}

		return &props, nil
	default:
		return nil, fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary Update identity properties.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param properties(type=*runtime.PropertiesUpdate) The identity properties to update.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) PropertiesUpdate(ctx context.Context, id string, properties *runtime.PropertiesUpdate) error {
	if s.invalidConfig {
		return runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/properties"

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return err
	}

	json, err := json.Marshal(properties)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(json))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("%d status code", res.StatusCode)
	}
}

type event struct {
	*runtime.Event
	TimestampPb string `json:"timestamp,omitempty"`
}

type eventsBody struct {
	Events []*event `json:"events"`
}

func (e *event) setTimestamp() {
	e.TimestampPb = time.Unix(e.Timestamp, 0).Format(time.RFC3339)
}

// @group satori
// @summary Publish an event.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param events(type=[]*runtime.Event) An array of events to publish.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) EventsPublish(ctx context.Context, id string, events []*runtime.Event) error {
	if s.invalidConfig {
		return runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/event"

	evts := make([]*event, 0, len(events))
	for i, e := range events {
		evts = append(evts, &event{
			Event: e,
		})
		evts[i].setTimestamp()
	}

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return err
	}

	json, err := json.Marshal(&eventsBody{Events: evts})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(json))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary List experiments.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param names(type=[]string, optional=true, default=[]) Optional list of experiment names to filter.
// @return experiments(*runtime.ExperimentList) The experiment list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) ExperimentsList(ctx context.Context, id string, names ...string) (*runtime.ExperimentList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/experiment"

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	if len(names) > 0 {
		q := req.URL.Query()
		for _, n := range names {
			q.Set("names", n)
		}
		req.URL.RawQuery = q.Encode()
	}

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		var experiments runtime.ExperimentList
		if err = json.Unmarshal(resBody, &experiments); err != nil {
			return nil, err
		}

		return &experiments, nil
	default:
		return nil, fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary List flags.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param names(type=[]string, optional=true, default=[]) Optional list of flag names to filter.
// @return flags(*runtime.FlagList) The flag list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) FlagsList(ctx context.Context, id string, names ...string) (*runtime.FlagList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/flag"

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	if len(names) > 0 {
		q := req.URL.Query()
		for _, n := range names {
			q.Add("names", n)
		}
		req.URL.RawQuery = q.Encode()
	}

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		var flags runtime.FlagList
		if err = json.Unmarshal(resBody, &flags); err != nil {
			return nil, err
		}

		return &flags, nil
	default:
		return nil, fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary List live events.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param names(type=[]string, optional=true, default=[]) Optional list of live event names to filter.
// @return liveEvents(*runtime.LiveEventsList) The live event list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) LiveEventsList(ctx context.Context, id string, names ...string) (*runtime.LiveEventList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/live-event"

	sessionToken, err := s.generateToken(id)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))

	if len(names) > 0 {
		q := req.URL.Query()
		for _, n := range names {
			q.Set("names", n)
		}
		req.URL.RawQuery = q.Encode()
	}

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}
		var liveEvents runtime.LiveEventList
		if err = json.Unmarshal(resBody, &liveEvents); err != nil {
			return nil, err
		}

		return &liveEvents, nil
	default:
		return nil, fmt.Errorf("%d status code", res.StatusCode)
	}
}
