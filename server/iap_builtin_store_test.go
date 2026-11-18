// Copyright 2026 The Nakama Authors
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
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type builtInStoreStub struct {
	appleReceipts       map[string]string
	googleProducts      map[string]string
	googleSubscriptions map[string]string
	samsungPurchases    map[string]string
}

func (s *builtInStoreStub) RoundTrip(req *http.Request) (*http.Response, error) {
	var body string
	switch req.URL.Host {
	case "buy.itunes.apple.com", "sandbox.itunes.apple.com":
		var payload struct {
			ReceiptData string `json:"receipt-data"`
		}
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			return nil, err
		}
		body = s.appleReceipts[payload.ReceiptData]
	case "accounts.google.com", "oauth2.googleapis.com":
		body = `{"access_token":"stub-token","expires_in":3600,"token_type":"Bearer"}`
	case "androidpublisher.googleapis.com":
		if strings.Contains(req.URL.Path, "/subscriptionsv2/") {
			body = s.googleSubscriptions[path.Base(req.URL.Path)]
		} else {
			body = s.googleProducts[path.Base(req.URL.Path)]
		}
	case "iap.samsungapps.com":
		body = s.samsungPurchases[req.URL.Query().Get("purchaseID")]
	}

	statusCode := http.StatusOK
	if body == "" {
		statusCode = http.StatusNotFound
	}
	return &http.Response{StatusCode: statusCode, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

const builtInStoreHooksModule = `
local nk = require("nakama")

nk.register_req_before(function(context, payload)
	if payload.purchase == "rejected-by-hook" then
		return nil
	end
	return payload
end, "ValidatePurchaseGoogle")

nk.register_req_after(function(context, out, payload)
	nk.storage_write({{collection = "iap_hooks", key = "after_validate_purchase_apple", user_id = context.user_id, value = {fired = true}}})
end, "ValidatePurchaseApple")

nk.register_subscription_notification_google(function(context, subscription, provider_payload, notification_type)
	nk.storage_write({{collection = "iap_hooks", key = "subscription_notification_google", user_id = subscription.user_id, value = {original_transaction_id = subscription.original_transaction_id}}})
end)
`

func TestBuiltInStoresValidateThroughTheClientAPI(t *testing.T) {
	ctx := context.Background()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)

	c := NewConfig(logger)
	c.Socket.Port = 4222
	c.Console.Port = 4228
	c.Runtime.Path = t.TempDir()
	c.IAP.Apple.SharedPassword = "test-shared-password"
	c.IAP.Google.ClientEmail = uuid.Must(uuid.NewV4()).String() + "@test.iam.gserviceaccount.com"
	c.IAP.Google.PrivateKey = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	c.IAP.FacebookInstant.AppSecret = "test-app-secret"
	require.NoError(t, os.WriteFile(filepath.Join(c.Runtime.Path, "hooks.lua"), []byte(builtInStoreHooksModule), 0o644))

	appleFirstID := uuid.Must(uuid.NewV4()).String()
	appleSecondID := uuid.Must(uuid.NewV4()).String()
	appleOriginalID := uuid.Must(uuid.NewV4()).String()
	appleUnpersistedID := uuid.Must(uuid.NewV4()).String()
	googleToken := uuid.Must(uuid.NewV4()).String()
	googlePendingToken := uuid.Must(uuid.NewV4()).String()
	googleGenericToken := uuid.Must(uuid.NewV4()).String()
	googleHookToken := uuid.Must(uuid.NewV4()).String()
	googleSubToken := uuid.Must(uuid.NewV4()).String()
	googleUpgradedToken := uuid.Must(uuid.NewV4()).String()
	samsungID := uuid.Must(uuid.NewV4()).String()
	purchaseTime := time.Now().Add(-time.Hour).Truncate(time.Second)
	firstExpiry := time.Now().Add(-10 * 24 * time.Hour).Truncate(time.Millisecond)
	renewedExpiry := time.Now().Add(20 * 24 * time.Hour).Truncate(time.Millisecond)
	googleExpiry := time.Now().Add(10 * 24 * time.Hour).UTC().Truncate(time.Second)
	googleUpgradedExpiry := time.Now().Add(365 * 24 * time.Hour).UTC().Truncate(time.Second)

	stub := &builtInStoreStub{
		appleReceipts: map[string]string{
			"two-purchases": fmt.Sprintf(`{"status":0,"environment":"Sandbox","receipt":{"in_app":[
				{"transaction_id":%[1]q,"product_id":"gems_100","purchase_date_ms":"%[3]d"},
				{"transaction_id":%[2]q,"product_id":"gems_500","purchase_date_ms":"%[3]d"},
				{"transaction_id":%[1]q,"product_id":"gems_100","purchase_date_ms":"%[3]d"}
			]}}`, appleFirstID, appleSecondID, purchaseTime.UnixMilli()),
			"no-purchases": `{"status":0,"environment":"Sandbox","receipt":{"in_app":[]}}`,
			"first-period": fmt.Sprintf(`{"status":0,"environment":"Production","receipt":{"in_app":[]},"latest_receipt_info":[
				{"original_transaction_id":%[1]q,"transaction_id":%[1]q,"product_id":"vip_monthly","original_purchase_date_ms":"%[2]d","purchase_date_ms":"%[2]d","expires_date_ms":"%[3]d"}
			]}`, appleOriginalID, purchaseTime.Add(-40*24*time.Hour).UnixMilli(), firstExpiry.UnixMilli()),
			"renewed": fmt.Sprintf(`{"status":0,"environment":"Production","receipt":{"in_app":[]},"latest_receipt_info":[
				{"original_transaction_id":%[1]q,"transaction_id":"renewal-1","product_id":"vip_monthly","original_purchase_date_ms":"%[2]d","purchase_date_ms":"%[3]d","expires_date_ms":"%[4]d"}
			]}`, appleOriginalID, purchaseTime.Add(-40*24*time.Hour).UnixMilli(), firstExpiry.UnixMilli(), renewedExpiry.UnixMilli()),
			"unpersisted": fmt.Sprintf(`{"status":0,"environment":"Production","receipt":{"in_app":[]},"latest_receipt_info":[
				{"original_transaction_id":%[1]q,"transaction_id":%[1]q,"product_id":"vip_weekly","original_purchase_date_ms":"%[2]d","purchase_date_ms":"%[2]d","expires_date_ms":"%[3]d"}
			]}`, appleUnpersistedID, purchaseTime.UnixMilli(), renewedExpiry.UnixMilli()),
		},
		googleProducts: map[string]string{
			googleToken:        fmt.Sprintf(`{"purchaseState":0,"purchaseTimeMillis":"%d","purchaseType":0}`, purchaseTime.UnixMilli()),
			googlePendingToken: fmt.Sprintf(`{"purchaseState":2,"purchaseTimeMillis":"%d"}`, purchaseTime.UnixMilli()),
			googleGenericToken: fmt.Sprintf(`{"purchaseState":0,"purchaseTimeMillis":"%d"}`, purchaseTime.UnixMilli()),
			googleHookToken:    fmt.Sprintf(`{"purchaseState":0,"purchaseTimeMillis":"%d"}`, purchaseTime.UnixMilli()),
		},
		googleSubscriptions: map[string]string{
			googleSubToken:      fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, googleExpiry.Format(time.RFC3339)),
			googleUpgradedToken: fmt.Sprintf(`{"linkedPurchaseToken":%q,"lineItems":[{"productId":"vip_yearly","expiryTime":%q}]}`, googleSubToken, googleUpgradedExpiry.Format(time.RFC3339)),
		},
		samsungPurchases: map[string]string{
			samsungID: fmt.Sprintf(`{"status":"success","mode":"TEST","packageName":"com.heroiclabs.test","itemId":"gems_100","purchaseDate":%q}`, purchaseTime.UTC().Format("2006-01-02 15:04:05")),
		},
	}
	previousTransport := httpc.Transport
	httpc.Transport = stub
	t.Cleanup(func() { httpc.Transport = previousTransport })

	db := NewDB(t)
	t.Cleanup(func() { _ = db.Close() })
	lbCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	lbRankCache := NewLocalLeaderboardRankCache(ctx, logger, db, c.Leaderboard, lbCache)
	lbSched := NewLocalLeaderboardScheduler(logger, db, c, lbCache, lbRankCache)
	sessionRegistry := NewLocalSessionRegistry(metrics)
	sessionCache := NewLocalSessionCache(3_600, 7_200)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	statusRegistry := NewLocalStatusRegistry(logger, c, sessionRegistry, protojsonMarshaler)
	router := &DummyMessageRouter{}
	rt, rtInfo, err := NewRuntime(ctx, logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "", nil, lbCache, lbRankCache, lbSched, sessionRegistry, sessionCache, statusRegistry, nil, nil, tracker, metrics, nil, router, storageIdx, nil)
	require.NoError(t, err)
	pipeline := NewPipeline(logger, c, db, protojsonMarshaler, protojsonUnmarshaler, sessionRegistry, statusRegistry, nil, nil, nil, tracker, router, rt, metrics)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "3.0.0", nil, storageIdx, lbCache, lbRankCache, sessionRegistry, sessionCache, statusRegistry, nil, nil, nil, tracker, router, nil, metrics, pipeline, rt)
	t.Cleanup(apiServer.Stop)
	consoleServer := StartConsoleServer(logger, logger, db, c, tracker, router, nil, metrics, sessionRegistry, sessionCache, NewLocalSessionCache(3_600, 7_200), NewLocalLoginAttemptCache(), statusRegistry, nil, rtInfo, nil, nil, "3.0.0", lbCache, lbRankCache, lbSched, storageIdx, apiServer, rt, "", nil)
	t.Cleanup(consoleServer.Stop)
	require.Eventually(t, func() bool {
		for _, address := range []string{"127.0.0.1:4221", "127.0.0.1:4228"} {
			conn, err := net.Dial("tcp", address)
			if err != nil {
				return false
			}
			_ = conn.Close()
		}
		return true
	}, 10*time.Second, 10*time.Millisecond)

	conn, err := grpc.NewClient("127.0.0.1:4221", grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	client := apigrpc.NewNakamaClient(conn)
	basicCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("defaultkey:"))))

	t.Run("an apple receipt stores each purchase once and reports it seen on resubmission", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		first, err := client.ValidatePurchaseApple(userCtx, &api.ValidatePurchaseAppleRequest{Receipt: "two-purchases", Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, first.ValidatedPurchases, 2)
		products := map[string]string{}
		for _, p := range first.ValidatedPurchases {
			products[p.TransactionId] = p.ProductId
			assert.False(t, p.SeenBefore)
			assert.Equal(t, api.StoreProvider_APPLE_APP_STORE, p.Store)
			assert.Equal(t, api.StoreEnvironment_SANDBOX, p.Environment)
			assert.True(t, purchaseTime.Equal(p.PurchaseTime.AsTime()))
		}
		assert.Equal(t, map[string]string{appleFirstID: "gems_100", appleSecondID: "gems_500"}, products)

		second, err := client.ValidatePurchaseApple(userCtx, &api.ValidatePurchaseAppleRequest{Receipt: "two-purchases", Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, second.ValidatedPurchases, 2)
		for _, p := range second.ValidatedPurchases {
			assert.True(t, p.SeenBefore)
		}
	})

	t.Run("an apple receipt without purchases is a failed precondition", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseApple(userCtx, &api.ValidatePurchaseAppleRequest{Receipt: "no-purchases", Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("an apple receipt without purchases is a failed precondition without persist", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseApple(userCtx, &api.ValidatePurchaseAppleRequest{Receipt: "no-purchases", Persist: wrapperspb.Bool(false)})
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("the apple after hook runs for an apple validation", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		account, err := client.GetAccount(userCtx, &emptypb.Empty{})
		require.NoError(t, err)

		_, err = client.ValidatePurchaseApple(userCtx, &api.ValidatePurchaseAppleRequest{Receipt: "two-purchases", Persist: wrapperspb.Bool(false)})
		require.NoError(t, err)

		objects, err := client.ReadStorageObjects(userCtx, &api.ReadStorageObjectsRequest{ObjectIds: []*api.ReadStorageObjectId{{Collection: "iap_hooks", Key: "after_validate_purchase_apple", UserId: account.User.Id}}})
		require.NoError(t, err)
		assert.Len(t, objects.Objects, 1)
	})

	t.Run("a google purchase is stored once and reported seen on resubmission", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		receipt := fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"gems_100","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, googleToken, purchaseTime.UnixMilli())

		first, err := client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: receipt, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, first.ValidatedPurchases, 1)
		assert.False(t, first.ValidatedPurchases[0].SeenBefore)
		assert.Equal(t, googleToken, first.ValidatedPurchases[0].TransactionId)
		assert.Equal(t, "gems_100", first.ValidatedPurchases[0].ProductId)
		assert.Equal(t, api.StoreProvider_GOOGLE_PLAY_STORE, first.ValidatedPurchases[0].Store)
		assert.Equal(t, api.StoreEnvironment_SANDBOX, first.ValidatedPurchases[0].Environment)
		assert.True(t, purchaseTime.Equal(first.ValidatedPurchases[0].PurchaseTime.AsTime()))

		second, err := client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: receipt, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, second.ValidatedPurchases, 1)
		assert.True(t, second.ValidatedPurchases[0].SeenBefore)
	})

	t.Run("a pending google purchase is a failed precondition", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		receipt := fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"gems_100","purchaseToken":%q,"purchaseTime":%d,"purchaseState":2}`, googlePendingToken, purchaseTime.UnixMilli())

		_, err = client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: receipt, Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("a malformed google receipt is an unknown error", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: "not-json", Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.Unknown, status.Code(err))
	})

	t.Run("the google before hook can reject a google validation", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: "rejected-by-hook", Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.NotFound, status.Code(err))

		receipt := fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"gems_100","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, googleHookToken, purchaseTime.UnixMilli())
		validation, err := client.ValidatePurchaseGoogle(userCtx, &api.ValidatePurchaseGoogleRequest{Purchase: receipt, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		assert.Len(t, validation.ValidatedPurchases, 1)
	})

	t.Run("google validates through the generic purchase endpoint by name", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		receipt := fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"gems_100","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, googleGenericToken, purchaseTime.UnixMilli())

		payload, err := structpb.NewStruct(map[string]any{"purchase": receipt})
		require.NoError(t, err)

		validation, err := client.ValidatePurchase(userCtx, &api.ValidateIAPPurchaseRequest{Provider: "google", Payload: payload, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, validation.Purchase, 1)
		assert.Equal(t, googleGenericToken, validation.Purchase[0].TransactionId)
		assert.Equal(t, api.StoreProvider_GOOGLE_PLAY_STORE, validation.Purchase[0].Store)
	})

	t.Run("a facebook instant purchase is stored once and reported seen on resubmission", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		token := uuid.Must(uuid.NewV4()).String()
		payload := base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, `{"product_id":"gems_100","purchase_time":%d,"purchase_token":%q}`, purchaseTime.Unix(), token))
		mac := hmac.New(sha256.New, []byte("test-app-secret"))
		mac.Write([]byte(payload))
		signedRequest := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)) + "." + payload

		first, err := client.ValidatePurchaseFacebookInstant(userCtx, &api.ValidatePurchaseFacebookInstantRequest{SignedRequest: signedRequest, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, first.ValidatedPurchases, 1)
		assert.False(t, first.ValidatedPurchases[0].SeenBefore)
		assert.Equal(t, token, first.ValidatedPurchases[0].TransactionId)
		assert.Equal(t, "gems_100", first.ValidatedPurchases[0].ProductId)
		assert.Equal(t, api.StoreProvider_FACEBOOK_INSTANT_STORE, first.ValidatedPurchases[0].Store)
		assert.Equal(t, api.StoreEnvironment_PRODUCTION, first.ValidatedPurchases[0].Environment)
		assert.True(t, purchaseTime.Equal(first.ValidatedPurchases[0].PurchaseTime.AsTime()))

		second, err := client.ValidatePurchaseFacebookInstant(userCtx, &api.ValidatePurchaseFacebookInstantRequest{SignedRequest: signedRequest, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, second.ValidatedPurchases, 1)
		assert.True(t, second.ValidatedPurchases[0].SeenBefore)
	})

	t.Run("a facebook instant purchase with a bad signature is an unknown error", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		payload := base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, `{"product_id":"gems_100","purchase_time":%d,"purchase_token":%q}`, purchaseTime.Unix(), uuid.Must(uuid.NewV4()).String()))
		mac := hmac.New(sha256.New, []byte("another-secret"))
		mac.Write([]byte(payload))

		_, err = client.ValidatePurchaseFacebookInstant(userCtx, &api.ValidatePurchaseFacebookInstantRequest{SignedRequest: base64.RawURLEncoding.EncodeToString(mac.Sum(nil)) + "." + payload, Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.Unknown, status.Code(err))
	})

	t.Run("a samsung test purchase is stored as sandbox and reported seen on resubmission", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		first, err := client.ValidatePurchaseSamsung(userCtx, &api.ValidatePurchaseSamsungRequest{PurchaseId: samsungID, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, first.ValidatedPurchases, 1)
		assert.False(t, first.ValidatedPurchases[0].SeenBefore)
		assert.Equal(t, samsungID, first.ValidatedPurchases[0].TransactionId)
		assert.Equal(t, "gems_100", first.ValidatedPurchases[0].ProductId)
		assert.Equal(t, api.StoreProvider_SAMSUNG_GALAXY_STORE, first.ValidatedPurchases[0].Store)
		assert.Equal(t, api.StoreEnvironment_SANDBOX, first.ValidatedPurchases[0].Environment)
		assert.True(t, purchaseTime.Equal(first.ValidatedPurchases[0].PurchaseTime.AsTime()))

		second, err := client.ValidatePurchaseSamsung(userCtx, &api.ValidatePurchaseSamsungRequest{PurchaseId: samsungID, Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		require.Len(t, second.ValidatedPurchases, 1)
		assert.True(t, second.ValidatedPurchases[0].SeenBefore)
	})

	t.Run("an unknown samsung purchase is rejected", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseSamsung(userCtx, &api.ValidatePurchaseSamsungRequest{PurchaseId: uuid.Must(uuid.NewV4()).String(), Persist: wrapperspb.Bool(true)})
		require.Error(t, err)
	})

	t.Run("huawei without credentials is not configured", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		_, err = client.ValidatePurchaseHuawei(userCtx, &api.ValidatePurchaseHuaweiRequest{Purchase: `{"purchaseToken":"t"}`, Signature: "s", Persist: wrapperspb.Bool(true)})
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("an apple subscription renewal updates one row that lists as active", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		expired, err := client.ValidateSubscriptionApple(userCtx, &api.ValidateSubscriptionAppleRequest{Receipt: "first-period", Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		assert.Equal(t, appleOriginalID, expired.ValidatedSubscription.OriginalTransactionId)
		assert.Equal(t, api.StoreProvider_APPLE_APP_STORE, expired.ValidatedSubscription.Store)
		assert.Equal(t, api.StoreEnvironment_PRODUCTION, expired.ValidatedSubscription.Environment)
		assert.False(t, expired.ValidatedSubscription.Active)

		renewed, err := client.ValidateSubscriptionApple(userCtx, &api.ValidateSubscriptionAppleRequest{Receipt: "renewed", Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		assert.Equal(t, appleOriginalID, renewed.ValidatedSubscription.OriginalTransactionId)
		assert.True(t, renewed.ValidatedSubscription.Active)
		assert.True(t, renewedExpiry.Equal(renewed.ValidatedSubscription.ExpiryTime.AsTime()))

		list, err := client.ListSubscriptions(userCtx, &api.ListSubscriptionsRequest{Limit: wrapperspb.Int32(100)})
		require.NoError(t, err)
		require.Len(t, list.ValidatedSubscriptions, 1)
		assert.Equal(t, appleOriginalID, list.ValidatedSubscriptions[0].OriginalTransactionId)
		assert.True(t, list.ValidatedSubscriptions[0].Active)
		assert.True(t, renewedExpiry.Equal(list.ValidatedSubscriptions[0].ExpiryTime.AsTime()))

		byProduct, err := client.GetSubscription(userCtx, &api.GetSubscriptionRequest{ProductId: "vip_monthly"})
		require.NoError(t, err)
		assert.Equal(t, appleOriginalID, byProduct.OriginalTransactionId)
		assert.True(t, byProduct.Active)
	})

	t.Run("a subscription validated without persist is not stored", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		validation, err := client.ValidateSubscriptionApple(userCtx, &api.ValidateSubscriptionAppleRequest{Receipt: "unpersisted", Persist: wrapperspb.Bool(false)})
		require.NoError(t, err)
		assert.Equal(t, appleUnpersistedID, validation.ValidatedSubscription.OriginalTransactionId)
		assert.True(t, validation.ValidatedSubscription.Active)

		list, err := client.ListSubscriptions(userCtx, &api.ListSubscriptionsRequest{Limit: wrapperspb.Int32(100)})
		require.NoError(t, err)
		assert.Empty(t, list.ValidatedSubscriptions)
	})

	t.Run("an upgraded google subscription updates the row it links to", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))

		first, err := client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_monthly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, googleSubToken, purchaseTime.UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		assert.Equal(t, googleSubToken, first.ValidatedSubscription.OriginalTransactionId)
		assert.Equal(t, api.StoreProvider_GOOGLE_PLAY_STORE, first.ValidatedSubscription.Store)
		assert.Equal(t, api.StoreEnvironment_PRODUCTION, first.ValidatedSubscription.Environment)
		assert.True(t, googleExpiry.Equal(first.ValidatedSubscription.ExpiryTime.AsTime()))

		upgraded, err := client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_yearly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, googleUpgradedToken, purchaseTime.UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		assert.Equal(t, googleSubToken, upgraded.ValidatedSubscription.OriginalTransactionId)

		list, err := client.ListSubscriptions(userCtx, &api.ListSubscriptionsRequest{Limit: wrapperspb.Int32(100)})
		require.NoError(t, err)
		require.Len(t, list.ValidatedSubscriptions, 1)
		assert.Equal(t, googleSubToken, list.ValidatedSubscriptions[0].OriginalTransactionId)
		assert.Equal(t, "vip_yearly", list.ValidatedSubscriptions[0].ProductId)
		assert.True(t, googleUpgradedExpiry.Equal(list.ValidatedSubscriptions[0].ExpiryTime.AsTime()))
	})
}

func TestGoogleNotificationsThroughTheConsoleEndpoints(t *testing.T) {
	ctx := context.Background()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)

	c := NewConfig(logger)
	c.Socket.Port = 4222
	c.Console.Port = 4228
	c.Runtime.Path = t.TempDir()
	c.IAP.Apple.NotificationsEndpointId = "apple-endpoint"
	c.IAP.Google.ClientEmail = uuid.Must(uuid.NewV4()).String() + "@test.iam.gserviceaccount.com"
	c.IAP.Google.PrivateKey = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	c.IAP.Google.NotificationsEndpointId = "google-endpoint"
	require.NoError(t, os.WriteFile(filepath.Join(c.Runtime.Path, "hooks.lua"), []byte(builtInStoreHooksModule), 0o644))

	renewedToken := uuid.Must(uuid.NewV4()).String()
	legacyPathToken := uuid.Must(uuid.NewV4()).String()
	refundedToken := uuid.Must(uuid.NewV4()).String()
	unknownToken := uuid.Must(uuid.NewV4()).String()
	hookToken := uuid.Must(uuid.NewV4()).String()
	firstExpiry := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	renewedExpiry := time.Now().Add(30 * 24 * time.Hour).UTC().Truncate(time.Second)
	stub := &builtInStoreStub{googleSubscriptions: map[string]string{
		renewedToken:    fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339)),
		legacyPathToken: fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339)),
		refundedToken:   fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339)),
		unknownToken:    fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339)),
		hookToken:       fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339)),
	}}
	previousTransport := httpc.Transport
	httpc.Transport = stub
	t.Cleanup(func() { httpc.Transport = previousTransport })

	db := NewDB(t)
	t.Cleanup(func() { _ = db.Close() })
	lbCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	lbRankCache := NewLocalLeaderboardRankCache(ctx, logger, db, c.Leaderboard, lbCache)
	lbSched := NewLocalLeaderboardScheduler(logger, db, c, lbCache, lbRankCache)
	sessionRegistry := NewLocalSessionRegistry(metrics)
	sessionCache := NewLocalSessionCache(3_600, 7_200)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	statusRegistry := NewLocalStatusRegistry(logger, c, sessionRegistry, protojsonMarshaler)
	router := &DummyMessageRouter{}
	rt, rtInfo, err := NewRuntime(ctx, logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "", nil, lbCache, lbRankCache, lbSched, sessionRegistry, sessionCache, statusRegistry, nil, nil, tracker, metrics, nil, router, storageIdx, nil)
	require.NoError(t, err)
	pipeline := NewPipeline(logger, c, db, protojsonMarshaler, protojsonUnmarshaler, sessionRegistry, statusRegistry, nil, nil, nil, tracker, router, rt, metrics)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "3.0.0", nil, storageIdx, lbCache, lbRankCache, sessionRegistry, sessionCache, statusRegistry, nil, nil, nil, tracker, router, nil, metrics, pipeline, rt)
	t.Cleanup(apiServer.Stop)
	consoleServer := StartConsoleServer(logger, logger, db, c, tracker, router, nil, metrics, sessionRegistry, sessionCache, NewLocalSessionCache(3_600, 7_200), NewLocalLoginAttemptCache(), statusRegistry, nil, rtInfo, nil, nil, "3.0.0", lbCache, lbRankCache, lbSched, storageIdx, apiServer, rt, "", nil)
	t.Cleanup(consoleServer.Stop)
	require.Eventually(t, func() bool {
		for _, address := range []string{"127.0.0.1:4221", "127.0.0.1:4228"} {
			conn, err := net.Dial("tcp", address)
			if err != nil {
				return false
			}
			_ = conn.Close()
		}
		return true
	}, 10*time.Second, 10*time.Millisecond)

	conn, err := grpc.NewClient("127.0.0.1:4221", grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	client := apigrpc.NewNakamaClient(conn)
	basicCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("defaultkey:"))))

	t.Run("a renewal notification updates the stored subscription", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		stub.googleSubscriptions[renewedToken] = fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, firstExpiry.Format(time.RFC3339))
		_, err = client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_monthly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, renewedToken, time.Now().Add(-48*time.Hour).UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)
		stub.googleSubscriptions[renewedToken] = fmt.Sprintf(`{"lineItems":[{"productId":"vip_monthly","expiryTime":%q}]}`, renewedExpiry.Format(time.RFC3339))

		data := fmt.Sprintf(`{"version":"1.0","packageName":"com.heroiclabs.test","eventTimeMillis":"%d","subscriptionNotification":{"version":"1.0","notificationType":%d,"purchaseToken":%q,"subscriptionId":"vip_monthly"}}`, time.Now().UnixMilli(), runtime.GoogleSubscriptionRenewed, renewedToken)
		for base64.StdEncoding.EncodeToString([]byte(data)) != base64.URLEncoding.EncodeToString([]byte(data)) {
			data += " "
		}
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications/google-endpoint", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"message":{"data":%q,"messageId":"1"},"subscription":"s"}`, base64.URLEncoding.EncodeToString([]byte(data)))))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		byProduct, err := client.GetSubscription(userCtx, &api.GetSubscriptionRequest{ProductId: "vip_monthly"})
		require.NoError(t, err)
		assert.Equal(t, renewedToken, byProduct.OriginalTransactionId)
		assert.True(t, renewedExpiry.Equal(byProduct.ExpiryTime.AsTime()))
		assert.True(t, byProduct.Active)
	})

	t.Run("a notification on the legacy subscriptions path is handled", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		_, err = client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_monthly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, legacyPathToken, time.Now().Add(-48*time.Hour).UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)

		data := fmt.Sprintf(`{"version":"1.0","packageName":"com.heroiclabs.test","eventTimeMillis":"%d","subscriptionNotification":{"version":"1.0","notificationType":%d,"purchaseToken":%q,"subscriptionId":"vip_monthly"}}`, time.Now().UnixMilli(), runtime.GoogleSubscriptionCanceled, legacyPathToken)
		for base64.StdEncoding.EncodeToString([]byte(data)) != base64.URLEncoding.EncodeToString([]byte(data)) {
			data += " "
		}
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/subscriptions/google-endpoint", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"message":{"data":%q,"messageId":"1"},"subscription":"s"}`, base64.URLEncoding.EncodeToString([]byte(data)))))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		list, err := client.ListSubscriptions(userCtx, &api.ListSubscriptionsRequest{Limit: wrapperspb.Int32(100)})
		require.NoError(t, err)
		require.Len(t, list.ValidatedSubscriptions, 1)
		assert.NotEmpty(t, list.ValidatedSubscriptions[0].ProviderNotification)
	})

	t.Run("a voided subscription notification records the refund", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		_, err = client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_monthly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, refundedToken, time.Now().Add(-48*time.Hour).UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)

		data := fmt.Sprintf(`{"version":"1.0","packageName":"com.heroiclabs.test","eventTimeMillis":"%d","voidedPurchaseNotification":{"purchaseToken":%q,"orderId":"GPA.1","productType":%d,"refundType":1}}`, time.Now().UnixMilli(), refundedToken, runtime.GoogleProductTypeSubscription)
		for base64.StdEncoding.EncodeToString([]byte(data)) != base64.URLEncoding.EncodeToString([]byte(data)) {
			data += " "
		}
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications/google-endpoint", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"message":{"data":%q,"messageId":"1"},"subscription":"s"}`, base64.URLEncoding.EncodeToString([]byte(data)))))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		list, err := client.ListSubscriptions(userCtx, &api.ListSubscriptionsRequest{Limit: wrapperspb.Int32(100)})
		require.NoError(t, err)
		require.Len(t, list.ValidatedSubscriptions, 1)
		assert.False(t, list.ValidatedSubscriptions[0].Active)
		assert.NotZero(t, list.ValidatedSubscriptions[0].RefundTime.AsTime().Unix())
	})

	t.Run("a notification for a subscription nobody validated is acknowledged and stores nothing", func(t *testing.T) {
		data := fmt.Sprintf(`{"version":"1.0","packageName":"com.heroiclabs.test","eventTimeMillis":"%d","subscriptionNotification":{"version":"1.0","notificationType":%d,"purchaseToken":%q,"subscriptionId":"vip_monthly"}}`, time.Now().UnixMilli(), runtime.GoogleSubscriptionRenewed, unknownToken)
		for base64.StdEncoding.EncodeToString([]byte(data)) != base64.URLEncoding.EncodeToString([]byte(data)) {
			data += " "
		}
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications/google-endpoint", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"message":{"data":%q,"messageId":"1"},"subscription":"s"}`, base64.URLEncoding.EncodeToString([]byte(data)))))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var stored bool
		require.NoError(t, db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM subscription WHERE original_transaction_id = $1)", unknownToken).Scan(&stored))
		assert.False(t, stored)
	})

	t.Run("a notification on an unknown endpoint id is not found", func(t *testing.T) {
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications/another-endpoint", "application/json", bytes.NewBufferString(`{}`))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	t.Run("an apple notification that cannot be verified asks for a retry", func(t *testing.T) {
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/apple/notifications/apple-endpoint", "application/json", bytes.NewBufferString(`{"signedPayload":"not.a.jws"}`))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
	})

	t.Run("the google subscription notification hook runs for a google notification", func(t *testing.T) {
		session, err := client.AuthenticateCustom(basicCtx, &api.AuthenticateCustomRequest{Account: &api.AccountCustom{Id: uuid.Must(uuid.NewV4()).String()}})
		require.NoError(t, err)
		userCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+session.Token))
		account, err := client.GetAccount(userCtx, &emptypb.Empty{})
		require.NoError(t, err)
		_, err = client.ValidateSubscriptionGoogle(userCtx, &api.ValidateSubscriptionGoogleRequest{Receipt: fmt.Sprintf(`{"packageName":"com.heroiclabs.test","productId":"vip_monthly","purchaseToken":%q,"purchaseTime":%d,"purchaseState":0}`, hookToken, time.Now().Add(-48*time.Hour).UnixMilli()), Persist: wrapperspb.Bool(true)})
		require.NoError(t, err)

		data := fmt.Sprintf(`{"version":"1.0","packageName":"com.heroiclabs.test","eventTimeMillis":"%d","subscriptionNotification":{"version":"1.0","notificationType":%d,"purchaseToken":%q,"subscriptionId":"vip_monthly"}}`, time.Now().UnixMilli(), runtime.GoogleSubscriptionRenewed, hookToken)
		for base64.StdEncoding.EncodeToString([]byte(data)) != base64.URLEncoding.EncodeToString([]byte(data)) {
			data += " "
		}
		resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications/google-endpoint", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"message":{"data":%q,"messageId":"1"},"subscription":"s"}`, base64.URLEncoding.EncodeToString([]byte(data)))))
		require.NoError(t, err)
		_ = resp.Body.Close()
		require.Equal(t, http.StatusOK, resp.StatusCode)

		objects, err := client.ReadStorageObjects(userCtx, &api.ReadStorageObjectsRequest{ObjectIds: []*api.ReadStorageObjectId{{Collection: "iap_hooks", Key: "subscription_notification_google", UserId: account.User.Id}}})
		require.NoError(t, err)
		assert.Len(t, objects.Objects, 1)
	})
}

func TestGoogleNotificationsAreServedWithoutAnEndpointId(t *testing.T) {
	ctx := context.Background()

	c := NewConfig(logger)
	c.Socket.Port = 4222
	c.Console.Port = 4228
	c.Runtime.Path = t.TempDir()

	db := NewDB(t)
	t.Cleanup(func() { _ = db.Close() })
	lbCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	lbRankCache := NewLocalLeaderboardRankCache(ctx, logger, db, c.Leaderboard, lbCache)
	lbSched := NewLocalLeaderboardScheduler(logger, db, c, lbCache, lbRankCache)
	sessionRegistry := NewLocalSessionRegistry(metrics)
	sessionCache := NewLocalSessionCache(3_600, 7_200)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	statusRegistry := NewLocalStatusRegistry(logger, c, sessionRegistry, protojsonMarshaler)
	router := &DummyMessageRouter{}
	rt, rtInfo, err := NewRuntime(ctx, logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "", nil, lbCache, lbRankCache, lbSched, sessionRegistry, sessionCache, statusRegistry, nil, nil, tracker, metrics, nil, router, storageIdx, nil)
	require.NoError(t, err)
	pipeline := NewPipeline(logger, c, db, protojsonMarshaler, protojsonUnmarshaler, sessionRegistry, statusRegistry, nil, nil, nil, tracker, router, rt, metrics)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, c, "3.0.0", nil, storageIdx, lbCache, lbRankCache, sessionRegistry, sessionCache, statusRegistry, nil, nil, nil, tracker, router, nil, metrics, pipeline, rt)
	t.Cleanup(apiServer.Stop)
	consoleServer := StartConsoleServer(logger, logger, db, c, tracker, router, nil, metrics, sessionRegistry, sessionCache, NewLocalSessionCache(3_600, 7_200), NewLocalLoginAttemptCache(), statusRegistry, nil, rtInfo, nil, nil, "3.0.0", lbCache, lbRankCache, lbSched, storageIdx, apiServer, rt, "", nil)
	t.Cleanup(consoleServer.Stop)
	require.Eventually(t, func() bool {
		for _, address := range []string{"127.0.0.1:4221", "127.0.0.1:4228"} {
			conn, err := net.Dial("tcp", address)
			if err != nil {
				return false
			}
			_ = conn.Close()
		}
		return true
	}, 10*time.Second, 10*time.Millisecond)

	resp, err := http.Post("http://127.0.0.1:4228/v2/console/google/notifications", "application/json", bytes.NewBufferString(`{"message":{"data":"e30="}}`))
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.NotEqual(t, http.StatusNotFound, resp.StatusCode)
}
