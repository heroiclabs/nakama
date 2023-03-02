package satori

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang-jwt/jwt/v4"
	"github.com/heroiclabs/nakama-common/runtime"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SatoriClient struct {
	httpc          *http.Client
	url            *url.URL
	urlString      string
	apiKeyName     string
	apiKey         string
	signingKey     string
	tokenExpirySec int
}

func NewSatoriClient(satoriUrl, apiKeyName, apiKey, signingKey string) *SatoriClient {
	parsedUrl, _ := url.Parse(satoriUrl)
	return &SatoriClient{
		urlString:      satoriUrl,
		httpc:          &http.Client{Timeout: 2 * time.Second},
		url:            parsedUrl,
		apiKeyName:     strings.TrimSpace(apiKeyName),
		apiKey:         strings.TrimSpace(apiKey),
		signingKey:     strings.TrimSpace(signingKey),
		tokenExpirySec: 3600,
	}
}

func (s *SatoriClient) validateConfig() error {
	errorStrings := make([]string, 0)
	if s.url == nil {
		_, err := url.Parse(s.urlString)
		errorStrings = append(errorStrings, fmt.Sprintf("Invalid URL: %s", err.Error()))
	}
	if s.apiKeyName == "" {
		errorStrings = append(errorStrings, "API key name not set.")
	}
	if s.apiKey == "" {
		errorStrings = append(errorStrings, "API Key not set.")
	}
	if s.signingKey == "" {
		errorStrings = append(errorStrings, "Signing Key not set.")
	}

	if len(errorStrings) > 0 {
		return fmt.Errorf("Satori configuration error: %s", strings.Join(errorStrings, ", "))
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
		SessionID:  uuid.Must(uuid.NewV4()).String(),
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

func (s *SatoriClient) Authenticate(ctx context.Context, id string) error {
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

	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}

func (s *SatoriClient) ListProperties(ctx context.Context, id string) (*runtime.Properties, error) {
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

	switch res.StatusCode {
	case 200:
		var props runtime.Properties
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		if err = json.Unmarshal(resBody, &props); err != nil {
			return nil, err
		}

		return &props, nil
	default:
		return nil, fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}

func (s *SatoriClient) UpdateProperties(ctx context.Context, id string, properties *runtime.Properties) error {
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

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("Non-200 status code: %d", res.StatusCode)
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

func (s *SatoriClient) PublishEvent(ctx context.Context, id string, events *runtime.Events) error {
	url := s.url.String() + "/v1/properties"

	evts := make([]*event, 0, len(events.Events))
	for i, e := range events.Events {
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

	switch res.StatusCode {
	case 200:
		return nil
	default:
		return fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}

func (s *SatoriClient) ListExperiments(ctx context.Context, id string, names ...string) (*runtime.ExperimentList, error) {
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

	switch res.StatusCode {
	case 200:
		var experiments runtime.ExperimentList
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		if err = json.Unmarshal(resBody, &experiments); err != nil {
			return nil, err
		}

		return &experiments, nil
	default:
		return nil, fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}

func (s *SatoriClient) ListFlags(ctx context.Context, id string, names ...string) (*runtime.FlagList, error) {
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
			q.Set("names", n)
		}
		req.URL.RawQuery = q.Encode()
	}

	res, err := s.httpc.Do(req)
	if err != nil {
		return nil, err
	}

	switch res.StatusCode {
	case 200:
		var flags runtime.FlagList
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		if err = json.Unmarshal(resBody, &flags); err != nil {
			return nil, err
		}

		return &flags, nil
	default:
		return nil, fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}

func (s *SatoriClient) GetLiveEvents(ctx context.Context, id string, names ...string) (*runtime.LiveEventList, error) {
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

	switch res.StatusCode {
	case 200:
		var liveEvents runtime.LiveEventList
		resBody, err := io.ReadAll(res.Body)
		if err != nil {
			return nil, err
		}

		if err = json.Unmarshal(resBody, &liveEvents); err != nil {
			return nil, err
		}

		return &liveEvents, nil
	default:
		return nil, fmt.Errorf("Non-200 status code: %d", res.StatusCode)
	}
}
