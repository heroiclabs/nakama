// fanout_queue.ts — async notification fan-out queue (G-017 / AP-008).
//
// RULE (doc §E.5): fan-out NEVER happens inline in an RPC handler. A
// 50-member group event = 50 pushes; inline that's a multi-second RPC and a
// Goja-call timeout waiting to happen. Producers enqueue cheap rows; the
// drain tick delivers in bounded batches out-of-band.
//
// PRODUCER API (internal):
//   FanoutQueue.enqueue(nk, logger, items[])
//     item = { targetUserId, eventType, titleKey, bodyKey, vars, data,
//              inAppSubject?, inAppContent? }   — localized push via
//     LegacyPush keys; optional in-app notification mirrored first.
//
// DRAIN:
//   ivx_social_fanout_tick (service token) — also invoked from the hourly
//   maintenance tick as a backstop. Dedicated CronJob runs it every minute
//   (intelli-verse-kube-infra/nakama/social-fanout-cronjob.yaml) so
//   fan-out latency is ≤~60s, not ≤1h.
//   Per-row failures increment attempts; rows are dropped after 3 attempts
//   (push is best-effort by contract — doc §9.1 Tier 3).
//
// STORAGE: ivx_notification_fanout / q_{tsMs}_{rand}   (system-owned).
// Key embeds enqueue time so storageList order approximates FIFO.

namespace FanoutQueue {

  var COLLECTION   = "ivx_notification_fanout";
  var SYSTEM_USER  = "00000000-0000-0000-0000-000000000000";
  var MAX_ATTEMPTS = 3;
  var DRAIN_BATCH  = 200;

  export interface FanoutItem {
    targetUserId: string;
    eventType: string;
    titleKey: string;
    bodyKey: string;
    vars?: any;
    data?: any;
    inAppSubject?: string;
    inAppContent?: any;
    inAppCode?: number;
  }

  export function enqueue(nk: nkruntime.Nakama, logger: nkruntime.Logger, items: FanoutItem[]): number {
    if (!items || items.length === 0) return 0;
    var writes: nkruntime.StorageWriteRequest[] = [];
    var nowMs = Date.now();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.targetUserId || !it.eventType) continue;
      writes.push({
        collection: COLLECTION,
        key: "q_" + nowMs.toString(36) + "_" + i.toString(36) + "_" + Math.floor(Math.random() * 46656).toString(36),
        userId: SYSTEM_USER,
        value: {
          targetUserId: it.targetUserId, eventType: it.eventType,
          titleKey: it.titleKey || "", bodyKey: it.bodyKey || "",
          vars: it.vars || {}, data: it.data || {},
          inAppSubject: it.inAppSubject || "", inAppContent: it.inAppContent || null,
          inAppCode: (typeof it.inAppCode === "number") ? it.inAppCode : 0,
          enqueuedAt: new Date(nowMs).toISOString(), attempts: 0
        },
        permissionRead: 0, permissionWrite: 0
      });
    }
    if (writes.length === 0) return 0;
    try {
      nk.storageWrite(writes);
      return writes.length;
    } catch (e: any) {
      if (logger && logger.warn) logger.warn("[Fanout] enqueue failed: " + (e && e.message));
      return 0;
    }
  }

  export function drain(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, maxRows?: number): any {
    var batch = (typeof maxRows === "number" && maxRows > 0) ? Math.min(maxRows, DRAIN_BATCH) : DRAIN_BATCH;
    var objs: any[] = [];
    try {
      var res: any = nk.storageList(SYSTEM_USER, COLLECTION, batch, undefined as any);
      objs = (res && res.objects) ? res.objects : [];
    } catch (e: any) {
      logger.warn("[Fanout] list failed: " + (e && e.message));
      return { sent: 0, failed: 0, dropped: 0 };
    }

    var sent = 0, failed = 0, dropped = 0;
    var deletes: any[] = [];
    var retries: nkruntime.StorageWriteRequest[] = [];
    var pushAvailable = (typeof LegacyPush !== "undefined" && !!(LegacyPush as any).sendLocalizedPushToUser);

    for (var i = 0; i < objs.length; i++) {
      var row = objs[i];
      if (!row || !row.value) continue;
      var v: any = row.value;
      var ok = true;
      try {
        // Optional in-app tier first (durable), then device push.
        if (v.inAppSubject && v.inAppContent) {
          try {
            var content = v.inAppContent; content.type = v.inAppSubject;
            nk.notificationsSend([{
              userId: v.targetUserId, subject: v.inAppSubject, content: content,
              code: v.inAppCode || 0, persistent: true
            }]);
          } catch (_) { /* in-app best effort inside fan-out */ }
        }
        if (pushAvailable && v.titleKey && v.bodyKey) {
          (LegacyPush as any).sendLocalizedPushToUser(ctx, logger, nk,
            v.targetUserId, v.eventType, v.titleKey, v.bodyKey, v.vars || {},
            { skipInAppNotification: true, data: v.data || {} });
        }
      } catch (sendErr: any) {
        ok = false;
      }

      if (ok) {
        sent++;
        deletes.push({ collection: COLLECTION, key: row.key, userId: SYSTEM_USER });
      } else {
        var attempts = (typeof v.attempts === "number" ? v.attempts : 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          dropped++;
          deletes.push({ collection: COLLECTION, key: row.key, userId: SYSTEM_USER });
        } else {
          failed++;
          v.attempts = attempts;
          retries.push({
            collection: COLLECTION, key: row.key, userId: SYSTEM_USER,
            value: v, permissionRead: 0, permissionWrite: 0
          });
        }
      }
    }

    try { if (deletes.length > 0) nk.storageDelete(deletes); } catch (delErr: any) {
      logger.warn("[Fanout] delete failed: " + (delErr && delErr.message));
    }
    try { if (retries.length > 0) nk.storageWrite(retries); } catch (_) {}

    if (sent + failed + dropped > 0) {
      logger.info("[Fanout] drained: sent=" + sent + " retry=" + failed + " dropped=" + dropped);
    }
    return { sent: sent, failed: failed, dropped: dropped, remainingHint: objs.length >= batch };
  }

  function rpcFanoutTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data: any = {};
    try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                         (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    if (!expected || data.service_token !== expected) {
      return RpcHelpers.errorResponse("service-only", 401);
    }
    return RpcHelpers.successResponse(drain(ctx, logger, nk, data.max_rows));
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_fanout_tick", rpcFanoutTick);
  }
}
