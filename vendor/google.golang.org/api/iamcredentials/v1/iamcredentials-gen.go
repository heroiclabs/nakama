// Package iamcredentials provides access to the IAM Service Account Credentials API.
//
// See https://cloud.google.com/iam/docs/creating-short-lived-service-account-credentials
//
// Usage example:
//
//   import "google.golang.org/api/iamcredentials/v1"
//   ...
//   iamcredentialsService, err := iamcredentials.New(oauthHttpClient)
package iamcredentials // import "google.golang.org/api/iamcredentials/v1"

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	context "golang.org/x/net/context"
	ctxhttp "golang.org/x/net/context/ctxhttp"
	gensupport "google.golang.org/api/gensupport"
	googleapi "google.golang.org/api/googleapi"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Always reference these packages, just in case the auto-generated code
// below doesn't.
var _ = bytes.NewBuffer
var _ = strconv.Itoa
var _ = fmt.Sprintf
var _ = json.NewDecoder
var _ = io.Copy
var _ = url.Parse
var _ = gensupport.MarshalJSON
var _ = googleapi.Version
var _ = errors.New
var _ = strings.Replace
var _ = context.Canceled
var _ = ctxhttp.Do

const apiId = "iamcredentials:v1"
const apiName = "iamcredentials"
const apiVersion = "v1"
const basePath = "https://iamcredentials.googleapis.com/"

// OAuth2 scopes used by this API.
const (
	// View and manage your data across Google Cloud Platform services
	CloudPlatformScope = "https://www.googleapis.com/auth/cloud-platform"
)

func New(client *http.Client) (*Service, error) {
	if client == nil {
		return nil, errors.New("client is nil")
	}
	s := &Service{client: client, BasePath: basePath}
	s.Projects = NewProjectsService(s)
	return s, nil
}

type Service struct {
	client    *http.Client
	BasePath  string // API endpoint base URL
	UserAgent string // optional additional User-Agent fragment

	Projects *ProjectsService
}

func (s *Service) userAgent() string {
	if s.UserAgent == "" {
		return googleapi.UserAgent
	}
	return googleapi.UserAgent + " " + s.UserAgent
}

func NewProjectsService(s *Service) *ProjectsService {
	rs := &ProjectsService{s: s}
	rs.ServiceAccounts = NewProjectsServiceAccountsService(s)
	return rs
}

type ProjectsService struct {
	s *Service

	ServiceAccounts *ProjectsServiceAccountsService
}

func NewProjectsServiceAccountsService(s *Service) *ProjectsServiceAccountsService {
	rs := &ProjectsServiceAccountsService{s: s}
	return rs
}

type ProjectsServiceAccountsService struct {
	s *Service
}

type GenerateAccessTokenRequest struct {
	// Delegates: The sequence of service accounts in a delegation chain.
	// Each service
	// account must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on its next service account in the chain. The last service account in
	// the
	// chain must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on the service account that is specified in the `name` field of
	// the
	// request.
	//
	// The delegates must have the following
	// format:
	// `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`
	Delegates []string `json:"delegates,omitempty"`

	// Lifetime: The desired lifetime duration of the access token in
	// seconds.
	// Must be set to a value less than or equal to 3600 (1 hour). If a
	// value is
	// not specified, the token's lifetime will be set to a default value of
	// one
	// hour.
	Lifetime string `json:"lifetime,omitempty"`

	// Scope: Code to identify ApiScope (OAuth scope to be precise) to be
	// included in the
	// OAuth token.
	// See https://developers.google.com/identity/protocols/googlescopes for
	// more
	// information.
	// At least one value required.
	Scope []string `json:"scope,omitempty"`

	// ForceSendFields is a list of field names (e.g. "Delegates") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "Delegates") to include in
	// API requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *GenerateAccessTokenRequest) MarshalJSON() ([]byte, error) {
	type NoMethod GenerateAccessTokenRequest
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type GenerateAccessTokenResponse struct {
	// AccessToken: The OAuth 2.0 access token.
	AccessToken string `json:"accessToken,omitempty"`

	// ExpireTime: Token expiration time.
	ExpireTime string `json:"expireTime,omitempty"`

	// ServerResponse contains the HTTP response code and headers from the
	// server.
	googleapi.ServerResponse `json:"-"`

	// ForceSendFields is a list of field names (e.g. "AccessToken") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "AccessToken") to include
	// in API requests with the JSON null value. By default, fields with
	// empty values are omitted from API requests. However, any field with
	// an empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *GenerateAccessTokenResponse) MarshalJSON() ([]byte, error) {
	type NoMethod GenerateAccessTokenResponse
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type GenerateIdTokenRequest struct {
	// Audience: The audience for the token, such as the API or account that
	// this token
	// grants access to.
	Audience string `json:"audience,omitempty"`

	// Delegates: The sequence of service accounts in a delegation chain.
	// Each service
	// account must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on its next service account in the chain. The last service account in
	// the
	// chain must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on the service account that is specified in the `name` field of
	// the
	// request.
	//
	// The delegates must have the following
	// format:
	// `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`
	Delegates []string `json:"delegates,omitempty"`

	// IncludeEmail: Include the service account email in the token. If set
	// to `true`, the
	// token will contain `email` and `email_verified` claims.
	IncludeEmail bool `json:"includeEmail,omitempty"`

	// ForceSendFields is a list of field names (e.g. "Audience") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "Audience") to include in
	// API requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *GenerateIdTokenRequest) MarshalJSON() ([]byte, error) {
	type NoMethod GenerateIdTokenRequest
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type GenerateIdTokenResponse struct {
	// Token: The OpenId Connect ID token.
	Token string `json:"token,omitempty"`

	// ServerResponse contains the HTTP response code and headers from the
	// server.
	googleapi.ServerResponse `json:"-"`

	// ForceSendFields is a list of field names (e.g. "Token") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "Token") to include in API
	// requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *GenerateIdTokenResponse) MarshalJSON() ([]byte, error) {
	type NoMethod GenerateIdTokenResponse
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type SignBlobRequest struct {
	// Delegates: The sequence of service accounts in a delegation chain.
	// Each service
	// account must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on its next service account in the chain. The last service account in
	// the
	// chain must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on the service account that is specified in the `name` field of
	// the
	// request.
	//
	// The delegates must have the following
	// format:
	// `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`
	Delegates []string `json:"delegates,omitempty"`

	// Payload: The bytes to sign.
	Payload string `json:"payload,omitempty"`

	// ForceSendFields is a list of field names (e.g. "Delegates") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "Delegates") to include in
	// API requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *SignBlobRequest) MarshalJSON() ([]byte, error) {
	type NoMethod SignBlobRequest
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type SignBlobResponse struct {
	// KeyId: The ID of the key used to sign the blob.
	KeyId string `json:"keyId,omitempty"`

	// SignedBlob: The signed blob.
	SignedBlob string `json:"signedBlob,omitempty"`

	// ServerResponse contains the HTTP response code and headers from the
	// server.
	googleapi.ServerResponse `json:"-"`

	// ForceSendFields is a list of field names (e.g. "KeyId") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "KeyId") to include in API
	// requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *SignBlobResponse) MarshalJSON() ([]byte, error) {
	type NoMethod SignBlobResponse
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type SignJwtRequest struct {
	// Delegates: The sequence of service accounts in a delegation chain.
	// Each service
	// account must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on its next service account in the chain. The last service account in
	// the
	// chain must be granted the `roles/iam.serviceAccountTokenCreator`
	// role
	// on the service account that is specified in the `name` field of
	// the
	// request.
	//
	// The delegates must have the following
	// format:
	// `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`
	Delegates []string `json:"delegates,omitempty"`

	// Payload: The JWT payload to sign: a JSON object that contains a JWT
	// Claims Set.
	Payload string `json:"payload,omitempty"`

	// ForceSendFields is a list of field names (e.g. "Delegates") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "Delegates") to include in
	// API requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *SignJwtRequest) MarshalJSON() ([]byte, error) {
	type NoMethod SignJwtRequest
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

type SignJwtResponse struct {
	// KeyId: The ID of the key used to sign the JWT.
	KeyId string `json:"keyId,omitempty"`

	// SignedJwt: The signed JWT.
	SignedJwt string `json:"signedJwt,omitempty"`

	// ServerResponse contains the HTTP response code and headers from the
	// server.
	googleapi.ServerResponse `json:"-"`

	// ForceSendFields is a list of field names (e.g. "KeyId") to
	// unconditionally include in API requests. By default, fields with
	// empty values are omitted from API requests. However, any non-pointer,
	// non-interface field appearing in ForceSendFields will be sent to the
	// server regardless of whether the field is empty or not. This may be
	// used to include empty fields in Patch requests.
	ForceSendFields []string `json:"-"`

	// NullFields is a list of field names (e.g. "KeyId") to include in API
	// requests with the JSON null value. By default, fields with empty
	// values are omitted from API requests. However, any field with an
	// empty value appearing in NullFields will be sent to the server as
	// null. It is an error if a field in this list has a non-empty value.
	// This may be used to include null fields in Patch requests.
	NullFields []string `json:"-"`
}

func (s *SignJwtResponse) MarshalJSON() ([]byte, error) {
	type NoMethod SignJwtResponse
	raw := NoMethod(*s)
	return gensupport.MarshalJSON(raw, s.ForceSendFields, s.NullFields)
}

// method id "iamcredentials.projects.serviceAccounts.generateAccessToken":

type ProjectsServiceAccountsGenerateAccessTokenCall struct {
	s                          *Service
	name                       string
	generateaccesstokenrequest *GenerateAccessTokenRequest
	urlParams_                 gensupport.URLParams
	ctx_                       context.Context
	header_                    http.Header
}

// GenerateAccessToken: Generates an OAuth 2.0 access token for a
// service account.
func (r *ProjectsServiceAccountsService) GenerateAccessToken(name string, generateaccesstokenrequest *GenerateAccessTokenRequest) *ProjectsServiceAccountsGenerateAccessTokenCall {
	c := &ProjectsServiceAccountsGenerateAccessTokenCall{s: r.s, urlParams_: make(gensupport.URLParams)}
	c.name = name
	c.generateaccesstokenrequest = generateaccesstokenrequest
	return c
}

// Fields allows partial responses to be retrieved. See
// https://developers.google.com/gdata/docs/2.0/basics#PartialResponse
// for more information.
func (c *ProjectsServiceAccountsGenerateAccessTokenCall) Fields(s ...googleapi.Field) *ProjectsServiceAccountsGenerateAccessTokenCall {
	c.urlParams_.Set("fields", googleapi.CombineFields(s))
	return c
}

// Context sets the context to be used in this call's Do method. Any
// pending HTTP request will be aborted if the provided context is
// canceled.
func (c *ProjectsServiceAccountsGenerateAccessTokenCall) Context(ctx context.Context) *ProjectsServiceAccountsGenerateAccessTokenCall {
	c.ctx_ = ctx
	return c
}

// Header returns an http.Header that can be modified by the caller to
// add HTTP headers to the request.
func (c *ProjectsServiceAccountsGenerateAccessTokenCall) Header() http.Header {
	if c.header_ == nil {
		c.header_ = make(http.Header)
	}
	return c.header_
}

func (c *ProjectsServiceAccountsGenerateAccessTokenCall) doRequest(alt string) (*http.Response, error) {
	reqHeaders := make(http.Header)
	for k, v := range c.header_ {
		reqHeaders[k] = v
	}
	reqHeaders.Set("User-Agent", c.s.userAgent())
	var body io.Reader = nil
	body, err := googleapi.WithoutDataWrapper.JSONReader(c.generateaccesstokenrequest)
	if err != nil {
		return nil, err
	}
	reqHeaders.Set("Content-Type", "application/json")
	c.urlParams_.Set("alt", alt)
	urls := googleapi.ResolveRelative(c.s.BasePath, "v1/{+name}:generateAccessToken")
	urls += "?" + c.urlParams_.Encode()
	req, _ := http.NewRequest("POST", urls, body)
	req.Header = reqHeaders
	googleapi.Expand(req.URL, map[string]string{
		"name": c.name,
	})
	return gensupport.SendRequest(c.ctx_, c.s.client, req)
}

// Do executes the "iamcredentials.projects.serviceAccounts.generateAccessToken" call.
// Exactly one of *GenerateAccessTokenResponse or error will be non-nil.
// Any non-2xx status code is an error. Response headers are in either
// *GenerateAccessTokenResponse.ServerResponse.Header or (if a response
// was returned at all) in error.(*googleapi.Error).Header. Use
// googleapi.IsNotModified to check whether the returned error was
// because http.StatusNotModified was returned.
func (c *ProjectsServiceAccountsGenerateAccessTokenCall) Do(opts ...googleapi.CallOption) (*GenerateAccessTokenResponse, error) {
	gensupport.SetOptions(c.urlParams_, opts...)
	res, err := c.doRequest("json")
	if res != nil && res.StatusCode == http.StatusNotModified {
		if res.Body != nil {
			res.Body.Close()
		}
		return nil, &googleapi.Error{
			Code:   res.StatusCode,
			Header: res.Header,
		}
	}
	if err != nil {
		return nil, err
	}
	defer googleapi.CloseBody(res)
	if err := googleapi.CheckResponse(res); err != nil {
		return nil, err
	}
	ret := &GenerateAccessTokenResponse{
		ServerResponse: googleapi.ServerResponse{
			Header:         res.Header,
			HTTPStatusCode: res.StatusCode,
		},
	}
	target := &ret
	if err := gensupport.DecodeResponse(target, res); err != nil {
		return nil, err
	}
	return ret, nil
	// {
	//   "description": "Generates an OAuth 2.0 access token for a service account.",
	//   "flatPath": "v1/projects/{projectsId}/serviceAccounts/{serviceAccountsId}:generateAccessToken",
	//   "httpMethod": "POST",
	//   "id": "iamcredentials.projects.serviceAccounts.generateAccessToken",
	//   "parameterOrder": [
	//     "name"
	//   ],
	//   "parameters": {
	//     "name": {
	//       "description": "The resource name of the service account for which the credentials\nare requested, in the following format:\n`projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`.\nUsing `-` as a wildcard for the project will infer the project from\nthe account.",
	//       "location": "path",
	//       "pattern": "^projects/[^/]+/serviceAccounts/[^/]+$",
	//       "required": true,
	//       "type": "string"
	//     }
	//   },
	//   "path": "v1/{+name}:generateAccessToken",
	//   "request": {
	//     "$ref": "GenerateAccessTokenRequest"
	//   },
	//   "response": {
	//     "$ref": "GenerateAccessTokenResponse"
	//   },
	//   "scopes": [
	//     "https://www.googleapis.com/auth/cloud-platform"
	//   ]
	// }

}

// method id "iamcredentials.projects.serviceAccounts.generateIdToken":

type ProjectsServiceAccountsGenerateIdTokenCall struct {
	s                      *Service
	name                   string
	generateidtokenrequest *GenerateIdTokenRequest
	urlParams_             gensupport.URLParams
	ctx_                   context.Context
	header_                http.Header
}

// GenerateIdToken: Generates an OpenID Connect ID token for a service
// account.
func (r *ProjectsServiceAccountsService) GenerateIdToken(name string, generateidtokenrequest *GenerateIdTokenRequest) *ProjectsServiceAccountsGenerateIdTokenCall {
	c := &ProjectsServiceAccountsGenerateIdTokenCall{s: r.s, urlParams_: make(gensupport.URLParams)}
	c.name = name
	c.generateidtokenrequest = generateidtokenrequest
	return c
}

// Fields allows partial responses to be retrieved. See
// https://developers.google.com/gdata/docs/2.0/basics#PartialResponse
// for more information.
func (c *ProjectsServiceAccountsGenerateIdTokenCall) Fields(s ...googleapi.Field) *ProjectsServiceAccountsGenerateIdTokenCall {
	c.urlParams_.Set("fields", googleapi.CombineFields(s))
	return c
}

// Context sets the context to be used in this call's Do method. Any
// pending HTTP request will be aborted if the provided context is
// canceled.
func (c *ProjectsServiceAccountsGenerateIdTokenCall) Context(ctx context.Context) *ProjectsServiceAccountsGenerateIdTokenCall {
	c.ctx_ = ctx
	return c
}

// Header returns an http.Header that can be modified by the caller to
// add HTTP headers to the request.
func (c *ProjectsServiceAccountsGenerateIdTokenCall) Header() http.Header {
	if c.header_ == nil {
		c.header_ = make(http.Header)
	}
	return c.header_
}

func (c *ProjectsServiceAccountsGenerateIdTokenCall) doRequest(alt string) (*http.Response, error) {
	reqHeaders := make(http.Header)
	for k, v := range c.header_ {
		reqHeaders[k] = v
	}
	reqHeaders.Set("User-Agent", c.s.userAgent())
	var body io.Reader = nil
	body, err := googleapi.WithoutDataWrapper.JSONReader(c.generateidtokenrequest)
	if err != nil {
		return nil, err
	}
	reqHeaders.Set("Content-Type", "application/json")
	c.urlParams_.Set("alt", alt)
	urls := googleapi.ResolveRelative(c.s.BasePath, "v1/{+name}:generateIdToken")
	urls += "?" + c.urlParams_.Encode()
	req, _ := http.NewRequest("POST", urls, body)
	req.Header = reqHeaders
	googleapi.Expand(req.URL, map[string]string{
		"name": c.name,
	})
	return gensupport.SendRequest(c.ctx_, c.s.client, req)
}

// Do executes the "iamcredentials.projects.serviceAccounts.generateIdToken" call.
// Exactly one of *GenerateIdTokenResponse or error will be non-nil. Any
// non-2xx status code is an error. Response headers are in either
// *GenerateIdTokenResponse.ServerResponse.Header or (if a response was
// returned at all) in error.(*googleapi.Error).Header. Use
// googleapi.IsNotModified to check whether the returned error was
// because http.StatusNotModified was returned.
func (c *ProjectsServiceAccountsGenerateIdTokenCall) Do(opts ...googleapi.CallOption) (*GenerateIdTokenResponse, error) {
	gensupport.SetOptions(c.urlParams_, opts...)
	res, err := c.doRequest("json")
	if res != nil && res.StatusCode == http.StatusNotModified {
		if res.Body != nil {
			res.Body.Close()
		}
		return nil, &googleapi.Error{
			Code:   res.StatusCode,
			Header: res.Header,
		}
	}
	if err != nil {
		return nil, err
	}
	defer googleapi.CloseBody(res)
	if err := googleapi.CheckResponse(res); err != nil {
		return nil, err
	}
	ret := &GenerateIdTokenResponse{
		ServerResponse: googleapi.ServerResponse{
			Header:         res.Header,
			HTTPStatusCode: res.StatusCode,
		},
	}
	target := &ret
	if err := gensupport.DecodeResponse(target, res); err != nil {
		return nil, err
	}
	return ret, nil
	// {
	//   "description": "Generates an OpenID Connect ID token for a service account.",
	//   "flatPath": "v1/projects/{projectsId}/serviceAccounts/{serviceAccountsId}:generateIdToken",
	//   "httpMethod": "POST",
	//   "id": "iamcredentials.projects.serviceAccounts.generateIdToken",
	//   "parameterOrder": [
	//     "name"
	//   ],
	//   "parameters": {
	//     "name": {
	//       "description": "The resource name of the service account for which the credentials\nare requested, in the following format:\n`projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`.\nUsing `-` as a wildcard for the project will infer the project from\nthe account.",
	//       "location": "path",
	//       "pattern": "^projects/[^/]+/serviceAccounts/[^/]+$",
	//       "required": true,
	//       "type": "string"
	//     }
	//   },
	//   "path": "v1/{+name}:generateIdToken",
	//   "request": {
	//     "$ref": "GenerateIdTokenRequest"
	//   },
	//   "response": {
	//     "$ref": "GenerateIdTokenResponse"
	//   },
	//   "scopes": [
	//     "https://www.googleapis.com/auth/cloud-platform"
	//   ]
	// }

}

// method id "iamcredentials.projects.serviceAccounts.signBlob":

type ProjectsServiceAccountsSignBlobCall struct {
	s               *Service
	name            string
	signblobrequest *SignBlobRequest
	urlParams_      gensupport.URLParams
	ctx_            context.Context
	header_         http.Header
}

// SignBlob: Signs a blob using a service account's system-managed
// private key.
func (r *ProjectsServiceAccountsService) SignBlob(name string, signblobrequest *SignBlobRequest) *ProjectsServiceAccountsSignBlobCall {
	c := &ProjectsServiceAccountsSignBlobCall{s: r.s, urlParams_: make(gensupport.URLParams)}
	c.name = name
	c.signblobrequest = signblobrequest
	return c
}

// Fields allows partial responses to be retrieved. See
// https://developers.google.com/gdata/docs/2.0/basics#PartialResponse
// for more information.
func (c *ProjectsServiceAccountsSignBlobCall) Fields(s ...googleapi.Field) *ProjectsServiceAccountsSignBlobCall {
	c.urlParams_.Set("fields", googleapi.CombineFields(s))
	return c
}

// Context sets the context to be used in this call's Do method. Any
// pending HTTP request will be aborted if the provided context is
// canceled.
func (c *ProjectsServiceAccountsSignBlobCall) Context(ctx context.Context) *ProjectsServiceAccountsSignBlobCall {
	c.ctx_ = ctx
	return c
}

// Header returns an http.Header that can be modified by the caller to
// add HTTP headers to the request.
func (c *ProjectsServiceAccountsSignBlobCall) Header() http.Header {
	if c.header_ == nil {
		c.header_ = make(http.Header)
	}
	return c.header_
}

func (c *ProjectsServiceAccountsSignBlobCall) doRequest(alt string) (*http.Response, error) {
	reqHeaders := make(http.Header)
	for k, v := range c.header_ {
		reqHeaders[k] = v
	}
	reqHeaders.Set("User-Agent", c.s.userAgent())
	var body io.Reader = nil
	body, err := googleapi.WithoutDataWrapper.JSONReader(c.signblobrequest)
	if err != nil {
		return nil, err
	}
	reqHeaders.Set("Content-Type", "application/json")
	c.urlParams_.Set("alt", alt)
	urls := googleapi.ResolveRelative(c.s.BasePath, "v1/{+name}:signBlob")
	urls += "?" + c.urlParams_.Encode()
	req, _ := http.NewRequest("POST", urls, body)
	req.Header = reqHeaders
	googleapi.Expand(req.URL, map[string]string{
		"name": c.name,
	})
	return gensupport.SendRequest(c.ctx_, c.s.client, req)
}

// Do executes the "iamcredentials.projects.serviceAccounts.signBlob" call.
// Exactly one of *SignBlobResponse or error will be non-nil. Any
// non-2xx status code is an error. Response headers are in either
// *SignBlobResponse.ServerResponse.Header or (if a response was
// returned at all) in error.(*googleapi.Error).Header. Use
// googleapi.IsNotModified to check whether the returned error was
// because http.StatusNotModified was returned.
func (c *ProjectsServiceAccountsSignBlobCall) Do(opts ...googleapi.CallOption) (*SignBlobResponse, error) {
	gensupport.SetOptions(c.urlParams_, opts...)
	res, err := c.doRequest("json")
	if res != nil && res.StatusCode == http.StatusNotModified {
		if res.Body != nil {
			res.Body.Close()
		}
		return nil, &googleapi.Error{
			Code:   res.StatusCode,
			Header: res.Header,
		}
	}
	if err != nil {
		return nil, err
	}
	defer googleapi.CloseBody(res)
	if err := googleapi.CheckResponse(res); err != nil {
		return nil, err
	}
	ret := &SignBlobResponse{
		ServerResponse: googleapi.ServerResponse{
			Header:         res.Header,
			HTTPStatusCode: res.StatusCode,
		},
	}
	target := &ret
	if err := gensupport.DecodeResponse(target, res); err != nil {
		return nil, err
	}
	return ret, nil
	// {
	//   "description": "Signs a blob using a service account's system-managed private key.",
	//   "flatPath": "v1/projects/{projectsId}/serviceAccounts/{serviceAccountsId}:signBlob",
	//   "httpMethod": "POST",
	//   "id": "iamcredentials.projects.serviceAccounts.signBlob",
	//   "parameterOrder": [
	//     "name"
	//   ],
	//   "parameters": {
	//     "name": {
	//       "description": "The resource name of the service account for which the credentials\nare requested, in the following format:\n`projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`.\nUsing `-` as a wildcard for the project will infer the project from\nthe account.",
	//       "location": "path",
	//       "pattern": "^projects/[^/]+/serviceAccounts/[^/]+$",
	//       "required": true,
	//       "type": "string"
	//     }
	//   },
	//   "path": "v1/{+name}:signBlob",
	//   "request": {
	//     "$ref": "SignBlobRequest"
	//   },
	//   "response": {
	//     "$ref": "SignBlobResponse"
	//   },
	//   "scopes": [
	//     "https://www.googleapis.com/auth/cloud-platform"
	//   ]
	// }

}

// method id "iamcredentials.projects.serviceAccounts.signJwt":

type ProjectsServiceAccountsSignJwtCall struct {
	s              *Service
	name           string
	signjwtrequest *SignJwtRequest
	urlParams_     gensupport.URLParams
	ctx_           context.Context
	header_        http.Header
}

// SignJwt: Signs a JWT using a service account's system-managed private
// key.
func (r *ProjectsServiceAccountsService) SignJwt(name string, signjwtrequest *SignJwtRequest) *ProjectsServiceAccountsSignJwtCall {
	c := &ProjectsServiceAccountsSignJwtCall{s: r.s, urlParams_: make(gensupport.URLParams)}
	c.name = name
	c.signjwtrequest = signjwtrequest
	return c
}

// Fields allows partial responses to be retrieved. See
// https://developers.google.com/gdata/docs/2.0/basics#PartialResponse
// for more information.
func (c *ProjectsServiceAccountsSignJwtCall) Fields(s ...googleapi.Field) *ProjectsServiceAccountsSignJwtCall {
	c.urlParams_.Set("fields", googleapi.CombineFields(s))
	return c
}

// Context sets the context to be used in this call's Do method. Any
// pending HTTP request will be aborted if the provided context is
// canceled.
func (c *ProjectsServiceAccountsSignJwtCall) Context(ctx context.Context) *ProjectsServiceAccountsSignJwtCall {
	c.ctx_ = ctx
	return c
}

// Header returns an http.Header that can be modified by the caller to
// add HTTP headers to the request.
func (c *ProjectsServiceAccountsSignJwtCall) Header() http.Header {
	if c.header_ == nil {
		c.header_ = make(http.Header)
	}
	return c.header_
}

func (c *ProjectsServiceAccountsSignJwtCall) doRequest(alt string) (*http.Response, error) {
	reqHeaders := make(http.Header)
	for k, v := range c.header_ {
		reqHeaders[k] = v
	}
	reqHeaders.Set("User-Agent", c.s.userAgent())
	var body io.Reader = nil
	body, err := googleapi.WithoutDataWrapper.JSONReader(c.signjwtrequest)
	if err != nil {
		return nil, err
	}
	reqHeaders.Set("Content-Type", "application/json")
	c.urlParams_.Set("alt", alt)
	urls := googleapi.ResolveRelative(c.s.BasePath, "v1/{+name}:signJwt")
	urls += "?" + c.urlParams_.Encode()
	req, _ := http.NewRequest("POST", urls, body)
	req.Header = reqHeaders
	googleapi.Expand(req.URL, map[string]string{
		"name": c.name,
	})
	return gensupport.SendRequest(c.ctx_, c.s.client, req)
}

// Do executes the "iamcredentials.projects.serviceAccounts.signJwt" call.
// Exactly one of *SignJwtResponse or error will be non-nil. Any non-2xx
// status code is an error. Response headers are in either
// *SignJwtResponse.ServerResponse.Header or (if a response was returned
// at all) in error.(*googleapi.Error).Header. Use
// googleapi.IsNotModified to check whether the returned error was
// because http.StatusNotModified was returned.
func (c *ProjectsServiceAccountsSignJwtCall) Do(opts ...googleapi.CallOption) (*SignJwtResponse, error) {
	gensupport.SetOptions(c.urlParams_, opts...)
	res, err := c.doRequest("json")
	if res != nil && res.StatusCode == http.StatusNotModified {
		if res.Body != nil {
			res.Body.Close()
		}
		return nil, &googleapi.Error{
			Code:   res.StatusCode,
			Header: res.Header,
		}
	}
	if err != nil {
		return nil, err
	}
	defer googleapi.CloseBody(res)
	if err := googleapi.CheckResponse(res); err != nil {
		return nil, err
	}
	ret := &SignJwtResponse{
		ServerResponse: googleapi.ServerResponse{
			Header:         res.Header,
			HTTPStatusCode: res.StatusCode,
		},
	}
	target := &ret
	if err := gensupport.DecodeResponse(target, res); err != nil {
		return nil, err
	}
	return ret, nil
	// {
	//   "description": "Signs a JWT using a service account's system-managed private key.",
	//   "flatPath": "v1/projects/{projectsId}/serviceAccounts/{serviceAccountsId}:signJwt",
	//   "httpMethod": "POST",
	//   "id": "iamcredentials.projects.serviceAccounts.signJwt",
	//   "parameterOrder": [
	//     "name"
	//   ],
	//   "parameters": {
	//     "name": {
	//       "description": "The resource name of the service account for which the credentials\nare requested, in the following format:\n`projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`.\nUsing `-` as a wildcard for the project will infer the project from\nthe account.",
	//       "location": "path",
	//       "pattern": "^projects/[^/]+/serviceAccounts/[^/]+$",
	//       "required": true,
	//       "type": "string"
	//     }
	//   },
	//   "path": "v1/{+name}:signJwt",
	//   "request": {
	//     "$ref": "SignJwtRequest"
	//   },
	//   "response": {
	//     "$ref": "SignJwtResponse"
	//   },
	//   "scopes": [
	//     "https://www.googleapis.com/auth/cloud-platform"
	//   ]
	// }

}
