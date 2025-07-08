package server

import (
	"context"
	"database/sql"
	"github.com/heroiclabs/nakama/v3/iap"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"time"
)

type XboxRefundPoller interface {
	Start(runtime *Runtime)
	Pause()
	Resume()
	Stop()
}

type LocalXboxRefundPoller struct {
	ctx         context.Context
	logger      *zap.Logger
	db          *sql.DB
	active      *atomic.Uint32
	ctxCancelFn context.CancelFunc
	config      Config
}

func NewXboxRefundPoller(logger *zap.Logger, db *sql.DB, config Config) *LocalXboxRefundPoller {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	return &LocalXboxRefundPoller{
		ctx:         ctx,
		logger:      logger,
		db:          db,
		active:      atomic.NewUint32(0),
		ctxCancelFn: ctxCancelFn,
		config:      config,
	}
}

func (x *LocalXboxRefundPoller) Start(runtime *Runtime) {
	period := x.config.GetIAP().Xbox.RefundCheckPeriodMin
	if period != 0 {
		if runtime.purchaseNotificationXboxFunction != nil && period != 0 {
			go func() {
				ticker := time.NewTicker(1 * time.Minute)
				defer ticker.Stop()

				for {
					select {
					case <-x.ctx.Done():
						return
					case <-ticker.C:
						provider, err := iap.GetPurchaseProvider("xbox", runtime.purchaseProviders)
						if err != nil {
							x.logger.Error("failed to get purchase provider on xbox refund poller", zap.Error(err))
						}
						_, err = provider.HandleRefund(x.ctx, x.logger, x.db)
						if err != nil {
							x.logger.Error("xbox refund poller failed", zap.Error(err))
							continue
						}
					}
				}
			}()
		}
	}
}

func (x *LocalXboxRefundPoller) Pause() {
	x.active.Store(0)
}

func (x *LocalXboxRefundPoller) Resume() {
	x.active.Store(1)
}

func (x *LocalXboxRefundPoller) Stop() {
	x.ctxCancelFn()
}
