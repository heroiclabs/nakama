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
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type GoogleRefundScheduler interface {
	Start(runtime *Runtime)
	Pause()
	Resume()
	Stop()
}

type LocalGoogleRefundScheduler struct {
	sync.Mutex
	logger *zap.Logger
	db     *sql.DB
	config Config

	active *atomic.Uint32

	fnPurchaseRefund     RuntimePurchaseNotificationGoogleFunction
	fnSubscriptionRefund RuntimeSubscriptionNotificationGoogleFunction

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func NewGoogleRefundScheduler(logger *zap.Logger, db *sql.DB, config Config) GoogleRefundScheduler {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	return &LocalGoogleRefundScheduler{
		logger: logger,
		db:     db,
		config: config,

		active: atomic.NewUint32(1),

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}
}

func (g *LocalGoogleRefundScheduler) Start(runtime *Runtime) {
	g.fnPurchaseRefund = runtime.PurchaseNotificationGoogle()
	g.fnSubscriptionRefund = runtime.SubscriptionNotificationGoogle()

	if !g.config.GetIAP().Google.Enabled() {
		return
	}

	period := g.config.GetIAP().Google.RefundCheckPeriodMin
	if period != 0 {
		go func() {
			ticker := time.NewTicker(time.Duration(period) * time.Minute)
			defer ticker.Stop()

			for {
				select {
				case <-g.ctx.Done():
					return
				case <-ticker.C:
					if g.active.Load() != 1 {
						continue
					}

					voidedReceipts, err := iap.ListVoidedReceiptsGoogle(g.ctx, httpc, g.config.GetIAP().Google.ClientEmail, g.config.GetIAP().Google.PrivateKey, g.config.GetIAP().Google.PackageName)
					if err != nil {
						g.logger.Error("Failed to get IAP Google voided receipts", zap.Error(err))
						continue
					}

					for _, vr := range voidedReceipts {
						purchase, err := GetPurchaseByTransactionId(g.ctx, g.logger, g.db, vr.PurchaseToken)
						if err != nil {
							g.logger.Error("Failed to get purchase by transaction_id", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
							continue
						}

						if purchase != nil {
							// Refunded purchase.
							if purchase.RefundTime.Seconds != 0 {
								// Purchase refund already handled, skip it.
								continue
							}

							if purchase.UserId == "" {
								// Purchase belongs to a deleted user.
								continue
							}

							refundTimeInt, err := strconv.ParseInt(vr.VoidedTimeMillis, 10, 64)
							if err != nil {
								g.logger.Error("Failed to parse Google purchase voided time", zap.Error(err), zap.String("voided_time", vr.VoidedTimeMillis))
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

							dbPurchases, err := upsertPurchases(g.ctx, g.db, []*storagePurchase{sPurchase})
							if err != nil {
								g.logger.Error("Failed to upsert Google voided purchase", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
								continue
							}
							dbPurchase := dbPurchases[0]
							suid := dbPurchase.userID.String()
							if dbPurchase.userID.IsNil() {
								suid = ""
							}
							validatedPurchase := &api.ValidatedPurchase{
								UserId:        suid,
								ProductId:     dbPurchase.productId,
								TransactionId: dbPurchase.transactionId,
								Store:         dbPurchase.store,
								PurchaseTime:  timestamppb.New(dbPurchase.purchaseTime),
								CreateTime:    timestamppb.New(dbPurchase.createTime),
								UpdateTime:    timestamppb.New(dbPurchase.updateTime),
								RefundTime:    timestamppb.New(dbPurchase.refundTime),
								Environment:   purchase.Environment,
								SeenBefore:    dbPurchase.seenBefore,
							}

							json, err := json.Marshal(vr)
							if err != nil {
								g.logger.Error("Failed to marshal Google voided purchase.", zap.Error(err))
								continue
							}

							if g.fnPurchaseRefund != nil {
								if err = g.fnPurchaseRefund(g.ctx, validatedPurchase, string(json)); err != nil {
									g.logger.Warn("Failed to invoke Google purchase refund hook", zap.Error(err))
								}
							}
						} else {
							subscription, err := getSubscriptionByOriginalTransactionId(g.ctx, g.logger, g.db, vr.PurchaseToken)
							if err != nil && err != sql.ErrNoRows {
								g.logger.Error("Failed to get subscription by original_transaction_id", zap.Error(err), zap.String("original_transaction_id", vr.PurchaseToken))
								continue
							}

							if subscription == nil {
								// No subscription was found.
								continue
							}

							if subscription.UserId == "" {
								// Subscription belongs to a deleted user.
								continue
							}

							// Refunded subscription.
							if subscription.RefundTime.Seconds != 0 {
								// Subscription refund already handled, skip it.
								continue
							}

							refundTimeInt, err := strconv.ParseInt(vr.VoidedTimeMillis, 10, 64)
							if err != nil {
								g.logger.Error("Failed to parse Google subscription voided time", zap.Error(err), zap.String("voided_time", vr.VoidedTimeMillis))
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

							err = upsertSubscription(g.ctx, g.db, sSubscription)
							if err != nil {
								g.logger.Error("Failed to upsert Google voided subscription", zap.Error(err), zap.String("purchase_token", vr.PurchaseToken))
								continue
							}

							active := false
							if sSubscription.expireTime.After(time.Now()) {
								active = true
							}

							suid := sSubscription.userID.String()
							if sSubscription.userID.IsNil() {
								suid = ""
							}

							validatedSubscription := &api.ValidatedSubscription{
								UserId:                suid,
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

							json, err := json.Marshal(vr)
							if err != nil {
								g.logger.Error("Failed to marshal Google voided purchase.", zap.Error(err))
								continue
							}

							if g.fnSubscriptionRefund != nil {
								if err = g.fnSubscriptionRefund(g.ctx, validatedSubscription, string(json)); err != nil {
									g.logger.Warn("Failed to invoke Google subscription refund hook", zap.Error(err))
								}
							}
						}
					}
				}
			}
		}()
	}
}

func (g *LocalGoogleRefundScheduler) Pause() {
	g.active.Store(0)
}

func (g *LocalGoogleRefundScheduler) Resume() {
	g.active.Store(1)
}

func (g *LocalGoogleRefundScheduler) Stop() {
	g.ctxCancelFn()
}
