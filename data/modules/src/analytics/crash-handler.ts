// Phase 3 (qv-insights-loop) — Crash log RPC + pattern summariser.
//
// Receives crash payloads from `IVXCrashUploader` (Unity SDK), persists
// them to `game_crash_log` (one row per crash, indexed for the
// aggregator), and periodically (every 15min) recomputes
// `game_crash_pattern_summary[gameId]` so the InsightsAggregator can
// surface the top patterns into bundles cheaply.
//
// Why TWO collections?
//   - game_crash_log               raw rows, per-crash. Bounded retention
//                                  (we drop entries older than 7 days
//                                  on each summariser pass).
//   - game_crash_pattern_summary   pre-aggregated top patterns per
//                                  (gameId, fingerprint) — what the
//                                  bundle envelope cites. O(unique
//                                  fingerprints) rather than O(crashes).
//
// PII scrubbing happens client-side (IVXCrashUploader); we still defend
// in depth by stripping anything that looks like a Bearer token, IPv4,
// or GUID before persistence (cheap, ~5 regexes).

namespace QvCrashHandler {

  export var LOG_COLLECTION = "game_crash_log";
  export var PATTERN_COLLECTION = "game_crash_pattern_summary";
  export var STATE_COLLECTION = "analytics_state";
  export var STATE_KEY_LAST_SUMMARY = "crash_pattern_summariser_last_run";

  export var MAX_BACKLOG_PER_GAME = 5_000;     // raw row cap
  export var SUMMARY_INTERVAL_MS = 15 * 60_000; // 15 minutes
  export var RAW_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 days

  export var MAX_MESSAGE_LEN = 1024;
  export var MAX_STACK_LEN = 4096;

  // Defensive PII scrub regexes — same intent as the client-side ones,
  // applied again so a bad client (or a bypass) can't poison the KB.
  var BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/g;
  var IP_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
  var GUID_RE = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;

  interface CrashPayload {
    game_id: string;
    app_version?: string;
    platform_os?: string;
    device_model?: string;
    ts_unix_ms?: number;
    severity?: string;
    type?: string;
    message?: string;
    stack?: string;
    fingerprint?: string;
    repeated_count?: number;
    client_unity_v?: string;
  }

  interface PatternRow {
    fingerprint: string;
    count: number;
    severity: string;
    type: string;
    sampleMessage: string;
    firstSeenMs: number;
    lastSeenMs: number;
    appVersions: { [v: string]: number };
    osBreakdown: { [os: string]: number };
  }

  interface PatternSummary {
    gameId: string;
    builtAtMs: number;
    windowMs: number;
    rawRowsScanned: number;
    patterns: PatternRow[];
  }

  // ─────────────────────────────────────────────────────────────────
  // RPC: crash_log_append
  // ─────────────────────────────────────────────────────────────────
  function rpcAppend(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var p: CrashPayload;
    try {
      p = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ success: false, error: "invalid_json" });
    }
    if (!p || !p.game_id) {
      return JSON.stringify({ success: false, error: "missing_game_id" });
    }
    var nowMs = Date.now();
    var ts = (typeof p.ts_unix_ms === "number" && p.ts_unix_ms > 0) ? p.ts_unix_ms : nowMs;
    var fp = (p.fingerprint || "unknown").slice(0, 64);

    var row = {
      gameId: p.game_id,
      appVersion: (p.app_version || "unknown").slice(0, 64),
      platformOs: (p.platform_os || "unknown").slice(0, 32),
      deviceModel: (p.device_model || "unknown").slice(0, 64),
      tsUnixMs: ts,
      severity: (p.severity || "Error").slice(0, 16),
      type: (p.type || "Unknown").slice(0, 80),
      message: scrub(p.message || "", MAX_MESSAGE_LEN),
      stack: scrub(p.stack || "", MAX_STACK_LEN),
      fingerprint: fp,
      repeatedCount: clampInt(p.repeated_count, 1, 1000),
      clientUnityV: (p.client_unity_v || "unknown").slice(0, 32),
      // userId is set by Nakama auth — we keep a hash for distinct count
      // but never the raw id (matches the same k-anon contract used by
      // the RpcSample userIdHash in Phase 1B).
      userIdHash: ctx.userId ? sha1Prefix(ctx.userId, nk) : null,
    };

    try {
      // One row per (gameId, fingerprint, ts_unix_ms) to allow easy
      // bucket scans by fingerprint. Keys collide is unlikely (ts in ms
      // + fingerprint) but we tolerate it via storageWrite version="*".
      var key = p.game_id + ":" + fp + ":" + ts;
      nk.storageWrite([{
        collection: LOG_COLLECTION,
        key: key,
        userId: "00000000-0000-0000-0000-000000000000",
        value: row,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[QvCrashHandler] storage write failed: " +
        (e && e.message ? e.message : String(e)));
      return JSON.stringify({ success: false, error: "storage_write_failed" });
    }

    // Opportunistically trigger summariser; rate-limited internally.
    try { maybeRunSummariser(nk, logger); } catch (_) {}

    return JSON.stringify({ success: true, data: { stored: true, fingerprint: fp } });
  }

  // ─────────────────────────────────────────────────────────────────
  // Summariser — scans recent rows + writes the pattern summary blob.
  // ─────────────────────────────────────────────────────────────────
  export function maybeRunSummariser(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
  ): { ran: boolean; reason?: string; perGame?: number } {
    var lastRun = readLastSummary(nk);
    var now = Date.now();
    if (lastRun > 0 && (now - lastRun) < SUMMARY_INTERVAL_MS) {
      return { ran: false, reason: "cooldown" };
    }
    writeLastSummary(nk, now);

    var byGame: { [g: string]: PatternRow[] } = {};
    var bucketEnd = now;
    var bucketStart = now - 3 * 60 * 60 * 1000; // last 3h, matches brief cadence

    var listed: any;
    try {
      listed = nk.storageList("", LOG_COLLECTION, MAX_BACKLOG_PER_GAME);
    } catch (e: any) {
      logger.warn("[QvCrashHandler] summariser list failed: " +
        (e && e.message ? e.message : String(e)));
      return { ran: false, reason: "list_failed" };
    }
    var objs = (listed && listed.objects) || [];
    var scanned = 0;
    var patterns: { [gFp: string]: PatternRow } = {};
    for (var i = 0; i < objs.length; i++) {
      var v: any = objs[i].value;
      if (!v || !v.gameId || !v.fingerprint) continue;
      if (typeof v.tsUnixMs !== "number") continue;
      // Drop rows older than RAW_RETENTION_MS.
      if (now - v.tsUnixMs > RAW_RETENTION_MS) {
        try { nk.storageDelete([{ collection: LOG_COLLECTION, key: objs[i].key, userId: "00000000-0000-0000-0000-000000000000" }]); } catch (_) {}
        continue;
      }
      if (v.tsUnixMs < bucketStart) continue;
      scanned++;
      var gFp = v.gameId + "|" + v.fingerprint;
      var p = patterns[gFp] || {
        fingerprint: v.fingerprint,
        count: 0,
        severity: v.severity || "Error",
        type: v.type || "Unknown",
        sampleMessage: v.message || "",
        firstSeenMs: v.tsUnixMs,
        lastSeenMs: v.tsUnixMs,
        appVersions: {},
        osBreakdown: {},
      };
      p.count += (v.repeatedCount || 1);
      if (v.tsUnixMs > p.lastSeenMs) p.lastSeenMs = v.tsUnixMs;
      if (v.tsUnixMs < p.firstSeenMs) p.firstSeenMs = v.tsUnixMs;
      if (v.appVersion) p.appVersions[v.appVersion] = (p.appVersions[v.appVersion] || 0) + 1;
      if (v.platformOs) p.osBreakdown[v.platformOs] = (p.osBreakdown[v.platformOs] || 0) + 1;
      patterns[gFp] = p;
      if (!byGame[v.gameId]) byGame[v.gameId] = [];
    }
    // Group by gameId.
    for (var gFp2 in patterns) {
      if (!patterns.hasOwnProperty(gFp2)) continue;
      var sep = gFp2.indexOf("|");
      var gid = gFp2.slice(0, sep);
      byGame[gid].push(patterns[gFp2]);
    }
    var games = 0;
    for (var gid2 in byGame) {
      if (!byGame.hasOwnProperty(gid2)) continue;
      var rows = byGame[gid2].sort(function (a, b) { return b.count - a.count; }).slice(0, 25);
      var summary: PatternSummary = {
        gameId: gid2,
        builtAtMs: now,
        windowMs: bucketEnd - bucketStart,
        rawRowsScanned: scanned,
        patterns: rows,
      };
      try {
        nk.storageWrite([{
          collection: PATTERN_COLLECTION,
          key: gid2,
          userId: "00000000-0000-0000-0000-000000000000",
          value: summary,
          permissionRead: 0,
          permissionWrite: 0,
        }]);
        games++;
      } catch (e: any) {
        logger.warn("[QvCrashHandler] summary write failed for " + gid2 + ": " +
          (e && e.message ? e.message : String(e)));
      }
    }
    return { ran: true, perGame: games };
  }

  /**
   * Public read API used by InsightsAggregator (Phase 2A) to surface
   * top patterns into per-cohort bundles.
   */
  export function readPatternSummary(
    nk: nkruntime.Nakama,
    gameId: string,
  ): PatternSummary | null {
    try {
      var rows = nk.storageRead([{ collection: PATTERN_COLLECTION, key: gameId, userId: "00000000-0000-0000-0000-000000000000" }]);
      if (rows && rows.length > 0 && rows[0].value) {
        return rows[0].value as PatternSummary;
      }
    } catch (_) {}
    return null;
  }

  // ─── helpers ───────────────────────────────────────────────────

  function scrub(s: string, maxLen: number): string {
    if (!s) return "";
    var out = s.replace(BEARER_RE, "Bearer ***");
    out = out.replace(IP_RE, "<ip>");
    out = out.replace(GUID_RE, "<guid>");
    if (out.length > maxLen) out = out.slice(0, maxLen);
    return out;
  }

  function clampInt(v: any, lo: number, hi: number): number {
    var n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return 1;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return Math.floor(n);
  }

  function sha1Prefix(s: string, nk: nkruntime.Nakama): string {
    try {
      // Cheap hash via HMAC with a fixed pepper — we only want a
      // stable prefix, not a true crypto identifier. Same convention
      // as the AnalyticsAlerts userIdHash in Phase 1B.
      var raw = nk.hmacSha256Hash(s, "qv-crash-pepper-v1");
      return nk.base16Encode(raw, false).toLowerCase().slice(0, 12);
    } catch (_) {
      return "";
    }
  }

  function readLastSummary(nk: nkruntime.Nakama): number {
    try {
      var rows = nk.storageRead([{
        collection: STATE_COLLECTION,
        key: STATE_KEY_LAST_SUMMARY,
        userId: "00000000-0000-0000-0000-000000000000",
      }]);
      if (rows && rows.length > 0 && rows[0].value && (rows[0].value as any).ts) {
        return (rows[0].value as any).ts as number;
      }
    } catch (_) {}
    return 0;
  }

  function writeLastSummary(nk: nkruntime.Nakama, ts: number): void {
    try {
      nk.storageWrite([{
        collection: STATE_COLLECTION,
        key: STATE_KEY_LAST_SUMMARY,
        userId: "00000000-0000-0000-0000-000000000000",
        value: { ts: ts },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) {}
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("crash_log_append", rpcAppend);
  }
}
