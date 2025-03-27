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
	"strconv"
	"strings"
	"sync"
	"time"
	"unique"

	"github.com/golang-jwt/jwt/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/ctxkeys"
	"go.uber.org/zap"
)

var _ runtime.Satori = &SatoriClient{}

type SatoriClient struct {
	logger               *zap.Logger
	httpc                *http.Client
	url                  *url.URL
	urlString            string
	apiKeyName           string
	apiKey               string
	signingKey           string
	tokenExpirySec       int
	nakamaTokenExpirySec int64
	invalidConfig        bool

	cacheEnabled             bool
	flagsCacheMutex          sync.RWMutex
	flagsOverridesCacheMutex sync.RWMutex
	propertiesCacheMutex     sync.RWMutex
	liveEventsCacheMutex     sync.RWMutex
	experimentsCacheMutex    sync.RWMutex
	flagsCache               map[context.Context]map[string]flagCacheEntry
	flagsOverridesCache      map[context.Context]map[string][]flagOverridesCacheEntry
	propertiesCache          map[context.Context]*runtime.Properties
	liveEventsCache          map[context.Context]*runtime.LiveEventList
	experimentsCache         map[context.Context]*runtime.ExperimentList
}

func NewSatoriClient(ctx context.Context, logger *zap.Logger, satoriUrl, apiKeyName, apiKey, signingKey string, nakamaTokenExpirySec int64, cacheEnabled bool) *SatoriClient {
	parsedUrl, _ := url.Parse(satoriUrl)

	sc := &SatoriClient{
		logger:               logger,
		urlString:            satoriUrl,
		httpc:                &http.Client{Timeout: 2 * time.Second},
		url:                  parsedUrl,
		apiKeyName:           strings.TrimSpace(apiKeyName),
		apiKey:               strings.TrimSpace(apiKey),
		signingKey:           strings.TrimSpace(signingKey),
		tokenExpirySec:       3600,
		nakamaTokenExpirySec: nakamaTokenExpirySec,

		cacheEnabled:             cacheEnabled,
		flagsCacheMutex:          sync.RWMutex{},
		flagsOverridesCacheMutex: sync.RWMutex{},
		propertiesCacheMutex:     sync.RWMutex{},
		liveEventsCacheMutex:     sync.RWMutex{},
		experimentsCacheMutex:    sync.RWMutex{},
		flagsCache:               make(map[context.Context]map[string]flagCacheEntry),
		flagsOverridesCache:      make(map[context.Context]map[string][]flagOverridesCacheEntry),
		propertiesCache:          make(map[context.Context]*runtime.Properties),
		liveEventsCache:          make(map[context.Context]*runtime.LiveEventList),
		experimentsCache:         make(map[context.Context]*runtime.ExperimentList),
	}

	if sc.urlString == "" && sc.apiKeyName == "" && sc.apiKey == "" && sc.signingKey == "" {
		sc.invalidConfig = true
	} else if err := sc.validateConfig(); err != nil {
		sc.invalidConfig = true
		logger.Warn(err.Error())
	}

	// NOTE: If the cache is enabled, any calls done within InitModule will remain cached for the lifetime of
	// the server.
	if sc.cacheEnabled {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					go func() {
						sc.flagsCacheMutex.Lock()
						for cacheCtx := range sc.flagsCache {
							if cacheCtx.Err() != nil {
								delete(sc.flagsCache, cacheCtx)
							}
						}
						sc.flagsCacheMutex.Unlock()
					}()

					go func() {
						sc.flagsOverridesCacheMutex.Lock()
						for cacheCtx := range sc.flagsOverridesCache {
							if cacheCtx.Err() != nil {
								delete(sc.flagsCache, cacheCtx)
							}
						}
						sc.flagsOverridesCacheMutex.Unlock()
					}()

					go func() {
						sc.propertiesCacheMutex.Lock()
						for cacheCtx := range sc.propertiesCache {
							if cacheCtx.Err() != nil {
								delete(sc.propertiesCache, cacheCtx)
							}
						}
						sc.propertiesCacheMutex.Unlock()
					}()

					go func() {
						sc.liveEventsCacheMutex.Lock()
						for cacheCtx := range sc.liveEventsCache {
							if cacheCtx.Err() != nil {
								delete(sc.liveEventsCache, cacheCtx)
							}
						}
						sc.liveEventsCacheMutex.Unlock()
					}()

					go func() {
						sc.experimentsCacheMutex.Lock()
						for cacheCtx := range sc.experimentsCache {
							if cacheCtx.Err() != nil {
								delete(sc.experimentsCache, cacheCtx)
							}
						}
						sc.experimentsCacheMutex.Unlock()
					}()
				}
			}
		}()
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

func (s *sessionTokenClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.ExpiresAt, 0)), nil
}
func (s *sessionTokenClaims) GetNotBefore() (*jwt.NumericDate, error) {
	return nil, nil
}
func (s *sessionTokenClaims) GetIssuedAt() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.IssuedAt, 0)), nil
}
func (s *sessionTokenClaims) GetAudience() (jwt.ClaimStrings, error) {
	return []string{}, nil
}
func (s *sessionTokenClaims) GetIssuer() (string, error) {
	return "", nil
}
func (s *sessionTokenClaims) GetSubject() (string, error) {
	return "", nil
}

func (s *SatoriClient) generateToken(ctx context.Context, id string) (string, error) {
	tid, ok := ctx.Value(ctxkeys.TokenIDKey{}).(string)
	if !ok {
		s.logger.Warn("satori request token id was not found in ctx")
	}
	tIssuedAt, ok := ctx.Value(ctxkeys.TokenIssuedAtKey{}).(int64)
	if !ok {
		s.logger.Warn("satori request token issued at was not found in ctx")
	}
	tExpirySec, ok := ctx.Value(ctxkeys.ExpiryKey{}).(int64)
	if !ok {
		s.logger.Warn("satori request token expires at was not found in ctx")
	}

	timestamp := time.Now().UTC()
	if tIssuedAt == 0 && tExpirySec > s.nakamaTokenExpirySec {
		// Token was issued before 'IssuedAt' had been added to the session token.
		// Thus, Nakama will make a guess of that value.
		tIssuedAt = tExpirySec - s.nakamaTokenExpirySec
	} else if tIssuedAt == 0 {
		// Unable to determine the token's issued at.
		tIssuedAt = timestamp.Unix()
	}

	claims := sessionTokenClaims{
		SessionID:  tid,
		IdentityId: id,
		ExpiresAt:  timestamp.Add(time.Duration(s.tokenExpirySec) * time.Second).Unix(),
		IssuedAt:   tIssuedAt,
		ApiKeyName: s.apiKeyName,
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &claims).SignedString([]byte(s.signingKey))
	if err != nil {
		return "", fmt.Errorf("Failed to generate token for Satori: %s", err.Error())
	}

	return token, nil
}

type authenticateBody struct {
	Id        string            `json:"id"`
	Default   map[string]string `json:"default,omitempty"`
	Custom    map[string]string `json:"custom,omitempty"`
	NoSession bool              `json:"no_session,omitempty"`
}

// @group satori
// @summary Create a new identity.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param defaultProperties(type=map[string]string, optional=true, default=nil) Default properties to update with this call. Set to nil to leave them as they are on the server.
// @param customProperties(type=map[string]string, optional=true, default=nil) Custom properties to update with this call. Set to nil to leave them as they are on the server.
// @param noSession(type=bool) Whether authenticate should skip session duration tracking.
// @param ipAddress(type=string, optional=true, default="") An optional client IP address to pass on to Satori for geo-IP lookup.
// @return properties(*runtime.Properties) The identity properties.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) Authenticate(ctx context.Context, id string, defaultProperties, customProperties map[string]string, noSession bool, ipAddress ...string) (*runtime.Properties, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + "/v1/authenticate"

	body := &authenticateBody{
		Id:        id,
		Default:   defaultProperties,
		Custom:    customProperties,
		NoSession: noSession,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
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
		return nil, err
	}

	defer res.Body.Close()

	switch res.StatusCode {
	case 200:
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		props := struct {
			Properties runtime.Properties `json:"properties"`
		}{
			Properties: runtime.Properties{
				Default:  map[string]string{},
				Custom:   map[string]string{},
				Computed: map[string]string{},
			},
		}
		if err = json.Unmarshal(resBody, &props); err != nil {
			return nil, err
		}

		return &props.Properties, nil
	default:
		return nil, fmt.Errorf("%d status code", res.StatusCode)
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

	s.propertiesCacheMutex.RLock()
	entry, found := s.propertiesCache[ctx]
	s.propertiesCacheMutex.RUnlock()

	if !found {
		url := s.url.String() + "/v1/properties"

		sessionToken, err := s.generateToken(ctx, id)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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

			var props *runtime.Properties
			if err = json.Unmarshal(resBody, &props); err != nil {
				return nil, err
			}

			s.propertiesCacheMutex.Lock()
			s.propertiesCache[ctx] = props
			s.propertiesCacheMutex.Unlock()

			return props, nil
		default:
			return nil, fmt.Errorf("%d status code", res.StatusCode)
		}
	}

	return entry, nil
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

	sessionToken, err := s.generateToken(ctx, id)
	if err != nil {
		return err
	}

	json, err := json.Marshal(properties)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(json))
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
// @param ipAddress(type=string, optional=true, default="") An optional client IP address to pass on to Satori for geo-IP lookup.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) EventsPublish(ctx context.Context, id string, events []*runtime.Event, ipAddress ...string) error {
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

	sessionToken, err := s.generateToken(ctx, id)
	if err != nil {
		return err
	}

	json, err := json.Marshal(&eventsBody{Events: evts})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(json))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))
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
		errBody, err := io.ReadAll(res.Body)
		if err == nil && len(errBody) > 0 {
			return fmt.Errorf("%d status code: %s", res.StatusCode, string(errBody))
		}
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

	s.experimentsCacheMutex.RLock()
	entry, found := s.experimentsCache[ctx]
	s.experimentsCacheMutex.RUnlock()

	if !found {
		url := s.url.String() + "/v1/experiment"

		sessionToken, err := s.generateToken(ctx, id)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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

		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		switch res.StatusCode {
		case 200:
			var experiments *runtime.ExperimentList
			if err = json.Unmarshal(resBody, &experiments); err != nil {
				return nil, err
			}

			s.experimentsCacheMutex.Lock()
			s.experimentsCache[ctx] = experiments
			s.experimentsCacheMutex.Unlock()

			return experiments, nil
		default:
			if len(resBody) > 0 {
				return nil, fmt.Errorf("%d status code: %s", res.StatusCode, string(resBody))
			}

			return nil, fmt.Errorf("%d status code", res.StatusCode)
		}
	}

	return entry, nil
}

type flagCacheEntry struct {
	Value            unique.Handle[string]
	ConditionChanged bool
}

type flagOverridesCacheEntry struct {
	runtime.FlagOverride
	Value unique.Handle[string]
}

// @group satori
// @summary List flags.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param names(type=[]string, optional=true, default=[]) Optional list of flag names to filter.
// @return flags(*runtime.FlagList) The flag list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) FlagsList(ctx context.Context, id string, names ...string) (*runtime.FlagList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	s.flagsCacheMutex.RLock()
	entry, found := s.flagsCache[ctx]
	s.flagsCacheMutex.RUnlock()

	if !found {
		url := s.url.String() + "/v1/flag"

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}

		if id != "" {
			sessionToken, err := s.generateToken(ctx, id)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))
		} else {
			req.SetBasicAuth(s.apiKey, "")
		}

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
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		switch res.StatusCode {
		case 200:
			var flags *runtime.FlagList
			if err = json.Unmarshal(resBody, &flags); err != nil {
				return nil, err
			}

			entries := make(map[string]flagCacheEntry, len(flags.Flags))
			for _, f := range flags.Flags {
				cacheEntry := flagCacheEntry{
					Value:            unique.Make(f.Value),
					ConditionChanged: f.ConditionChanged,
				}
				entries[f.Name] = cacheEntry
			}

			s.flagsCacheMutex.Lock()
			s.flagsCache[ctx] = entries
			s.flagsCacheMutex.Unlock()

			return flags, nil
		default:
			if len(resBody) > 0 {
				return nil, fmt.Errorf("%d status code: %s", res.StatusCode, string(resBody))
			}

			return nil, fmt.Errorf("%d status code", res.StatusCode)
		}
	}

	flagList := make([]*runtime.Flag, 0, len(entry))
	for flName, flEntry := range entry {
		flagList = append(flagList, &runtime.Flag{
			Name:             flName,
			Value:            flEntry.Value.Value(),
			ConditionChanged: flEntry.ConditionChanged,
		})
	}

	return &runtime.FlagList{Flags: flagList}, nil
}

// @group satori
// @summary List flags overrides.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param names(type=[]string, optional=true, default=[]) Optional list of flag names to filter.
// @return flagsOverrides(*runtime.FlagOverridesList) The flag list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) FlagsOverridesList(ctx context.Context, id string, names ...string) (*runtime.FlagOverridesList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	s.flagsOverridesCacheMutex.RLock()
	entry, found := s.flagsOverridesCache[ctx]
	s.flagsOverridesCacheMutex.RUnlock()

	if !found {
		url := s.url.String() + "/v1/flag/override"

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}

		if id != "" {
			sessionToken, err := s.generateToken(ctx, id)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))
		} else {
			req.SetBasicAuth(s.apiKey, "")
		}

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
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		switch res.StatusCode {
		case 200:
			var flagOverrides *runtime.FlagOverridesList
			if err = json.Unmarshal(resBody, &flagOverrides); err != nil {
				return nil, err
			}

			entries := make(map[string][]flagOverridesCacheEntry, len(flagOverrides.Flags))
			for _, f := range flagOverrides.Flags {
				overrides := make([]flagOverridesCacheEntry, 0, len(f.Overrides))
				for _, o := range f.Overrides {
					overrides = append(overrides, flagOverridesCacheEntry{
						FlagOverride: *o,
						Value:        unique.Make(o.Value),
					})
				}
				entries[f.FlagName] = overrides
			}

			s.flagsOverridesCacheMutex.Lock()
			s.flagsOverridesCache[ctx] = entries
			s.flagsOverridesCacheMutex.Unlock()

			return flagOverrides, nil
		default:
			if len(resBody) > 0 {
				return nil, fmt.Errorf("%d status code: %s", res.StatusCode, string(resBody))
			}

			return nil, fmt.Errorf("%d status code", res.StatusCode)
		}
	}

	flagOverridesList := make([]*runtime.FlagOverrides, 0, len(entry))
	for flagName, flagEntry := range entry {
		flagOverrides := make([]*runtime.FlagOverride, 0, len(flagEntry))
		for _, flagOverride := range flagEntry {
			flagOverrides = append(flagOverrides, &runtime.FlagOverride{
				Type:          flagOverride.Type,
				Name:          flagOverride.Name,
				VariantName:   flagOverride.VariantName,
				Value:         flagOverride.Value.Value(),
				CreateTimeSec: flagOverride.CreateTimeSec,
			})
		}

		flagOverridesList = append(flagOverridesList, &runtime.FlagOverrides{
			FlagName:  flagName,
			Overrides: flagOverrides,
		})
	}

	return &runtime.FlagOverridesList{
		Flags: flagOverridesList,
	}, nil
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

	s.liveEventsCacheMutex.RLock()
	entry, found := s.liveEventsCache[ctx]
	s.liveEventsCacheMutex.RUnlock()

	if !found {
		url := s.url.String() + "/v1/live-event"

		sessionToken, err := s.generateToken(ctx, id)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		switch res.StatusCode {
		case 200:
			var liveEvents *runtime.LiveEventList
			if err = json.Unmarshal(resBody, &liveEvents); err != nil {
				return nil, err
			}

			s.liveEventsCacheMutex.Lock()
			s.liveEventsCache[ctx] = liveEvents
			s.liveEventsCacheMutex.Unlock()

			return liveEvents, nil
		default:
			if len(resBody) > 0 {
				return nil, fmt.Errorf("%d status code: %s", res.StatusCode, string(resBody))
			}
			return nil, fmt.Errorf("%d status code", res.StatusCode)
		}
	}

	return entry, nil
}

// @group satori
// @summary List messages.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param limit(type=int) The max number of messages to return.
// @param forward(type=bool) True if listing should be older messages to newer, false if reverse.
// @param cursor(type=string) A pagination cursor, if any.
// @return messages(*runtime.MessageList) The messages list.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) MessagesList(ctx context.Context, id string, limit int, forward bool, cursor string) (*runtime.MessageList, error) {
	if s.invalidConfig {
		return nil, runtime.ErrSatoriConfigurationInvalid
	}

	if limit < 1 {
		return nil, errors.New("limit must be greater than zero")
	}

	url := s.url.String() + "/v1/message"

	sessionToken, err := s.generateToken(ctx, id)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", sessionToken))
	q := req.URL.Query()
	q.Set("limit", strconv.Itoa(limit))
	q.Set("forward", strconv.FormatBool(forward))
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	req.URL.RawQuery = q.Encode()

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	defer res.Body.Close()
	resBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	switch res.StatusCode {
	case 200:
		var messages runtime.MessageList
		if err = json.Unmarshal(resBody, &messages); err != nil {
			return nil, err
		}

		return &messages, nil
	default:
		if len(resBody) > 0 {
			return nil, fmt.Errorf("%d status code: %s", res.StatusCode, string(resBody))
		}
		return nil, fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary Update message.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param messageId(type=string) The id of the message.
// @param readTime(type=int64) The time the message was read at the client.
// @param consumeTime(type=int64) The time the message was consumed by the identity.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) MessageUpdate(ctx context.Context, id, messageId string, readTime, consumeTime int64) error {
	if s.invalidConfig {
		return runtime.ErrSatoriConfigurationInvalid
	}

	url := s.url.String() + fmt.Sprintf("/v1/message/%s", messageId)

	sessionToken, err := s.generateToken(ctx, id)
	if err != nil {
		return err
	}

	json, err := json.Marshal(&runtime.MessageUpdate{
		ReadTime:    readTime,
		ConsumeTime: consumeTime,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(json))
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
		errBody, err := io.ReadAll(res.Body)
		if err == nil && len(errBody) > 0 {
			return fmt.Errorf("%d status code: %s", res.StatusCode, string(errBody))
		}
		return fmt.Errorf("%d status code", res.StatusCode)
	}
}

// @group satori
// @summary Delete message.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The identifier of the identity.
// @param messageId(type=string) The identifier of the message.
// @return error(error) An optional error value if an error occurred.
func (s *SatoriClient) MessageDelete(ctx context.Context, id, messageId string) error {
	if s.invalidConfig {
		return runtime.ErrSatoriConfigurationInvalid
	}

	if messageId == "" {
		return errors.New("message id cannot be an empty string")
	}

	url := s.url.String() + fmt.Sprintf("/v1/message/%s", messageId)

	sessionToken, err := s.generateToken(ctx, id)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
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
		errBody, err := io.ReadAll(res.Body)
		if err == nil && len(errBody) > 0 {
			return fmt.Errorf("%d status code: %s", res.StatusCode, string(errBody))
		}
		return fmt.Errorf("%d status code", res.StatusCode)
	}
}
