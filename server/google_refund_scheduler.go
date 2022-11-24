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
	"context"
	"database/sql"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strconv"
	"sync"
	"time"
)

type GoogleRefundScheduler interface {
	Start(runtime *Runtime)
	Stop()
}

type LocalGoogleRefundScheduler struct {
	sync.Mutex
	logger *zap.Logger
	db     *sql.DB
	config Config

	fnPurchaseRefund     RuntimePurchaseNotificationGoogleFunction
	fnSubscriptionRefund RuntimeSubscriptionNotificationGoogleFunction

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func NewGoogleRefundScheduler(logger *zap.Logger, db *sql.DB, config Config) GoogleRefundScheduler {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	g := &LocalGoogleRefundScheduler{
		logger:      logger,
		db:          db,
		config:      config,
		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}

	if !config.GetIAP().Google.Enabled() {
		return g
	}

	period := config.GetIAP().Google.RefundCheckPeriod
	if period != 0 {
		go func() {
			ticker := time.NewTicker(time.Duration(period))
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					voidedReceipts, err := iap.ListVoidedGoogleReceipts(ctx, httpc, config.GetIAP().Google.ClientEmail, config.GetIAP().Google.PrivateKey, config.GetIAP().Google.PackageName)
					if err != nil {
						logger.Error("Failed to get IAP Google voided receipts", zap.Error(err))
						continue
					}

					for _, vr := range voidedReceipts {
						switch vr.Kind {
						case "androidpublisher#productPurchase":
							// TODO: Return storagePurchase instead of api.ValidatedPurchase
							purchase, err := getPurchaseByTransactionId(ctx, db, vr.PurchaseToken)
							if err != nil && err != sql.ErrNoRows {
								logger.Warn("Failed to find purchase for Google refund callback", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
								continue
							}

							if purchase.RefundTime.Seconds != 0 {
								// Purchase refund already handled, skip it.
								continue
							}

							refundTimeInt, err := strconv.ParseInt(vr.VoidedTimeMillis, 10, 64)
							if err != nil {
								logger.Error("Failed to parse Google purchase voided time", zap.Error(err), zap.String("voided_time", vr.VoidedTimeMillis))
								continue
							}

							refundTime := parseMillisecondUnixTimestamp(refundTimeInt)

							sPurchase := &storagePurchase{
								userID:        uuid.Must(uuid.FromString(purchase.UserId)),
								store:         purchase.Store,
								productId:     purchase.ProductId,
								transactionId: purchase.TransactionId,
								purchaseTime:  purchase.PurchaseTime.AsTime(),
								createTime:    purchase.CreateTime.AsTime(),
								updateTime:    purchase.UpdateTime.AsTime(),
								refundTime:    refundTime,
								environment:   purchase.Environment,
							}

							dbPurchases, err := upsertPurchases(ctx, db, []*storagePurchase{sPurchase})
							if err != nil {
								logger.Error("Failed to upsert Google voided purchase", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
								continue
							}
							dbPurchase := dbPurchases[0]

							validatedPurchase := &api.ValidatedPurchase{
								UserId:        dbPurchase.userID.String(),
								ProductId:     dbPurchase.productId,
								TransactionId: dbPurchase.transactionId,
								Store:         dbPurchase.store,
								PurchaseTime:  timestamppb.New(dbPurchase.purchaseTime),
								CreateTime:    timestamppb.New(dbPurchase.createTime),
								UpdateTime:    timestamppb.New(dbPurchase.updateTime),
								RefundTime:    timestamppb.New(refundTime),
								Environment:   purchase.Environment,
							}

							if g.fnPurchaseRefund != nil {
								if err = g.fnPurchaseRefund(ctx, validatedPurchase, ""); err != nil {
									logger.Warn("Failed to invoke Google purchase refund hook", zap.Error(err))
								}
							}

						case "androidpublisher#subscriptionPurchase":
							subscription, err := getSubscriptionByOriginalTransactionId(ctx, db, vr.PurchaseToken)
							if err != nil && err != sql.ErrNoRows {
								logger.Warn("Failed to find subscription for Google refund callback", zap.Error(err), zap.String("transaction_id", vr.PurchaseToken))
								continue
							}

							if subscription.RefundTime.Seconds != 0 {
								// Subscription refund already handled, skip it.
								continue
							}

							refundTimeInt, err := strconv.ParseInt(vr.VoidedTimeMillis, 10, 64)
							if err != nil {
								logger.Error("Failed to parse Google subscription voided time", zap.Error(err), zap.String("voided_time", vr.VoidedTimeMillis))
								continue
							}

							refundTime := parseMillisecondUnixTimestamp(refundTimeInt)

							sSubscription := &storageSubscription{
								originalTransactionId: subscription.OriginalTransactionId,
								userID:                uuid.Must(uuid.FromString(subscription.UserId)),
								store:                 subscription.Store,
								productId:             subscription.ProductId,
								purchaseTime:          subscription.PurchaseTime.AsTime(),
								createTime:            subscription.CreateTime.AsTime(),
								updateTime:            subscription.UpdateTime.AsTime(),
								refundTime:            refundTime,
								environment:           subscription.Environment,
								expireTime:            subscription.ExpiryTime.AsTime(),
							}

							err = upsertSubscription(ctx, db, sSubscription)
							if err != nil {
								logger.Error("Failed to upsert Google voided subscription", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
								continue
							}

							active := false
							if sSubscription.expireTime.After(time.Now()) {
								active = true
							}

							validatedSubscription := &api.ValidatedSubscription{
								UserId:                sSubscription.userID.String(),
								ProductId:             sSubscription.productId,
								OriginalTransactionId: sSubscription.originalTransactionId,
								Store:                 sSubscription.store,
								PurchaseTime:          timestamppb.New(sSubscription.purchaseTime),
								CreateTime:            timestamppb.New(sSubscription.createTime),
								UpdateTime:            timestamppb.New(sSubscription.updateTime),
								Environment:           sSubscription.environment,
								ExpiryTime:            timestamppb.New(sSubscription.expireTime),
								RefundTime:            timestamppb.New(refundTime),
								Active:                active,
							}

							if g.fnSubscriptionRefund != nil {
								if err = g.fnSubscriptionRefund(ctx, validatedSubscription, ""); err != nil {
									logger.Warn("Failed to invoke Google subscription refund hook", zap.Error(err))
								}
							}
						default:
							logger.Warn("Unhandled IAP Google voided receipt kind", zap.String("kind", vr.Kind))
						}
					}
				}
			}
		}()
	}

	return g
}

func (g *LocalGoogleRefundScheduler) Start(runtime *Runtime) {
	g.fnPurchaseRefund = runtime.PurchaseNotificationGoogle()
	g.fnSubscriptionRefund = runtime.SubscriptionNotificationGoogle()
}

func (g *LocalGoogleRefundScheduler) Stop() {
	g.ctxCancelFn()
}
