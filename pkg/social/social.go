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

package social

import (
	"bytes"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io/ioutil"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client is responsible for making calls to different providers
type Client struct {
	client           *http.Client
	gamecenterCaCert *x509.Certificate
}

// FacebookProfile is an abbreviated version of a Facebook profile.
type FacebookProfile struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Email    string  `json:"email"`
	Gender   string  `json:"gender"`
	Locale   string  `json:"locale"`
	Timezone float64 `json:"timezone"`
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
	Data   []FacebookProfile `json:"data"`
	Paging facebookPaging    `json:"paging"`
}

// GoogleProfile is an abbreviated version of a Google profile.
type GoogleProfile struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Gender string `json:"gender"`
	Locale string `json:"locale"`
}

// SteamProfile is an abbreviated version of a Steam profile.
type SteamProfile struct {
	SteamID uint64 `json:"steamid"`
}

// NewClient creates a new Social Client
func NewClient(timeout time.Duration) *Client {
	// From https://knowledge.symantec.com/support/code-signing-support/index?page=content&actp=CROSSLINK&id=AR2170
	// Issued to: Symantec Class 3 SHA256 Code Signing CA
	// Issued by: VeriSign Class 3 Public Primary Certification Authority - G5
	// Valid from: 12/9/2013 to 12/9/2023
	// Serial Number: 3d 78 d7 f9 76 49 60 b2 61 7d f4 f0 1e ca 86 2a
	caData := []byte(`-----BEGIN CERTIFICATE-----
MIIFWTCCBEGgAwIBAgIQPXjX+XZJYLJhffTwHsqGKjANBgkqhkiG9w0BAQsFADCB
yjELMAkGA1UEBhMCVVMxFzAVBgNVBAoTDlZlcmlTaWduLCBJbmMuMR8wHQYDVQQL
ExZWZXJpU2lnbiBUcnVzdCBOZXR3b3JrMTowOAYDVQQLEzEoYykgMjAwNiBWZXJp
U2lnbiwgSW5jLiAtIEZvciBhdXRob3JpemVkIHVzZSBvbmx5MUUwQwYDVQQDEzxW
ZXJpU2lnbiBDbGFzcyAzIFB1YmxpYyBQcmltYXJ5IENlcnRpZmljYXRpb24gQXV0
aG9yaXR5IC0gRzUwHhcNMTMxMjEwMDAwMDAwWhcNMjMxMjA5MjM1OTU5WjB/MQsw
CQYDVQQGEwJVUzEdMBsGA1UEChMUU3ltYW50ZWMgQ29ycG9yYXRpb24xHzAdBgNV
BAsTFlN5bWFudGVjIFRydXN0IE5ldHdvcmsxMDAuBgNVBAMTJ1N5bWFudGVjIENs
YXNzIDMgU0hBMjU2IENvZGUgU2lnbmluZyBDQTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAJeDHgAWryyx0gjE12iTUWAecfbiR7TbWE0jYmq0v1obUfej
DRh3aLvYNqsvIVDanvPnXydOC8KXyAlwk6naXA1OpA2RoLTsFM6RclQuzqPbROlS
Gz9BPMpK5KrA6DmrU8wh0MzPf5vmwsxYaoIV7j02zxzFlwckjvF7vjEtPW7ctZlC
n0thlV8ccO4XfduL5WGJeMdoG68ReBqYrsRVR1PZszLWoQ5GQMWXkorRU6eZW4U1
V9Pqk2JhIArHMHckEU1ig7a6e2iCMe5lyt/51Y2yNdyMK29qclxghJzyDJRewFZS
AEjM0/ilfd4v1xPkOKiE1Ua4E4bCG53qWjjdm9sCAwEAAaOCAYMwggF/MC8GCCsG
AQUFBwEBBCMwITAfBggrBgEFBQcwAYYTaHR0cDovL3MyLnN5bWNiLmNvbTASBgNV
HRMBAf8ECDAGAQH/AgEAMGwGA1UdIARlMGMwYQYLYIZIAYb4RQEHFwMwUjAmBggr
BgEFBQcCARYaaHR0cDovL3d3dy5zeW1hdXRoLmNvbS9jcHMwKAYIKwYBBQUHAgIw
HBoaaHR0cDovL3d3dy5zeW1hdXRoLmNvbS9ycGEwMAYDVR0fBCkwJzAloCOgIYYf
aHR0cDovL3MxLnN5bWNiLmNvbS9wY2EzLWc1LmNybDAdBgNVHSUEFjAUBggrBgEF
BQcDAgYIKwYBBQUHAwMwDgYDVR0PAQH/BAQDAgEGMCkGA1UdEQQiMCCkHjAcMRow
GAYDVQQDExFTeW1hbnRlY1BLSS0xLTU2NzAdBgNVHQ4EFgQUljtT8Hkzl699g+8u
K8zKt4YecmYwHwYDVR0jBBgwFoAUf9Nlp8Ld7LvwMAnzQzn6Aq8zMTMwDQYJKoZI
hvcNAQELBQADggEBABOFGh5pqTf3oL2kr34dYVP+nYxeDKZ1HngXI9397BoDVTn7
cZXHZVqnjjDSRFph23Bv2iEFwi5zuknx0ZP+XcnNXgPgiZ4/dB7X9ziLqdbPuzUv
M1ioklbRyE07guZ5hBb8KLCxR/Mdoj7uh9mmf6RWpT+thC4p3ny8qKqjPQQB6rqT
og5QIikXTIfkOhFf1qQliZsFay+0yQFMJ3sLrBkFIqBgFT/ayftNTI/7cmd3/SeU
x7o1DohJ/o39KK9KEr0Ns5cF3kQMFfo2KwPcwVAB8aERXRTl4r0nS1S+K4ReD6bD
dAUK75fDiSKxH3fzvc1D1PFMqT+1i4SvZPLQFCE=
-----END CERTIFICATE-----`)
	caBlock, _ := pem.Decode(caData)
	caCert, _ := x509.ParseCertificate(caBlock.Bytes)
	return &Client{
		client:           &http.Client{Timeout: timeout},
		gamecenterCaCert: caCert,
	}
}

// GetFacebookProfile retrieves the user's Facebook Profile given the accessToken
func (c *Client) GetFacebookProfile(accessToken string) (*FacebookProfile, error) {
	path := "https://graph.facebook.com/v2.8/me?access_token=" + url.QueryEscape(accessToken) +
		"&fields=" + url.QueryEscape("name,email,gender,locale,timezone")
	var profile FacebookProfile
	err := c.request("facebook profile", path, map[string]string{}, &profile)
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// GetFacebookFriends queries the Facebook Graph.
// Token is expected to also have the "user_friends" permission.
func (c *Client) GetFacebookFriends(accessToken string) ([]FacebookProfile, error) {
	friends := make([]FacebookProfile, 0)
	after := ""
	for {
		// In FB Graph API 2.0+ this only returns friends that also use the same app.
		path := "https://graph.facebook.com/v2.8/me/friends?access_token=" + url.QueryEscape(accessToken)
		if after != "" {
			path += "&after=" + after
		}
		var currentFriends facebookFriends
		err := c.request("facebook friends", path, map[string]string{}, &currentFriends)
		if err != nil {
			return friends, err
		}
		friends = append(friends, currentFriends.Data...)
		// When there are no more items, this will be "" and end the loop
		if currentFriends.Paging.Next == "" {
			return friends, nil
		}
		after = currentFriends.Paging.Cursors.After
	}
}

// GetGoogleProfile retrieves the user's Google Profile given the accessToken
func (c *Client) GetGoogleProfile(accessToken string) (*GoogleProfile, error) {
	path := "https://www.googleapis.com/oauth2/v2/userinfo?alt=json"
	var profile GoogleProfile
	err := c.request("google profile", path, map[string]string{"Authorization": "Bearer " + accessToken}, &profile)
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// CheckGameCenterID checks to see validity of the GameCenter playerID
func (c *Client) CheckGameCenterID(playerID string, bundleID string, timestamp int64, salt string, signature string, publicKeyURL string) (bool, error) {
	pub, err := url.Parse(publicKeyURL)
	if err != nil {
		return false, err
	} else if pub.Scheme != "https" {
		return false, errors.New("gamecenter check error: invalid public key url scheme")
	} else if pub.Path == "" || pub.Path == "/" {
		return false, errors.New("gamecenter check error: invalid public key url path")
	} else if !strings.HasSuffix(pub.Host, ".apple.com") {
		return false, errors.New("gamecenter check error: invalid public key url domain")
	}
	slt, err := base64.StdEncoding.DecodeString(salt)
	if err != nil {
		return false, err
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return false, err
	}

	body, err := c.requestRaw("apple public key url", publicKeyURL, map[string]string{})
	if err != nil {
		return false, err
	}

	// Parse the public key, check issuer, check signature.
	pubBlock, _ := pem.Decode([]byte(body))
	if pubBlock == nil {
		return false, errors.New("gamecenter check error: error decoding public key")
	}
	pubCert, err := x509.ParseCertificate(pubBlock.Bytes)
	if err != nil {
		return false, err
	}
	err = pubCert.CheckSignatureFrom(c.gamecenterCaCert)
	if err != nil {
		return false, err
	}
	ts := make([]byte, 8)
	binary.LittleEndian.PutUint64(ts, uint64(timestamp))
	payload := [][]byte{[]byte(playerID), []byte(bundleID), ts, slt}
	err = pubCert.CheckSignature(x509.SHA256WithRSA, bytes.Join(payload, make([]byte, 0)), sig)
	if err != nil {
		return false, err
	}
	return true, nil
}

// GetSteamProfile retrieves the user's Steam Profile.
// Key and App ID should be configured at the application level.
// See: https://partner.steamgames.com/documentation/auth#client_to_backend_webapi
func (c *Client) GetSteamProfile(publisherKey string, appID int, ticket string) (*SteamProfile, error) {
	path := "https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v0001/?format=json" +
		"&key=" + url.QueryEscape(publisherKey) + "&appid=" + strconv.Itoa(appID) + "&ticket=" + url.QueryEscape(ticket)
	var profile SteamProfile
	err := c.request("steam profile", path, map[string]string{}, &profile)
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

func (c *Client) request(provider, path string, headers map[string]string, to interface{}) error {
	body, err := c.requestRaw(provider, path, headers)
	if err != nil {
		return err
	}
	err = json.Unmarshal(body, to)
	if err != nil {
		return err
	}
	return nil
}

func (c *Client) requestRaw(provider, path string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Add(k, v)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	body, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, errors.New(provider + " error")
	}
	return body, nil
}
