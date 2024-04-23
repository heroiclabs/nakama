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

package social

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	jwt "github.com/golang-jwt/jwt/v4"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// Client is responsible for making calls to different providers
type Client struct {
	logger *zap.Logger

	client *http.Client

	googleMutex          sync.RWMutex
	googleCerts          []*rsa.PublicKey
	googleCertsRefreshAt int64

	facebookMutex          sync.RWMutex
	facebookCerts          map[string]*JwksCert
	facebookCertsRefreshAt int64

	appleMutex          sync.RWMutex
	appleCerts          map[string]*JwksCert
	appleCertsRefreshAt int64

	config *oauth2.Config
}

type JwksCerts struct {
	Keys []*JwksCert `json:"keys"`
}

// JWK certificate data for an Apple Sign In verification key.
type JwksCert struct {
	key *rsa.PublicKey

	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// AppleProfile is an abbreviated version of a user authenticated through Apple Sign In.
type AppleProfile struct {
	ID            string
	Email         string
	EmailVerified bool
}

// FacebookProfile is an abbreviated version of a Facebook profile.
type FacebookProfile struct {
	ID      string              `json:"id"`
	Name    string              `json:"name"`
	Email   string              `json:"email"`
	Picture FacebookPictureData `json:"picture"`
}

type FacebookPictureData struct {
	Data FacebookPicture `json:"data"`
}

type FacebookPicture struct {
	Height       int    `json:"height"`
	Width        int    `json:"width"`
	IsSilhouette bool   `json:"is_silhouette"`
	Url          string `json:"url"`
}

type facebookPagingCursors struct {
	After  string `json:"after"`
	Before string `json:"before"`
}

type facebookPaging struct {
	Cursors  facebookPagingCursors `json:"cursors"`
	Previous string                `json:"previous"`
	Next     string                `json:"next"`
}

type facebookFriends struct {
	Paging facebookPaging    `json:"paging"`
	Data   []FacebookProfile `json:"data"`
}

// GoogleProfile is an abbreviated version of a Google profile extracted from a token.
type GoogleProfile interface {
	GetDisplayName() string
	GetEmail() string
	GetAvatarImageUrl() string
	GetGoogleId() string
	GetOriginalGoogleId() string
}

// JWTGoogleProfile is an abbreviated version of a Google profile extracted from a verified JWT token.
type JWTGoogleProfile struct {
	// Fields available in all tokens.
	Iss string `json:"iss"`
	Sub string `json:"sub"`
	Azp string `json:"azp"`
	Aud string `json:"aud"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
	// Fields available only if the user granted the "profile" and "email" OAuth scopes.
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Locale        string `json:"locale"`
}

func (p *JWTGoogleProfile) GetDisplayName() string {
	return p.Name
}

func (p *JWTGoogleProfile) GetEmail() string {
	return p.Email
}
func (p *JWTGoogleProfile) GetAvatarImageUrl() string {
	return p.Picture
}
func (p *JWTGoogleProfile) GetGoogleId() string {
	return p.Sub
}

func (p *JWTGoogleProfile) GetOriginalGoogleId() string {
	// Dummy implementation
	return ""
}

// GooglePlayServiceProfile is an abbreviated version of a Google profile using an access token.
type GooglePlayServiceProfile struct {
	PlayerId         string `json:"playerId"`
	DisplayName      string `json:"displayName"`
	AvatarImageUrl   string `json:"avatarImageUrl"`
	OriginalPlayerId string `json:"originalPlayerId"`
}

func (p *GooglePlayServiceProfile) GetDisplayName() string {
	return p.DisplayName
}

func (p *GooglePlayServiceProfile) GetEmail() string {
	return "" // The API doesn't expose the email.
}
func (p *GooglePlayServiceProfile) GetAvatarImageUrl() string {
	return p.AvatarImageUrl
}
func (p *GooglePlayServiceProfile) GetGoogleId() string {
	return p.PlayerId
}
func (p *GooglePlayServiceProfile) GetOriginalGoogleId() string {
	return p.OriginalPlayerId
}

// SteamProfile is an abbreviated version of a Steam profile.
type SteamProfile struct {
	SteamID uint64 `json:"steamid,string"`
}

type steamFriends struct {
	Friends []SteamProfile `json:"friends"`
}

type steamFriendsWrapper struct {
	FriendsList steamFriends `json:"friendsList"`
}

// SteamError contains a possible error response from the Steam Web API.
type SteamError struct {
	ErrorDesc string `json:"errordesc"`
	ErrorCode int    `json:"errorcode"`
}

// Unwrapping the SteamProfile
type SteamProfileWrapper struct {
	Response struct {
		Params *SteamProfile `json:"params"`
		Error  *SteamError   `json:"error"`
	} `json:"response"`
}

// NewClient creates a new Social Client
func NewClient(logger *zap.Logger, timeout time.Duration, googleCnf *oauth2.Config) *Client {
	return &Client{
		logger: logger,

		client: &http.Client{
			Timeout: timeout,
		},

		config: googleCnf,
	}
}

// GetFacebookProfile retrieves the user's Facebook Profile given the accessToken
func (c *Client) GetFacebookProfile(ctx context.Context, accessToken string) (*FacebookProfile, error) {
	c.logger.Debug("Getting Facebook profile", zap.String("token", accessToken))

	path := "https://graph.facebook.com/v18.0/me?access_token=" + url.QueryEscape(accessToken) +
		"&fields=" + url.QueryEscape("id,name,email,picture")
	var profile FacebookProfile
	err := c.request(ctx, "facebook profile", path, nil, &profile)
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// GetFacebookFriends queries the Facebook Graph.
// Token is expected to also have the "user_friends" permission.
func (c *Client) GetFacebookFriends(ctx context.Context, accessToken string) ([]FacebookProfile, error) {
	c.logger.Debug("Getting Facebook friends", zap.String("token", accessToken))

	friends := make([]FacebookProfile, 0)
	after := ""
	for {
		// In FB Graph API 2.0+ this only returns friends that also use the same app.
		path := "https://graph.facebook.com/v18.0/me/friends?access_token=" + url.QueryEscape(accessToken)
		if after != "" {
			path += "&after=" + after
		}
		var currentFriends facebookFriends
		err := c.request(ctx, "facebook friends", path, nil, &currentFriends)
		if err != nil {
			return friends, err
		}
		friends = append(friends, currentFriends.Data...)
		// When there are no more items, this will be "" and end the loop.
		if currentFriends.Paging.Next == "" {
			return friends, nil
		}
		after = currentFriends.Paging.Cursors.After
	}
}

// GetSteamFriends queries the Steam API for friends.
func (c *Client) GetSteamFriends(ctx context.Context, publisherKey, steamId string) ([]SteamProfile, error) {
	c.logger.Debug("Getting Steam friends", zap.String("steamId", steamId))

	path := fmt.Sprintf("https://partner.steam-api.com/ISteamUser/GetFriendList/v0001/?key=%s&steamid=%s&relationship=friend", publisherKey, steamId)
	var steamFriends steamFriendsWrapper
	err := c.request(ctx, "steam friends", path, nil, &steamFriends)
	if err != nil {
		return nil, err
	}

	return steamFriends.FriendsList.Friends, nil
}

// Extract player ID and validate the Facebook Instant Game token.
func (c *Client) ExtractFacebookInstantGameID(signedPlayerInfo string, appSecret string) (facebookInstantGameID string, err error) {
	c.logger.Debug("Extracting Facebook Instant Game ID", zap.String("signedPlayerInfo", signedPlayerInfo))

	parts := strings.Split(signedPlayerInfo, ".")
	if len(parts) != 2 {
		return "", errors.New("malformed signedPlayerInfo")
	}

	signatureBase64 := parts[0]
	payloadBase64 := parts[1]
	payloadRaw, err := jwt.DecodeSegment(payloadBase64) //nolint:staticcheck
	if err != nil {
		return "", err
	}

	var payload struct {
		Algorithm      string `json:"algorithm"`
		PlayerID       string `json:"player_id"`
		RequestPayload string `json:"request_payload"` // discarded
		IssuedAt       int    `json:"issued_at"`
	}
	err = json.Unmarshal(payloadRaw, &payload)
	if err != nil {
		return "", err
	}

	signingMethod := jwt.GetSigningMethod(payload.Algorithm)
	if signingMethod == nil {
		if payload.Algorithm == "HMAC-SHA256" {
			signingMethod = jwt.GetSigningMethod("HS256")
		} else {
			return "", errors.New("invalid signing method")
		}
	}

	err = signingMethod.Verify(payloadBase64, signatureBase64, []byte(appSecret))
	if err != nil {
		return "", err
	}

	return payload.PlayerID, nil
}

func (c *Client) exchangeGoogleAuthCode(ctx context.Context, authCode string) (*oauth2.Token, error) {
	if c.config == nil {
		return nil, fmt.Errorf("failed to exchange authorization code due to due misconfiguration")
	}

	token, err := c.config.Exchange(ctx, authCode)
	if err != nil {
		c.logger.Debug("Failed to exchange authorization code for a token.", zap.Error(err))
		return nil, fmt.Errorf("failed to exchange authorization code for a token")
	}

	return token, nil
}

// CheckGoogleToken extracts the user's Google Profile from a given ID token.
func (c *Client) CheckGoogleToken(ctx context.Context, idToken string) (GoogleProfile, error) {
	c.logger.Debug("Checking Google ID", zap.String("idToken", idToken))

	c.googleMutex.RLock()
	if c.googleCertsRefreshAt < time.Now().UTC().Unix() {
		// Release the read lock and perform a certificate refresh.
		c.googleMutex.RUnlock()
		c.googleMutex.Lock()
		if c.googleCertsRefreshAt < time.Now().UTC().Unix() {
			certs := make(map[string]string, 3)
			err := c.request(ctx, "google cert", "https://www.googleapis.com/oauth2/v1/certs", nil, &certs)
			if err != nil {
				c.googleMutex.Unlock()
				return nil, err
			}
			newCerts := make([]*rsa.PublicKey, 0, len(certs))
			var newRefreshAt int64
			for _, data := range certs {
				currentBlock, _ := pem.Decode([]byte(data))
				if currentBlock == nil {
					// Block was invalid, ignore it and try the next.
					continue
				}
				currentCert, err := x509.ParseCertificate(currentBlock.Bytes)
				if err != nil {
					// Certificate was invalid, ignore it and try the next.
					continue
				}
				t := time.Now()
				if currentCert.NotBefore.After(t) || currentCert.NotAfter.Before(t) {
					// Certificate not yet valid or has already expired, skip it.
					continue
				}
				pub, ok := currentCert.PublicKey.(*rsa.PublicKey)
				if !ok {
					// Certificate was not an RSA public key.
					continue
				}
				newCerts = append(newCerts, pub)
				if newRefreshAt == 0 || newRefreshAt > currentCert.NotAfter.UTC().Unix() {
					// Refresh all certs 1 hour before the soonest expiry is due.
					newRefreshAt = currentCert.NotAfter.UTC().Unix() - 3600
				}
			}
			if len(newCerts) == 0 {
				c.googleMutex.Unlock()
				return nil, errors.New("error finding valid google cert")
			}
			c.googleCerts = newCerts
			c.googleCertsRefreshAt = newRefreshAt
		}
		c.googleMutex.Unlock()
		c.googleMutex.RLock()
	}
	googleCerts := c.googleCerts
	c.googleMutex.RUnlock()

	var err error
	var token *jwt.Token
	for _, cert := range googleCerts {
		// Try to parse and verify the token with each of the currently available certificates.
		token, err = jwt.Parse(idToken, func(token *jwt.Token) (interface{}, error) {
			if s, ok := token.Method.(*jwt.SigningMethodRSA); !ok || s.Hash != crypto.SHA256 {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}

			claims := token.Claims.(jwt.MapClaims)
			if !claims.VerifyIssuer("accounts.google.com", true) && !claims.VerifyIssuer("https://accounts.google.com", true) {
				return nil, fmt.Errorf("unexpected issuer: %v", claims["iss"])
			}

			return cert, nil
		})
		if err == nil {
			// If any certificate worked, the token is valid.
			break
		}
	}

	// All verification attempts failed.
	if token == nil {
		// The id provided could be from the new auth flow. Let's exchange it for a token.
		t, err := c.exchangeGoogleAuthCode(ctx, idToken)
		if err != nil {
			c.logger.Debug("Failed to exchange an authorization code for an access token.", zap.String("auth_token", idToken), zap.Error(err))
			return nil, errors.New("google id token invalid")
		}

		c.logger.Debug("Exchanged an authorization code for an access token.", zap.Any("token", t), zap.Error(err))

		profile := GooglePlayServiceProfile{}
		if err := c.request(ctx, "google play services", "https://www.googleapis.com/games/v1/players/me?access_token="+url.QueryEscape(t.AccessToken), nil, &profile); err != nil {
			c.logger.Debug("Failed to request player info.", zap.Any("token", t), zap.Error(err))
			return nil, errors.New("failed to request player info.")
		}

		if profile.PlayerId == "" {
			c.logger.Debug("Failed to parse playerId.", zap.Any("token", t), zap.Error(err))
			return nil, errors.New("player_id cannot be an empty string.")
		}

		c.logger.Debug("Obtained the player profile using an access token.", zap.Any("token", t), zap.Error(err), zap.Any("player", profile))
		return &profile, nil
	}

	if err != nil {
		// JWT token validation failed and fallback to new flow didn't yield a result
		return nil, errors.New("google id token invalid")
	}

	claims := token.Claims.(jwt.MapClaims)
	profile := &JWTGoogleProfile{}
	if v, ok := claims["iss"]; ok {
		if profile.Iss, ok = v.(string); !ok {
			return nil, errors.New("google id token iss field invalid")
		}
	} else {
		return nil, errors.New("google id token iss field missing")
	}
	if v, ok := claims["sub"]; ok {
		if profile.Sub, ok = v.(string); !ok {
			return nil, errors.New("google id token sub field invalid")
		}
	} else {
		return nil, errors.New("google id token sub field missing")
	}
	if v, ok := claims["azp"]; ok {
		if profile.Azp, ok = v.(string); !ok {
			return nil, errors.New("google id token azp field invalid")
		}
	} else {
		return nil, errors.New("google id token azp field missing")
	}
	if v, ok := claims["aud"]; ok {
		if profile.Aud, ok = v.(string); !ok {
			return nil, errors.New("google id token aud field invalid")
		}
	} else {
		return nil, errors.New("google id token aud field missing")
	}
	if v, ok := claims["iat"]; ok {
		switch val := v.(type) {
		case string:
			vi, err := strconv.Atoi(val)
			if err != nil {
				return nil, errors.New("google id token iat field invalid")
			}
			profile.Iat = int64(vi)
		case float64:
			profile.Iat = int64(val)
		case int64:
			profile.Iat = val
		default:
			return nil, errors.New("google id token iat field unknown")
		}
	}
	if v, ok := claims["exp"]; ok {
		switch val := v.(type) {
		case string:
			vi, err := strconv.Atoi(val)
			if err != nil {
				return nil, errors.New("google id token exp field invalid")
			}
			profile.Exp = int64(vi)
		case float64:
			profile.Exp = int64(val)
		case int64:
			profile.Exp = val
		default:
			return nil, errors.New("google id token exp field unknown")
		}
	}
	if v, ok := claims["email"]; ok {
		if profile.Email, ok = v.(string); !ok {
			return nil, errors.New("google id token email field invalid")
		}
	}
	if v, ok := claims["email_verified"]; ok {
		switch val := v.(type) {
		case bool:
			profile.EmailVerified = val
		case string:
			vb, err := strconv.ParseBool(val)
			if err != nil {
				return nil, errors.New("google id token email_verified field invalid")
			}
			profile.EmailVerified = vb
		default:
			return nil, errors.New("google id token email_verified field unknown")
		}
	}
	if v, ok := claims["name"]; ok {
		if profile.Name, ok = v.(string); !ok {
			return nil, errors.New("google id token name field invalid")
		}
	}
	if v, ok := claims["picture"]; ok {
		if profile.Picture, ok = v.(string); !ok {
			return nil, errors.New("google id token picture field invalid")
		}
	}
	if v, ok := claims["given_name"]; ok {
		if profile.GivenName, ok = v.(string); !ok {
			return nil, errors.New("google id token given name field invalid")
		}
	}
	if v, ok := claims["family_name"]; ok {
		if profile.FamilyName, ok = v.(string); !ok {
			return nil, errors.New("google id token family name field invalid")
		}
	}
	if v, ok := claims["locale"]; ok {
		if profile.Locale, ok = v.(string); !ok {
			return nil, errors.New("google id token locale field invalid")
		}
	}

	// Check token has not expired.
	if profile.Exp != 0 && profile.Exp < time.Now().UTC().Unix() {
		return nil, errors.New("google id token expired")
	}

	return profile, nil
}

// CheckGameCenterID checks to see validity of the GameCenter playerID
func (c *Client) CheckGameCenterID(ctx context.Context, playerID string, bundleID string, timestamp int64, salt string, signature string, publicKeyURL string) (bool, error) {
	c.logger.Debug("Checking Game Center ID", zap.String("playerID", playerID), zap.String("bundleID", bundleID), zap.Int64("timestamp", timestamp), zap.String("salt", salt), zap.String("signature", signature), zap.String("publicKeyURL", publicKeyURL))

	pub, err := url.Parse(publicKeyURL)
	if err != nil {
		return false, fmt.Errorf("gamecenter check error: invalid public key url: %v", err.Error())
	} else if pub.Scheme != "https" {
		return false, errors.New("gamecenter check error: invalid public key url scheme")
	} else if pub.Path == "" || pub.Path == "/" {
		return false, errors.New("gamecenter check error: invalid public key url path")
	} else if !strings.HasSuffix(pub.Host, ".apple.com") {
		return false, errors.New("gamecenter check error: invalid public key url domain")
	}
	slt, err := base64.StdEncoding.DecodeString(salt)
	if err != nil {
		return false, errors.New("gamecenter check error: error decoding salt")
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return false, errors.New("gamecenter check error: error decoding signature")
	}

	body, err := c.requestRaw(ctx, "apple public key url", publicKeyURL, nil)
	if err != nil {
		return false, err
	}

	// Parse the public key, check issuer, check signature.
	pubBlock, rest := pem.Decode(body)
	if pubBlock == nil {
		pubBlock, _ = pem.Decode([]byte("\n-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(rest) + "\n-----END CERTIFICATE-----"))
		if pubBlock == nil {
			return false, errors.New("gamecenter check error: error decoding public key")
		}
	}
	pubCert, err := x509.ParseCertificate(pubBlock.Bytes)
	if err != nil {
		return false, fmt.Errorf("gamecenter check error: error parsing public block: %v", err.Error())
	}
	ts := make([]byte, 8)
	binary.BigEndian.PutUint64(ts, uint64(timestamp))
	payload := [][]byte{[]byte(playerID), []byte(bundleID), ts, slt}
	err = pubCert.CheckSignature(x509.SHA256WithRSA, bytes.Join(payload, []byte{}), sig)
	if err != nil {
		return false, fmt.Errorf("gamecenter check error: signature mismatch: %v", err.Error())
	}
	return true, nil
}

// GetSteamProfile retrieves the user's Steam Profile.
// Key and App ID should be configured at the application level.
// See: https://partner.steamgames.com/documentation/auth#client_to_backend_webapi
func (c *Client) GetSteamProfile(ctx context.Context, publisherKey string, appID int, ticket string) (*SteamProfile, error) {
	c.logger.Debug("Getting Steam profile", zap.String("publisherKey", publisherKey), zap.Int("appID", appID), zap.String("ticket", ticket))

	path := "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?format=json" +
		"&key=" + url.QueryEscape(publisherKey) + "&appid=" + strconv.Itoa(appID) + "&ticket=" + url.QueryEscape(ticket)
	var profileWrapper SteamProfileWrapper
	err := c.request(ctx, "steam profile", path, nil, &profileWrapper)
	if err != nil {
		c.logger.Debug("Error requesting Steam profile", zap.Error(err))
		return nil, err
	}
	if profileWrapper.Response.Error != nil {
		c.logger.Debug("Error returned from Steam after requesting Steam profile", zap.String("errorDescription", profileWrapper.Response.Error.ErrorDesc), zap.Int("errorCode", profileWrapper.Response.Error.ErrorCode))
		return nil, fmt.Errorf("%v, %v", profileWrapper.Response.Error.ErrorDesc, profileWrapper.Response.Error.ErrorCode)
	}
	if profileWrapper.Response.Params == nil {
		c.logger.Debug("No profile returned from Steam after requesting Steam profile")
		return nil, errors.New("no steam profile")
	}
	return profileWrapper.Response.Params, nil
}

func (c *Client) CheckAppleToken(ctx context.Context, bundleId string, idToken string) (*AppleProfile, error) {
	c.logger.Debug("Checking Apple Sign In", zap.String("bundleId", bundleId), zap.String("idToken", idToken))

	if bundleId == "" {
		return nil, errors.New("apple sign in not enabled")
	}

	c.appleMutex.RLock()
	if c.appleCertsRefreshAt < time.Now().UTC().Unix() {
		// Release the read lock and perform a certificate refresh.
		c.appleMutex.RUnlock()
		c.appleMutex.Lock()
		if c.appleCertsRefreshAt < time.Now().UTC().Unix() {
			var certs JwksCerts
			err := c.request(ctx, "apple cert", "https://appleid.apple.com/auth/keys", nil, &certs)
			if err != nil {
				c.appleMutex.Unlock()
				return nil, err
			}
			newCerts := make(map[string]*JwksCert, len(certs.Keys))
			for _, cert := range certs.Keys {
				// Check if certificate has all required fields.
				if cert.Kty == "" || cert.Kid == "" || cert.Use == "" || cert.Alg == "" || cert.N == "" || cert.E == "" {
					// Invalid certificate, skip it.
					continue
				}

				// Parse certificate's RSA Public Key encoded components.
				nBytes, err := base64.RawURLEncoding.DecodeString(cert.N)
				if err != nil {
					// Invalid modulus, skip certificate.
					continue
				}
				eBytes, err := base64.RawURLEncoding.DecodeString(cert.E)
				if err != nil {
					// Invalid exponent, skip certificate.
					continue
				}
				if len(eBytes) < 8 {
					// Pad the front of the exponent bytes with zeroes to ensure it's 8 bytes long.
					eBytes = append(make([]byte, 8-len(eBytes), 8), eBytes...)
				}
				var e uint64
				err = binary.Read(bytes.NewReader(eBytes), binary.BigEndian, &e)
				if err != nil {
					// Invalid exponent contents, skip certificate.
					continue
				}

				cert.key = &rsa.PublicKey{
					N: &big.Int{},
					E: int(e),
				}
				cert.key.N.SetBytes(nBytes)

				newCerts[cert.Kid] = cert
			}
			if len(newCerts) == 0 {
				c.appleMutex.Unlock()
				return nil, errors.New("error finding valid apple cert")
			}
			c.appleCerts = newCerts
			c.appleCertsRefreshAt = time.Now().UTC().Add(60 * time.Minute).Unix()
		}
		c.appleMutex.Unlock()
		c.appleMutex.RLock()
	}
	appleCerts := c.appleCerts
	c.appleMutex.RUnlock()

	// Try to parse and validate the JWT token.
	token, err := jwt.Parse(idToken, func(token *jwt.Token) (interface{}, error) {
		// Grab the token's "kid" (key id) claim and see if we have a JWK certificate that matches it.
		kid, ok := token.Header["kid"]
		if !ok {
			return nil, fmt.Errorf("missing kid claim: %v", kid)
		}
		kidString, ok := kid.(string)
		if !ok {
			return nil, fmt.Errorf("invalid kid claim: %v", kid)
		}
		cert, ok := appleCerts[kidString]
		if !ok {
			return nil, fmt.Errorf("invalid kid claim: %v", kid)
		}

		// Check the token signing algorithm and the certificate signing algorithm match.
		if token.Method.Alg() != cert.Alg {
			return nil, fmt.Errorf("invalid alg: %v, expected %v", token.Method.Alg(), cert.Alg)
		}

		claims := token.Claims.(jwt.MapClaims)

		// Verify the issuer.
		if !claims.VerifyIssuer("https://appleid.apple.com", true) {
			return nil, fmt.Errorf("unexpected issuer: %v", claims["iss"])
		}

		// Verify the audience matches the configured client ID.
		/*if !claims.VerifyAudience(bundleId, true) {
			return nil, fmt.Errorf("unexpected audience: %v", claims["aud"])
		}*/

		return cert.key, nil
	})

	// Check if verification attempt has failed.
	if err != nil {
		return nil, fmt.Errorf("apple id token invalid: %s", err.Error())
	} else if token == nil {
		return nil, fmt.Errorf("apple id token invalid")
	}

	// Extract the claims we need now that we know the token is valid.
	claims := token.Claims.(jwt.MapClaims)
	profile := &AppleProfile{}
	if v, ok := claims["sub"]; ok {
		if profile.ID, ok = v.(string); !ok {
			return nil, errors.New("apple id token sub field invalid")
		}
	} else {
		return nil, errors.New("apple id token sub field missing")
	}
	if v, ok := claims["email"]; ok {
		if profile.Email, ok = v.(string); !ok {
			return nil, errors.New("apple id token email field invalid")
		}
	}
	if v, ok := claims["email_verified"]; ok {
		switch val := v.(type) {
		case bool:
			profile.EmailVerified = val
		case string:
			vb, err := strconv.ParseBool(val)
			if err != nil {
				return nil, errors.New("apple id token email_verified field invalid")
			}
			profile.EmailVerified = vb
		default:
			return nil, errors.New("apple id token email_verified field unknown")
		}
	}

	return profile, nil
}

func (c *Client) CheckFacebookLimitedLoginToken(ctx context.Context, appId string, idToken string) (*FacebookProfile, error) {
	c.logger.Debug("Checking Facebook Limited Login", zap.String("idToken", idToken))

	//if appId == "" {
	//	return nil, errors.New("facebook limited login not enabled")
	//}

	c.facebookMutex.RLock()
	if c.facebookCertsRefreshAt < time.Now().UTC().Unix() {
		// Release the read lock and perform a certificate refresh.
		c.facebookMutex.RUnlock()
		c.facebookMutex.Lock()
		if c.facebookCertsRefreshAt < time.Now().UTC().Unix() {
			var certs JwksCerts
			err := c.request(ctx, "facebook cert", "https://www.facebook.com/.well-known/oauth/openid/jwks/", nil, &certs)
			if err != nil {
				c.facebookMutex.Unlock()
				return nil, err
			}
			newCerts := make(map[string]*JwksCert, len(certs.Keys))
			for _, cert := range certs.Keys {
				// Check if certificate has all required fields.
				if cert.Kty == "" || cert.Kid == "" || cert.Use == "" || cert.Alg == "" || cert.N == "" || cert.E == "" {
					// Invalid certificate, skip it.
					continue
				}

				// Parse certificate's RSA Public Key encoded components.
				nBytes, err := base64.RawURLEncoding.DecodeString(cert.N)
				if err != nil {
					// Invalid modulus, skip certificate.
					continue
				}
				eBytes, err := base64.RawURLEncoding.DecodeString(cert.E)
				if err != nil {
					// Invalid exponent, skip certificate.
					continue
				}
				if len(eBytes) < 8 {
					// Pad the front of the exponent bytes with zeroes to ensure it's 8 bytes long.
					eBytes = append(make([]byte, 8-len(eBytes), 8), eBytes...)
				}
				var e uint64
				err = binary.Read(bytes.NewReader(eBytes), binary.BigEndian, &e)
				if err != nil {
					// Invalid exponent contents, skip certificate.
					continue
				}

				cert.key = &rsa.PublicKey{
					N: &big.Int{},
					E: int(e),
				}
				cert.key.N.SetBytes(nBytes)

				newCerts[cert.Kid] = cert
			}
			if len(newCerts) == 0 {
				c.facebookMutex.Unlock()
				return nil, errors.New("error finding valid facebook cert")
			}
			c.facebookCerts = newCerts
			c.facebookCertsRefreshAt = time.Now().UTC().Add(60 * time.Minute).Unix()
		}
		c.facebookMutex.Unlock()
		c.facebookMutex.RLock()
	}
	facebookCerts := c.facebookCerts
	c.facebookMutex.RUnlock()

	// Try to parse and validate the JWT token.
	token, err := jwt.Parse(idToken, func(token *jwt.Token) (interface{}, error) {
		// Grab the token's "kid" (key id) claim and see if we have a JWK certificate that matches it.
		kid, ok := token.Header["kid"]
		if !ok {
			return nil, fmt.Errorf("missing kid claim: %v", kid)
		}
		kidString, ok := kid.(string)
		if !ok {
			return nil, fmt.Errorf("invalid kid claim: %v", kid)
		}
		cert, ok := facebookCerts[kidString]
		if !ok {
			return nil, fmt.Errorf("invalid kid claim: %v", kid)
		}

		// Check the token signing algorithm and the certificate signing algorithm match.
		if token.Method.Alg() != cert.Alg {
			return nil, fmt.Errorf("invalid alg: %v, expected %v", token.Method.Alg(), cert.Alg)
		}

		claims := token.Claims.(jwt.MapClaims)

		// Verify the issuer.
		switch iss, _ := claims["iss"].(string); iss {
		case "https://www.facebook.com":
			fallthrough
		case "https://facebook.com":
			break
		default:
			return nil, fmt.Errorf("unexpected issuer: %v", claims["iss"])
		}

		// Verify the audience matches the configured client ID.
		//if !claims.VerifyAudience(appId, true) {
		//	return nil, fmt.Errorf("unexpected audience: %v", claims["aud"])
		//}

		return cert.key, nil
	})

	// Check if verification attempt has failed.
	if token == nil || err != nil {
		return nil, errors.New("facebook limited login token invalid")
	}

	// Extract the claims we need now that we know the token is valid.
	claims := token.Claims.(jwt.MapClaims)
	profile := &FacebookProfile{}
	if v, ok := claims["sub"]; ok {
		if profile.ID, ok = v.(string); !ok {
			return nil, errors.New("facebook limited login token sub field invalid")
		}
	} else {
		return nil, errors.New("facebook limited login token sub field missing")
	}
	if v, ok := claims["name"]; ok {
		if profile.Name, ok = v.(string); !ok {
			return nil, errors.New("facebook limited login token name field invalid")
		}
	}
	if v, ok := claims["email"]; ok {
		if profile.Email, ok = v.(string); !ok {
			return nil, errors.New("facebook limited login token email field invalid")
		}
	}
	if v, ok := claims["picture"]; ok {
		if profile.Picture.Data.Url, ok = v.(string); !ok {
			return nil, errors.New("facebook limited login token picture field invalid")
		}
	}

	return profile, nil
}

func (c *Client) request(ctx context.Context, provider, path string, headers map[string]string, to interface{}) error {
	body, err := c.requestRaw(ctx, provider, path, headers)
	if err != nil {
		return err
	}
	err = json.Unmarshal(body, to)
	if err != nil {
		c.logger.Warn("error decoding social response", zap.String("provider", provider), zap.Error(err))
		return err
	}
	return nil
}

func (c *Client) requestRaw(ctx context.Context, provider, path string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequest("GET", path, nil)
	if err != nil {
		c.logger.Warn("error constructing social request", zap.String("provider", provider), zap.Error(err))
		return nil, err
	}
	req = req.WithContext(ctx)
	for k, v := range headers {
		req.Header.Add(k, v)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.logger.Warn("error executing social request", zap.String("provider", provider), zap.Error(err))
		return nil, err
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		c.logger.Warn("error reading social response", zap.String("provider", provider), zap.Error(err))
		return nil, err
	}
	switch resp.StatusCode {
	case 200:
		return body, nil
	case 401:
		return nil, &UnauthorizedError{Err: fmt.Errorf("%v url: %q, status code: %q, body: %q", provider, path, resp.StatusCode, body)}
	default:
		c.logger.Warn("error response code from social request", zap.String("provider", provider), zap.Int("code", resp.StatusCode), zap.String("body", string(body)))
		return nil, fmt.Errorf("%v url: %q, status code: %q, body: %q", provider, path, resp.StatusCode, body)
	}
}

type UnauthorizedError struct {
	Err error
}

func (e *UnauthorizedError) Error() string { return e.Err.Error() }

func (e *UnauthorizedError) Unwrap() error { return e.Err }
