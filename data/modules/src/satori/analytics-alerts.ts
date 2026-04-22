// =============================================================================
// AnalyticsAlerts — Hardened RPC analytics + Discord summaries for Nakama
// =============================================================================
// Mirrors the Intelliverse-X-AI Tier-3 hardened analytics scheduler:
//   • Auto-instruments every registered RPC (latency + success + error)
//   • In-memory sample buffer flushed to Nakama storage (multi-replica safe)
//   • Cron-aligned 3-hour slot summaries posted to Discord
//   • Multi-replica safe leader election via storageWrite version="*"
//   • Opportunistic scheduling (on RPC) + external CronJob tick RPC
//   • Top-slow / top-error RPC deep-dive in the same payload
//
// All code lives in a single namespace so the TypeScript build (concatenated
// to a single index.js) has zero ordering dependencies.
// =============================================================================
namespace AnalyticsAlerts {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  var SAMPLE_COLLECTION = "analytics_rpc_samples";
  var STATE_COLLECTION = "analytics_state";
  var LOCK_COLLECTION = "analytics_locks";

  // 3-hour window for general Nakama RPC summary (Intelliverse-X-AI used 3h for AI / 5h for Notes;
  // Nakama RPCs have a more uniform load so a single 3h cadence keeps signal high).
  var SUMMARY_INTERVAL_MS = 3 * 60 * 60 * 1000;
  var SUMMARY_SLOT_KEY = "last_posted_3h";

  // Lock TTL — long enough to cover slot post + flush, short enough to free quickly on crash.
  var LOCK_TTL_MS = 5 * 60 * 1000;

  // In-memory buffer thresholds (per replica).
  var BUFFER_MAX_SIZE = 50;
  var BUFFER_FLUSH_INTERVAL_MS = 30 * 1000;

  // Sample retention — drop anything older than 24h.
  var SAMPLE_RETENTION_MS = 24 * 60 * 60 * 1000;

  // Opportunistic scheduler: at most one tick attempt every 60s per replica.
  var TICK_RATE_LIMIT_MS = 60 * 1000;

  // Deep-dive top-N for slowest / most-errored RPCs.
  var TOP_N = 5;

  // Webhook env var name (set on the Nakama deployment).
  var WEBHOOK_ENV = "DISCORD_NAKAMA_WEBHOOK_URL";

  var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  // RPC ID prefix → human-readable group label (matches the user request).
  var GROUP_PREFIXES: { prefix: string; label: string }[] = [
    { prefix: "hiro_", label: "Hiro" },
    { prefix: "satori_", label: "Satori" },
    { prefix: "cricket_", label: "Cricket" },
    { prefix: "creator_event_", label: "CreatorEvents" },
    { prefix: "intellidraws_", label: "IntelliDraws" },
    { prefix: "quizverse_", label: "QuizVerse" },
    { prefix: "quiz_", label: "Quiz" },
    { prefix: "wallet_", label: "Wallet" },
    { prefix: "global_wallet_", label: "Wallet" },
    { prefix: "friends_", label: "Social" },
    { prefix: "groups_", label: "Social" },
    { prefix: "admin_", label: "Admin" },
    { prefix: "analytics_", label: "Analytics" },
    { prefix: "fantasy_", label: "Fantasy" },
    { prefix: "push_", label: "Push" },
    { prefix: "video_", label: "Video" },
    { prefix: "leaderboard_", label: "Leaderboards" },
  ];

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------
  export interface RpcSample {
    ts: number;          // unix ms
    rpc: string;         // rpc id
    group: string;       // resolved group label
    durMs: number;       // wall-clock duration
    ok: boolean;         // success
    err?: string;        // truncated error message
    userId?: string;     // optional user id
  }

  interface SlotState {
    slotIso: string;
    postedAt: number;
    podId: string;
  }

  interface LockObject {
    holder: string;
    expiresAt: number;
  }

  // ---------------------------------------------------------------------------
  // Module-level state (per replica / VM)
  // ---------------------------------------------------------------------------
  var podId: string = "pod_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
  var webhookUrl: string = "";
  var instrumentationActive: boolean = false;

  var buffer: RpcSample[] = [];
  var lastBufferFlushMs: number = 0;
  var bufferSeq: number = 0;

  var lastTickAttemptMs: number = 0;
  var totalRecorded: number = 0;
  var totalFlushed: number = 0;
  var totalErrors: number = 0;

  // ---------------------------------------------------------------------------
  // Public init — called from InitModule with ctx so we can read env.
  // ---------------------------------------------------------------------------
  export function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void {
    try {
      if (ctx.env && ctx.env[WEBHOOK_ENV]) {
        webhookUrl = ctx.env[WEBHOOK_ENV] || "";
      }
      logger.info(
        "[AnalyticsAlerts] init pod=%s webhook=%s interval=%sms",
        podId,
        webhookUrl ? "configured" : "MISSING (" + WEBHOOK_ENV + ")",
        String(SUMMARY_INTERVAL_MS),
      );
    } catch (e: any) {
      logger.warn("[AnalyticsAlerts] init failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ---------------------------------------------------------------------------
  // Group resolution
  // ---------------------------------------------------------------------------
  export function groupForRpc(rpcId: string): string {
    if (!rpcId) return "Other";
    for (var i = 0; i < GROUP_PREFIXES.length; i++) {
      if (rpcId.indexOf(GROUP_PREFIXES[i].prefix) === 0) {
        return GROUP_PREFIXES[i].label;
      }
    }
    return "Other";
  }

  // ---------------------------------------------------------------------------
  // recordSample — buffered per replica, flushed on threshold/interval.
  // ---------------------------------------------------------------------------
  export function recordSample(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    rpc: string,
    durMs: number,
    ok: boolean,
    err?: string,
    userId?: string,
  ): void {
    try {
      var s: RpcSample = {
        ts: Date.now(),
        rpc: rpc,
        group: groupForRpc(rpc),
        durMs: Math.round(durMs),
        ok: ok,
      };
      if (err) s.err = String(err).slice(0, 240);
      if (userId) s.userId = userId;
      buffer.push(s);
      totalRecorded++;

      var now = Date.now();
      var shouldFlush = buffer.length >= BUFFER_MAX_SIZE
        || (now - lastBufferFlushMs) >= BUFFER_FLUSH_INTERVAL_MS;

      if (shouldFlush) {
        flushBuffer(nk, logger);
      }

      // Opportunistic scheduler — try to post a summary if a slot has just closed.
      if ((now - lastTickAttemptMs) >= TICK_RATE_LIMIT_MS) {
        lastTickAttemptMs = now;
        try {
          runSchedulerTick(nk, logger);
        } catch (_) {
          // never break the host RPC
        }
      }
    } catch (e: any) {
      // analytics must never throw into the host RPC
      try { logger.warn("[AnalyticsAlerts] recordSample swallowed error: " + (e && e.message ? e.message : String(e))); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // flushBuffer — writes the in-memory samples to one storage record.
  // Key collision is avoided by including pod id + monotonic sequence.
  // ---------------------------------------------------------------------------
  function flushBuffer(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    if (buffer.length === 0) return;
    var batch = buffer;
    buffer = [];
    lastBufferFlushMs = Date.now();
    bufferSeq++;

    try {
      var key = pad(lastBufferFlushMs) + "_" + podId + "_" + bufferSeq;
      nk.storageWrite([{
        collection: SAMPLE_COLLECTION,
        key: key,
        userId: SYSTEM_USER,
        value: { samples: batch, podId: podId, ts: lastBufferFlushMs },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
      totalFlushed += batch.length;
    } catch (e: any) {
      totalErrors++;
      // restore samples on failure (best-effort)
      try {
        for (var i = 0; i < batch.length && buffer.length < BUFFER_MAX_SIZE * 2; i++) {
          buffer.push(batch[i]);
        }
      } catch (_) {}
      try { logger.warn("[AnalyticsAlerts] flushBuffer failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
    }
  }

  function pad(n: number): string {
    var s = String(n);
    while (s.length < 14) s = "0" + s;
    return s;
  }

  // ---------------------------------------------------------------------------
  // getSamplesInWindow — reads samples from storage between [startMs, endMs).
  // Uses storageList with cursor pagination.
  // ---------------------------------------------------------------------------
  export function getSamplesInWindow(
    nk: nkruntime.Nakama,
    startMs: number,
    endMs: number,
    maxRecords?: number,
  ): RpcSample[] {
    var out: RpcSample[] = [];
    var cursor: string | undefined = undefined;
    var pages = 0;
    var maxPages = maxRecords ? Math.ceil(maxRecords / 100) : 200;
    var pageSize = 100;

    do {
      var listResp: any;
      try {
        listResp = nk.storageList(SYSTEM_USER, SAMPLE_COLLECTION, pageSize, cursor);
      } catch (_) {
        break;
      }
      var objects = listResp && listResp.objects ? listResp.objects : [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj || !obj.value) continue;
        var ts = obj.value.ts || 0;
        // Quick filter on flush-time timestamp (samples within a flush are within a 30s window).
        if (ts < startMs - BUFFER_FLUSH_INTERVAL_MS - 5000) continue;
        if (ts >= endMs + BUFFER_FLUSH_INTERVAL_MS + 5000) continue;
        var samples = obj.value.samples || [];
        for (var j = 0; j < samples.length; j++) {
          var s = samples[j];
          if (!s || typeof s.ts !== "number") continue;
          if (s.ts >= startMs && s.ts < endMs) out.push(s);
        }
      }
      cursor = listResp && listResp.cursor ? listResp.cursor : undefined;
      pages++;
    } while (cursor && pages < maxPages);

    return out;
  }

  // ---------------------------------------------------------------------------
  // cleanupOldSamples — deletes records whose flush ts is older than retention.
  // ---------------------------------------------------------------------------
  export function cleanupOldSamples(nk: nkruntime.Nakama, logger: nkruntime.Logger): number {
    var threshold = Date.now() - SAMPLE_RETENTION_MS;
    var cursor: string | undefined = undefined;
    var deleted = 0;
    var pages = 0;

    do {
      var listResp: any;
      try {
        listResp = nk.storageList(SYSTEM_USER, SAMPLE_COLLECTION, 100, cursor);
      } catch (_) {
        break;
      }
      var objects = listResp && listResp.objects ? listResp.objects : [];
      var toDelete: nkruntime.StorageDeleteRequest[] = [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj || !obj.value) continue;
        var ts = obj.value.ts || 0;
        if (ts > 0 && ts < threshold) {
          toDelete.push({ collection: SAMPLE_COLLECTION, key: obj.key, userId: SYSTEM_USER });
        }
      }
      if (toDelete.length > 0) {
        try {
          nk.storageDelete(toDelete);
          deleted += toDelete.length;
        } catch (e: any) {
          try { logger.warn("[AnalyticsAlerts] cleanup delete failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
        }
      }
      cursor = listResp && listResp.cursor ? listResp.cursor : undefined;
      pages++;
    } while (cursor && pages < 100);

    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Leader election — multi-replica safe via storageWrite version="*".
  // ---------------------------------------------------------------------------
  export function tryAcquireSlotLock(nk: nkruntime.Nakama, slotIso: string): boolean {
    var key = "lock_3h_" + slotIso;
    var now = Date.now();
    var lockObj: LockObject = { holder: podId, expiresAt: now + LOCK_TTL_MS };

    // Fast path: try create-only (version="*") — succeeds only if lock doesn't exist.
    try {
      nk.storageWrite([{
        collection: LOCK_COLLECTION,
        key: key,
        userId: SYSTEM_USER,
        value: lockObj,
        permissionRead: 0,
        permissionWrite: 0,
        version: "*",
      }]);
      return true;
    } catch (_) {
      // existed; check expiry / steal
    }

    // Slow path: read existing lock; if expired, try to steal with the existing version hash.
    try {
      var read = nk.storageRead([{ collection: LOCK_COLLECTION, key: key, userId: SYSTEM_USER }]);
      if (!read || read.length === 0) {
        // race: gone now — try create again
        try {
          nk.storageWrite([{
            collection: LOCK_COLLECTION,
            key: key,
            userId: SYSTEM_USER,
            value: lockObj,
            permissionRead: 0,
            permissionWrite: 0,
            version: "*",
          }]);
          return true;
        } catch (_) {
          return false;
        }
      }
      var existing: any = read[0].value || {};
      if (existing.expiresAt && existing.expiresAt > now) {
        // Held and not expired
        return false;
      }
      // Expired — steal with conditional version
      var ver = read[0].version;
      try {
        nk.storageWrite([{
          collection: LOCK_COLLECTION,
          key: key,
          userId: SYSTEM_USER,
          value: lockObj,
          permissionRead: 0,
          permissionWrite: 0,
          version: ver,
        }]);
        return true;
      } catch (_) {
        return false;
      }
    } catch (_) {
      return false;
    }
  }

  function releaseSlotLock(nk: nkruntime.Nakama, slotIso: string): void {
    var key = "lock_3h_" + slotIso;
    try {
      nk.storageDelete([{ collection: LOCK_COLLECTION, key: key, userId: SYSTEM_USER }]);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Last-posted-slot persistence
  // ---------------------------------------------------------------------------
  function recordLastPostedSlot(nk: nkruntime.Nakama, slotIso: string): void {
    var state: SlotState = { slotIso: slotIso, postedAt: Date.now(), podId: podId };
    try {
      nk.storageWrite([{
        collection: STATE_COLLECTION,
        key: SUMMARY_SLOT_KEY,
        userId: SYSTEM_USER,
        value: state,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) {}
  }

  function getLastPostedSlot(nk: nkruntime.Nakama): string {
    try {
      var read = nk.storageRead([{ collection: STATE_COLLECTION, key: SUMMARY_SLOT_KEY, userId: SYSTEM_USER }]);
      if (read && read.length > 0 && read[0].value && read[0].value.slotIso) {
        return read[0].value.slotIso;
      }
    } catch (_) {}
    return "";
  }

  // ---------------------------------------------------------------------------
  // Slot math — cron-aligned to UTC 00,03,06,09,12,15,18,21
  // ---------------------------------------------------------------------------
  export function lastClosedSlotStart(intervalMs: number, nowMs: number): number {
    return Math.floor(nowMs / intervalMs) * intervalMs - intervalMs;
  }

  // ---------------------------------------------------------------------------
  // Stats helpers
  // ---------------------------------------------------------------------------
  export function percentile(sortedAsc: number[], p: number): number {
    if (!sortedAsc || sortedAsc.length === 0) return 0;
    if (sortedAsc.length === 1) return sortedAsc[0];
    var rank = (p / 100) * (sortedAsc.length - 1);
    var lo = Math.floor(rank);
    var hi = Math.ceil(rank);
    if (lo === hi) return sortedAsc[lo];
    var w = rank - lo;
    return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
  }

  export function latencyStats(samples: RpcSample[]): {
    count: number; avg: number; p50: number; p90: number; p99: number; max: number;
  } {
    if (!samples || samples.length === 0) {
      return { count: 0, avg: 0, p50: 0, p90: 0, p99: 0, max: 0 };
    }
    var arr: number[] = [];
    var sum = 0;
    var max = 0;
    for (var i = 0; i < samples.length; i++) {
      var d = samples[i].durMs || 0;
      arr.push(d);
      sum += d;
      if (d > max) max = d;
    }
    arr.sort(function (a, b) { return a - b; });
    return {
      count: samples.length,
      avg: Math.round(sum / samples.length),
      p50: Math.round(percentile(arr, 50)),
      p90: Math.round(percentile(arr, 90)),
      p99: Math.round(percentile(arr, 99)),
      max: Math.round(max),
    };
  }

  // ---------------------------------------------------------------------------
  // Discord summary builder + poster
  // ---------------------------------------------------------------------------
  function fmtMs(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(2) + "s";
    return Math.round(n) + "ms";
  }

  function buildSummaryEmbed(
    samples: RpcSample[],
    slotStartMs: number,
    slotEndMs: number,
  ): any {
    var total = samples.length;
    var ok = 0;
    var groupMap: { [g: string]: RpcSample[] } = {};
    var rpcMap: { [r: string]: RpcSample[] } = {};
    var errMap: { [r: string]: { total: number; failed: number } } = {};

    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (s.ok) ok++;
      if (!groupMap[s.group]) groupMap[s.group] = [];
      groupMap[s.group].push(s);
      if (!rpcMap[s.rpc]) rpcMap[s.rpc] = [];
      rpcMap[s.rpc].push(s);
      if (!errMap[s.rpc]) errMap[s.rpc] = { total: 0, failed: 0 };
      errMap[s.rpc].total++;
      if (!s.ok) errMap[s.rpc].failed++;
    }

    var overall = latencyStats(samples);
    var successRate = total > 0 ? Math.round((ok / total) * 1000) / 10 : 100;

    var fields: any[] = [];

    // Window
    fields.push({
      name: "🕒 Window",
      value:
        "`" + new Date(slotStartMs).toISOString() + "`\n→ `" +
        new Date(slotEndMs).toISOString() + "`",
      inline: false,
    });

    // Overall
    fields.push({
      name: "📊 Overall",
      value:
        "Calls: **" + total + "**\n" +
        "Success: **" + successRate + "%**\n" +
        "avg: **" + fmtMs(overall.avg) + "**\n" +
        "p50/p90/p99: " + fmtMs(overall.p50) + " / " + fmtMs(overall.p90) + " / " + fmtMs(overall.p99) + "\n" +
        "max: " + fmtMs(overall.max),
      inline: false,
    });

    // Per-group breakdown (sorted by call count, top 8)
    var groupRows: { name: string; samples: RpcSample[]; count: number }[] = [];
    for (var g in groupMap) {
      if (groupMap.hasOwnProperty(g)) groupRows.push({ name: g, samples: groupMap[g], count: groupMap[g].length });
    }
    groupRows.sort(function (a, b) { return b.count - a.count; });
    var top = groupRows.slice(0, 8);
    var groupLines: string[] = [];
    for (var k = 0; k < top.length; k++) {
      var st = latencyStats(top[k].samples);
      var okC = 0;
      for (var m = 0; m < top[k].samples.length; m++) if (top[k].samples[m].ok) okC++;
      var sr = top[k].count > 0 ? Math.round((okC / top[k].count) * 1000) / 10 : 100;
      groupLines.push(
        "`" + top[k].name + "` " + top[k].count + " calls · " + sr + "% ok · " +
        "p50 " + fmtMs(st.p50) + " / p90 " + fmtMs(st.p90) + " / p99 " + fmtMs(st.p99),
      );
    }
    if (groupLines.length > 0) {
      fields.push({
        name: "🧩 Top Groups",
        value: groupLines.join("\n").slice(0, 1024),
        inline: false,
      });
    }

    // Top slow RPCs (by p99, min 5 calls)
    var rpcRows: { name: string; samples: RpcSample[]; p99: number; count: number }[] = [];
    for (var r in rpcMap) {
      if (rpcMap.hasOwnProperty(r) && rpcMap[r].length >= 5) {
        var stats = latencyStats(rpcMap[r]);
        rpcRows.push({ name: r, samples: rpcMap[r], p99: stats.p99, count: rpcMap[r].length });
      }
    }
    rpcRows.sort(function (a, b) { return b.p99 - a.p99; });
    var slowest = rpcRows.slice(0, TOP_N);
    if (slowest.length > 0) {
      var slowLines: string[] = [];
      for (var n = 0; n < slowest.length; n++) {
        var st2 = latencyStats(slowest[n].samples);
        slowLines.push("`" + slowest[n].name + "` p99=" + fmtMs(st2.p99) +
          " p90=" + fmtMs(st2.p90) + " avg=" + fmtMs(st2.avg) + " · " + slowest[n].count + " calls");
      }
      fields.push({
        name: "🐌 Slowest RPCs (p99)",
        value: slowLines.join("\n").slice(0, 1024),
        inline: false,
      });
    }

    // Top error RPCs
    var errRows: { name: string; total: number; failed: number; rate: number }[] = [];
    for (var er in errMap) {
      if (errMap.hasOwnProperty(er) && errMap[er].failed > 0) {
        errRows.push({
          name: er,
          total: errMap[er].total,
          failed: errMap[er].failed,
          rate: errMap[er].total > 0 ? errMap[er].failed / errMap[er].total : 0,
        });
      }
    }
    errRows.sort(function (a, b) { return b.failed - a.failed; });
    var topErr = errRows.slice(0, TOP_N);
    if (topErr.length > 0) {
      var errLines: string[] = [];
      for (var p2 = 0; p2 < topErr.length; p2++) {
        var pct = Math.round(topErr[p2].rate * 1000) / 10;
        errLines.push("`" + topErr[p2].name + "` " + topErr[p2].failed + "/" + topErr[p2].total +
          " failed (" + pct + "%)");
      }
      fields.push({
        name: "💥 Top Error RPCs",
        value: errLines.join("\n").slice(0, 1024),
        inline: false,
      });
    }

    var color = total === 0 ? 0x95a5a6
      : successRate >= 99 ? 0x2ecc71
      : successRate >= 95 ? 0xf1c40f
      : 0xe74c3c;

    return {
      title: "🎮 Nakama RPC Summary — last 3h",
      description: "Aggregated analytics across all Nakama RPCs.",
      color: color,
      timestamp: new Date().toISOString(),
      footer: { text: "Pod " + podId + " · slot " + new Date(slotStartMs).toISOString() },
      fields: fields,
    };
  }

  function postDiscord(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    embed: any,
  ): boolean {
    if (!webhookUrl) {
      logger.warn("[AnalyticsAlerts] postDiscord skipped: " + WEBHOOK_ENV + " not set");
      return false;
    }
    try {
      var body = JSON.stringify({ embeds: [embed] });
      var headers: { [k: string]: string } = { "Content-Type": "application/json" };
      var resp: any = nk.httpRequest(webhookUrl, "post", headers, body, 5000);
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300) return true;
      logger.warn("[AnalyticsAlerts] discord post non-2xx: code=" + String(code) +
        " body=" + (resp && resp.body ? String(resp.body).slice(0, 200) : ""));
      return false;
    } catch (e: any) {
      logger.warn("[AnalyticsAlerts] discord post failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // postSummaryForSlot — collects samples, builds embed, posts to Discord.
  // Returns true on successful post.
  // ---------------------------------------------------------------------------
  export function postSummaryForSlot(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    slotStartMs: number,
  ): boolean {
    var slotEndMs = slotStartMs + SUMMARY_INTERVAL_MS;
    var samples = getSamplesInWindow(nk, slotStartMs, slotEndMs);
    var embed = buildSummaryEmbed(samples, slotStartMs, slotEndMs);
    var ok = postDiscord(nk, logger, embed);
    if (ok) {
      logger.info("[AnalyticsAlerts] posted 3h summary slot=" +
        new Date(slotStartMs).toISOString() + " samples=" + samples.length);
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // runSchedulerTick — opportunistic + leader-elected post for the last closed slot.
  // ---------------------------------------------------------------------------
  export function runSchedulerTick(nk: nkruntime.Nakama, logger: nkruntime.Logger): {
    posted: boolean; reason: string; slotIso?: string;
  } {
    if (!webhookUrl) return { posted: false, reason: "webhook_not_configured" };

    var now = Date.now();
    var slotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, now);
    var slotIso = new Date(slotStart).toISOString();

    var lastPosted = getLastPostedSlot(nk);
    if (lastPosted === slotIso) {
      return { posted: false, reason: "already_posted", slotIso: slotIso };
    }

    if (!tryAcquireSlotLock(nk, slotIso)) {
      return { posted: false, reason: "lock_held", slotIso: slotIso };
    }

    // Force flush any in-memory samples so the slot read picks them up.
    try { flushBuffer(nk, logger); } catch (_) {}

    var ok = false;
    try {
      ok = postSummaryForSlot(nk, logger, slotStart);
      if (ok) {
        recordLastPostedSlot(nk, slotIso);
        // Periodic cleanup (cheap, only one replica wins)
        try { cleanupOldSamples(nk, logger); } catch (_) {}
      }
    } finally {
      // Always release the lock so another replica can retry on failure.
      releaseSlotLock(nk, slotIso);
    }

    return { posted: ok, reason: ok ? "posted" : "post_failed", slotIso: slotIso };
  }

  // ---------------------------------------------------------------------------
  // instrumentInitializer — proxy that wraps every registerRpc with timing.
  // Must be called BEFORE other modules call register(initializer).
  // ---------------------------------------------------------------------------
  export function instrumentInitializer(
    initializer: nkruntime.Initializer,
    logger: nkruntime.Logger,
  ): nkruntime.Initializer {
    if (instrumentationActive) {
      // Returning a fresh proxy is harmless but the flag prevents double-counting logs.
    }
    instrumentationActive = true;

    var proxy: any = Object.create(initializer);
    proxy.registerRpc = function (id: string, fn: nkruntime.RpcFunction) {
      var wrapped: nkruntime.RpcFunction = function (
        ctx: nkruntime.Context,
        rpcLogger: nkruntime.Logger,
        nk: nkruntime.Nakama,
        payload: string,
      ): string | void {
        var start = Date.now();
        var userId: string | undefined;
        try { userId = ctx && ctx.userId ? ctx.userId : undefined; } catch (_) {}
        try {
          var out = fn(ctx, rpcLogger, nk, payload);
          recordSample(nk, rpcLogger, id, Date.now() - start, true, undefined, userId);
          return out;
        } catch (err: any) {
          var msg = err && err.message ? err.message : String(err);
          recordSample(nk, rpcLogger, id, Date.now() - start, false, msg, userId);
          throw err;
        }
      };
      initializer.registerRpc(id, wrapped);
    };
    logger.info("[AnalyticsAlerts] initializer instrumented — all RPCs will be sampled");
    return proxy as nkruntime.Initializer;
  }

  // ---------------------------------------------------------------------------
  // RPC handlers (admin-style; gated by HTTP key via ctx)
  // ---------------------------------------------------------------------------
  function rpcTick(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string,
  ): string {
    var res = runSchedulerTick(nk, logger);
    return JSON.stringify({ success: true, data: res });
  }

  function rpcStatus(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string,
  ): string {
    var lastPosted = getLastPostedSlot(nk);
    var nextSlotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, Date.now());
    return JSON.stringify({
      success: true,
      data: {
        podId: podId,
        webhookConfigured: !!webhookUrl,
        intervalMs: SUMMARY_INTERVAL_MS,
        bufferSize: buffer.length,
        bufferMax: BUFFER_MAX_SIZE,
        lastBufferFlushMs: lastBufferFlushMs,
        lastTickAttemptMs: lastTickAttemptMs,
        totalRecorded: totalRecorded,
        totalFlushed: totalFlushed,
        totalErrors: totalErrors,
        lastPostedSlot: lastPosted,
        currentSlotStart: new Date(nextSlotStart).toISOString(),
        currentSlotEnd: new Date(nextSlotStart + SUMMARY_INTERVAL_MS).toISOString(),
        instrumentationActive: instrumentationActive,
      },
    });
  }

  function rpcRecent(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: any = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var minutes = typeof p.minutes === "number" && p.minutes > 0 ? p.minutes : 60;
    var limit = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 5000) : 500;

    var endMs = Date.now();
    var startMs = endMs - minutes * 60 * 1000;
    var samples = getSamplesInWindow(nk, startMs, endMs, limit);
    samples.sort(function (a, b) { return b.ts - a.ts; });
    if (samples.length > limit) samples = samples.slice(0, limit);
    return JSON.stringify({ success: true, data: { count: samples.length, samples: samples } });
  }

  function rpcSummary(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: any = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
    var endMs = Date.now();
    var startMs = endMs - hours * 60 * 60 * 1000;
    var samples = getSamplesInWindow(nk, startMs, endMs);
    var overall = latencyStats(samples);

    var groupMap: { [g: string]: RpcSample[] } = {};
    var rpcMap: { [r: string]: RpcSample[] } = {};
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!groupMap[s.group]) groupMap[s.group] = [];
      groupMap[s.group].push(s);
      if (!rpcMap[s.rpc]) rpcMap[s.rpc] = [];
      rpcMap[s.rpc].push(s);
    }

    var groupStats: any = {};
    for (var g in groupMap) {
      if (groupMap.hasOwnProperty(g)) {
        var st = latencyStats(groupMap[g]);
        var okC = 0;
        for (var j = 0; j < groupMap[g].length; j++) if (groupMap[g][j].ok) okC++;
        groupStats[g] = {
          count: st.count,
          successRate: groupMap[g].length > 0 ? okC / groupMap[g].length : 1,
          avg: st.avg, p50: st.p50, p90: st.p90, p99: st.p99, max: st.max,
        };
      }
    }

    var rpcStats: any = {};
    for (var r in rpcMap) {
      if (rpcMap.hasOwnProperty(r)) {
        var rst = latencyStats(rpcMap[r]);
        var okR = 0;
        for (var k = 0; k < rpcMap[r].length; k++) if (rpcMap[r][k].ok) okR++;
        rpcStats[r] = {
          count: rst.count,
          successRate: rpcMap[r].length > 0 ? okR / rpcMap[r].length : 1,
          avg: rst.avg, p50: rst.p50, p90: rst.p90, p99: rst.p99, max: rst.max,
        };
      }
    }

    return JSON.stringify({
      success: true,
      data: {
        windowHours: hours,
        startIso: new Date(startMs).toISOString(),
        endIso: new Date(endMs).toISOString(),
        overall: overall,
        byGroup: groupStats,
        byRpc: rpcStats,
      },
    });
  }

  function rpcTopSlow(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: any = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
    var topN = typeof p.top === "number" && p.top > 0 ? p.top : 10;
    var minCalls = typeof p.minCalls === "number" && p.minCalls >= 1 ? p.minCalls : 5;
    var endMs = Date.now();
    var startMs = endMs - hours * 60 * 60 * 1000;
    var samples = getSamplesInWindow(nk, startMs, endMs);
    var rpcMap: { [r: string]: RpcSample[] } = {};
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!rpcMap[s.rpc]) rpcMap[s.rpc] = [];
      rpcMap[s.rpc].push(s);
    }
    var rows: any[] = [];
    for (var r in rpcMap) {
      if (rpcMap.hasOwnProperty(r) && rpcMap[r].length >= minCalls) {
        var st = latencyStats(rpcMap[r]);
        rows.push({ rpc: r, count: st.count, avg: st.avg, p50: st.p50, p90: st.p90, p99: st.p99, max: st.max });
      }
    }
    rows.sort(function (a, b) { return b.p99 - a.p99; });
    return JSON.stringify({ success: true, data: { hours: hours, top: rows.slice(0, topN) } });
  }

  function rpcTopErrors(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: any = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
    var topN = typeof p.top === "number" && p.top > 0 ? p.top : 10;
    var endMs = Date.now();
    var startMs = endMs - hours * 60 * 60 * 1000;
    var samples = getSamplesInWindow(nk, startMs, endMs);
    var rpcMap: { [r: string]: { total: number; failed: number; lastErr?: string } } = {};
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!rpcMap[s.rpc]) rpcMap[s.rpc] = { total: 0, failed: 0 };
      rpcMap[s.rpc].total++;
      if (!s.ok) {
        rpcMap[s.rpc].failed++;
        if (s.err) rpcMap[s.rpc].lastErr = s.err;
      }
    }
    var rows: any[] = [];
    for (var r in rpcMap) {
      if (rpcMap.hasOwnProperty(r) && rpcMap[r].failed > 0) {
        rows.push({
          rpc: r,
          total: rpcMap[r].total,
          failed: rpcMap[r].failed,
          errorRate: rpcMap[r].failed / rpcMap[r].total,
          lastError: rpcMap[r].lastErr || "",
        });
      }
    }
    rows.sort(function (a, b) { return b.failed - a.failed; });
    return JSON.stringify({ success: true, data: { hours: hours, top: rows.slice(0, topN) } });
  }

  function rpcForcePost(
    _ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: any = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var nowMs = Date.now();
    var slotStart: number;
    if (typeof p.slotStartMs === "number" && p.slotStartMs > 0) {
      slotStart = p.slotStartMs;
    } else if (typeof p.slotStartIso === "string" && p.slotStartIso) {
      slotStart = new Date(p.slotStartIso).getTime();
    } else {
      slotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, nowMs);
    }
    try { flushBuffer(nk, logger); } catch (_) {}
    var ok = postSummaryForSlot(nk, logger, slotStart);
    return JSON.stringify({
      success: ok,
      data: { slotStartIso: new Date(slotStart).toISOString(), posted: ok },
    });
  }

  // ---------------------------------------------------------------------------
  // register — wires the RPCs (NOT instrumented; analytics RPCs sample themselves
  // would create infinite recursion via opportunistic tick path).
  // ---------------------------------------------------------------------------
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("nakama_analytics_tick", rpcTick);
    initializer.registerRpc("nakama_analytics_status", rpcStatus);
    initializer.registerRpc("nakama_analytics_recent", rpcRecent);
    initializer.registerRpc("nakama_analytics_summary", rpcSummary);
    initializer.registerRpc("nakama_analytics_top_slow", rpcTopSlow);
    initializer.registerRpc("nakama_analytics_top_errors", rpcTopErrors);
    initializer.registerRpc("nakama_analytics_force_post", rpcForcePost);
  }
}
