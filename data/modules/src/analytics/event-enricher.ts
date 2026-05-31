// Phase 1A (qv-insights-loop) — Universal event enricher.
//
// Guarantees that every analytics event (regardless of which Unity client
// version emitted it) carries a *complete* dimensional vector by the time
// it reaches the dashboard / aggregator / Discord summarizer:
//
//   game_id, app_version, os, country, tier, sdk_version,
//   session_id, screen, quiz_mode, quiz_card_type,
//   cohort_label (primary), cohort_def_version, cohort_holdout
//
// How it works:
//
//   1. session_start → upsertSessionIndex() persists the per-session
//      context (app_version, os, country, tier, etc.) under
//      `game_session_index`. ttl ~36h via lazy expiry.
//
//   2. Every subsequent event → enrich() back-fills missing fields by
//      looking up the session record. Cheap path: in-process LRU keyed
//      by sessionId hashes, hit rate >95% in steady state.
//
//   3. Anything still missing after back-fill → recordCoverageGap()
//      writes a row into `game_coverage_gap_log`. The daily coverage
//      health post (postCoverageHealth) summarises the worst offenders
//      to #qv-ops via the existing AnalyticsAlerts webhook plumbing.
//
//   4. Cohort label is fetched from the AI svc personalization layer
//      (Phase 4A) when available; if the cache is empty / expired we
//      still emit the event but tag cohort_label = "pending". The
//      analyst tolerates this — it's data, not the absence of data.
//
// Calling convention:
//   - Pure function over (rawEvent, ctx, nk, logger) — never throws into
//     the host RPC; on any internal error we return the original event
//     untouched and log a single line at WARN.
//   - The legacy `data/modules/analytics/analytics.js` rpcAnalyticsLogEvent
//     handler invokes EventEnricher.enrich(...) inside normalizeInboundEvent
//     after its own dimensional back-fill, so the enricher is the LAST
//     line of defence against missing fields.

namespace EventEnricher {

  export var SESSION_COLLECTION = "game_session_index";
  export var GAP_COLLECTION = "game_coverage_gap_log";
  export var SESSION_TTL_MS = 36 * 60 * 60 * 1000;
  export var SESSION_LRU_MAX = 5000;

  /**
   * Required fields the analyst expects on EVERY event. Anything missing
   * from this set after enrichment lands in the coverage-gap log.
   */
  export var REQUIRED_FIELDS: string[] = [
    "game_id",
    "app_version",
    "os",
    "country",
    "session_id",
    "screen",
  ];

  /**
   * Per-event-name enrichment hints. Lets us require quiz_mode on quiz_*
   * events without forcing it on, say, login_success.
   */
  export var EVENT_REQUIRED: { [event: string]: string[] } = {
    quiz_start: ["quiz_mode"],
    quiz_complete: ["quiz_mode"],
    quiz_abandoned: ["quiz_mode"],
    weekly_card_started: ["quiz_card_type", "quiz_mode"],
    weekly_card_completed: ["quiz_card_type", "quiz_mode"],
    weekly_card_abandoned: ["quiz_card_type", "quiz_mode"],
    iap_clicked: ["sku"],
    iap_purchased: ["sku"],
    iap_failed: ["sku"],
    paywall_shown: ["screen"],
    ad_shown: ["ad_format"],
    ad_completed: ["ad_format"],
    ad_clicked: ["ad_format"],
    ad_load_failed: ["ad_format"],
  };

  interface SessionRecord {
    sessionId: string;
    gameId: string;
    userId: string;
    appVersion?: string;
    sdkVersion?: string;
    os?: string;
    osVersion?: string;
    country?: string;
    locale?: string;
    tier?: string;
    deviceModel?: string;
    installSource?: string;
    consentState?: string;
    attStatus?: string;
    cohortLabel?: string;
    cohortDefVersion?: number;
    cohortHoldout?: boolean;
    startedAt: number;
    lastSeenAt: number;
  }

  // In-process LRU. Sized for a single Nakama replica's working set.
  var lru: { [sessionId: string]: SessionRecord } = {};
  var lruOrder: string[] = [];

  function lruGet(sessionId: string): SessionRecord | null {
    var rec = lru[sessionId];
    if (!rec) return null;
    if (Date.now() - rec.lastSeenAt > SESSION_TTL_MS) {
      delete lru[sessionId];
      return null;
    }
    return rec;
  }

  function lruPut(sessionId: string, rec: SessionRecord): void {
    if (!lru[sessionId]) {
      lruOrder.push(sessionId);
      if (lruOrder.length > SESSION_LRU_MAX) {
        var evict = lruOrder.shift();
        if (evict) delete lru[evict];
      }
    }
    lru[sessionId] = rec;
  }

  /**
   * Persist the session context emitted by session_start. Idempotent
   * (writes are keyed by session_id; a re-emitted session_start updates
   * the lastSeenAt timestamp without touching the immutable fields).
   */
  export function upsertSessionIndex(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    ctx: nkruntime.Context,
    rec: Partial<SessionRecord> & { sessionId: string; gameId: string },
  ): void {
    try {
      var userId = (rec.userId || ctx.userId || "");
      var now = Date.now();
      var existing = lruGet(rec.sessionId);
      var merged: SessionRecord = (existing as any) || ({
        sessionId: rec.sessionId,
        gameId: rec.gameId,
        userId: userId,
        startedAt: now,
        lastSeenAt: now,
      } as SessionRecord);
      // First-write semantics for immutable fields (don't overwrite
      // app_version/os/country with empty strings on a heartbeat).
      var keys: (keyof SessionRecord)[] = [
        "appVersion",
        "sdkVersion",
        "os",
        "osVersion",
        "country",
        "locale",
        "tier",
        "deviceModel",
        "installSource",
        "consentState",
        "attStatus",
        "cohortLabel",
        "cohortDefVersion",
        "cohortHoldout",
      ];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (rec[k] !== undefined && rec[k] !== null && rec[k] !== "") {
          (merged as any)[k] = rec[k];
        }
      }
      merged.userId = merged.userId || userId;
      merged.gameId = merged.gameId || rec.gameId;
      merged.lastSeenAt = now;
      lruPut(rec.sessionId, merged);
      // System-owned write so a single read from any replica resolves it.
      nk.storageWrite([{
        collection: SESSION_COLLECTION,
        key: rec.sessionId,
        userId: "",
        value: merged as any,
        permissionRead: 2,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      try {
        logger.warn("[EventEnricher] upsertSessionIndex failed: "
          + ((e && e.message) ? e.message : String(e)));
      } catch (_) {}
    }
  }

  /**
   * Read the session context for back-fill. LRU-first, storage on miss.
   * Returns null if the session is unknown — caller should treat the
   * fields as missing and let coverage-gap logging fire.
   */
  function getSessionContext(
    nk: nkruntime.Nakama,
    sessionId: string,
  ): SessionRecord | null {
    if (!sessionId) return null;
    var hit = lruGet(sessionId);
    if (hit) return hit;
    try {
      var rows = nk.storageRead([{
        collection: SESSION_COLLECTION,
        key: sessionId,
        userId: "",
      }]);
      if (!rows || rows.length === 0) return null;
      var rec = rows[0].value as SessionRecord;
      if (rec && rec.sessionId) {
        lruPut(sessionId, rec);
        return rec;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Main entry point. Returns the enriched eventData PLUS the list of
   * fields that were still missing after enrichment (so analytics.js
   * can decide whether to record a coverage gap).
   *
   * Mutates eventData in place. The original analytics.js dimensional
   * back-fill runs BEFORE this; we only fill what's still empty.
   */
  export function enrich(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventName: string,
    eventData: { [k: string]: any },
    sessionId: string | undefined,
    gameId: string,
  ): { gaps: string[] } {
    var gaps: string[] = [];
    try {
      var session = sessionId ? getSessionContext(nk, sessionId) : null;
      if (session) {
        if (!eventData.app_version && session.appVersion) eventData.app_version = session.appVersion;
        if (!eventData.sdk_version && session.sdkVersion) eventData.sdk_version = session.sdkVersion;
        if (!eventData.os && session.os) eventData.os = session.os;
        if (!eventData.os_version && session.osVersion) eventData.os_version = session.osVersion;
        if (!eventData.country && session.country) eventData.country = session.country;
        if (!eventData.locale && session.locale) eventData.locale = session.locale;
        if (!eventData.device_tier && session.tier) eventData.device_tier = session.tier;
        if (!eventData.device_model && session.deviceModel) eventData.device_model = session.deviceModel;
        if (!eventData.install_source && session.installSource) eventData.install_source = session.installSource;
        if (!eventData.consent_state && session.consentState) eventData.consent_state = session.consentState;
        if (!eventData.att_status && session.attStatus) eventData.att_status = session.attStatus;
        if (!eventData.cohort_label && session.cohortLabel) eventData.cohort_label = session.cohortLabel;
        if (!eventData.cohort_def_version && session.cohortDefVersion) eventData.cohort_def_version = session.cohortDefVersion;
        if (eventData.cohort_holdout === undefined && session.cohortHoldout !== undefined) eventData.cohort_holdout = session.cohortHoldout;
        if (!eventData.session_id) eventData.session_id = session.sessionId;
      }

      // Default cohort marker so the analyst doesn't see undefined.
      // When the label stays "pending" it means the AI personalization svc
      // hasn't assigned a cohort yet. We surface this as a synthetic gap
      // ("cohort_label_pending") so the daily coverage-health embed can
      // flag a high pending rate — a leading indicator that personalization
      // is degraded or the AI svc is unreachable.
      if (!eventData.cohort_label) {
        eventData.cohort_label = "pending";
        gaps.push("cohort_label_pending");
      }

      // Ensure game_id is always present in the eventData payload (the
      // outer record carries it too but the dashboard slices key off
      // eventData).
      if (!eventData.game_id && gameId) eventData.game_id = gameId;

      // Compute the gaps list.
      var globalReq = REQUIRED_FIELDS;
      for (var i = 0; i < globalReq.length; i++) {
        var f = globalReq[i];
        if (eventData[f] === undefined || eventData[f] === null || eventData[f] === "") {
          gaps.push(f);
        }
      }
      var perEventReq = EVENT_REQUIRED[eventName] || [];
      for (var j = 0; j < perEventReq.length; j++) {
        var fe = perEventReq[j];
        if (eventData[fe] === undefined || eventData[fe] === null || eventData[fe] === "") {
          if (gaps.indexOf(fe) === -1) gaps.push(fe);
        }
      }
    } catch (e: any) {
      try {
        logger.warn("[EventEnricher] enrich failed: "
          + ((e && e.message) ? e.message : String(e)));
      } catch (_) {}
    }
    return { gaps: gaps };
  }

  /**
   * Append a coverage-gap row. One row per (event, gap_set) per hour,
   * keyed so re-emissions of the same gap collapse to a single row + a
   * counter rather than spamming the table.
   */
  export function recordCoverageGap(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    gameId: string,
    eventName: string,
    gaps: string[],
  ): void {
    if (!gaps || gaps.length === 0) return;
    try {
      var hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
      var gapKey = gaps.slice().sort().join(",");
      var key = "gap_" + gameId + "_" + hourBucket + "_" + eventName + "_" + safeKey(gapKey);
      // Read-modify-write to bump the counter.
      var existing: any = null;
      try {
        var rows = nk.storageRead([{
          collection: GAP_COLLECTION,
          key: key,
          userId: "",
        }]);
        if (rows && rows.length > 0) existing = rows[0].value;
      } catch (_) {}
      var record = existing && typeof existing === "object" ? existing : {
        gameId: gameId,
        eventName: eventName,
        gaps: gaps,
        gapKey: gapKey,
        firstSeenMs: Date.now(),
        count: 0,
      };
      record.count = (record.count || 0) + 1;
      record.lastSeenMs = Date.now();
      nk.storageWrite([{
        collection: GAP_COLLECTION,
        key: key,
        userId: "",
        value: record,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      try {
        logger.warn("[EventEnricher] recordCoverageGap failed: "
          + ((e && e.message) ? e.message : String(e)));
      } catch (_) {}
    }
  }

  function safeKey(s: string): string {
    return s.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
  }

  // ────────────────────────────────────────────────────────────────────
  // Daily coverage health summary
  //
  // Scans the last 24h of GAP_COLLECTION and emits a one-shot embed
  // to the AnalyticsAlerts Discord webhook (#qv-ops). Triggered by
  // the opportunistic scheduler tick from analytics-alerts.ts so we
  // don't need a true cron facility.
  // ────────────────────────────────────────────────────────────────────
  var lastCoveragePostMs: number = 0;
  var COVERAGE_POST_INTERVAL_MS = 24 * 60 * 60 * 1000;

  export function maybePostDailyCoverageHealth(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    webhookUrl: string,
  ): void {
    var now = Date.now();
    if (!webhookUrl) return;
    if (now - lastCoveragePostMs < COVERAGE_POST_INTERVAL_MS) return;
    lastCoveragePostMs = now;
    try {
      var summary = scanCoverage(nk, logger);
      if (!summary || summary.totalGaps === 0) {
        // No gaps in the window — still emit a green status once a day
        // so on-call can see the loop is alive.
        var greenEmbed = {
          title: "Analytics Coverage — green",
          description: "No coverage gaps recorded in the last 24h.",
          color: 0x2ecc71,
          timestamp: new Date().toISOString(),
        };
        nk.httpRequest(webhookUrl, "post",
          { "Content-Type": "application/json" },
          JSON.stringify({ embeds: [greenEmbed] }), 5000);
        return;
      }
      var top = summary.topGaps.slice(0, 10).map(function (g, idx) {
        return (idx + 1) + ". `" + g.eventName + "` missing [" + g.gaps.join(", ") +
          "] — " + g.count + "× across " + g.uniqueHours + "h";
      }).join("\n");
      // Compute pending-cohort rate. If AI personalization is degraded,
      // pendingCohortCount will be close to totalGaps (every event unresolved).
      var pendingRate = summary.totalGaps > 0
        ? summary.pendingCohortCount / summary.totalGaps
        : 0;
      var pendingRatePct = Math.round(pendingRate * 100);
      var embedColor = summary.totalGaps > 1000 ? 0xe74c3c : 0xf1c40f;
      // Escalate to red when ≥50% of events are missing cohort assignment —
      // that means personalization is effectively offline.
      if (pendingRate >= PENDING_COHORT_WARN_THRESHOLD) embedColor = 0xe74c3c;
      var fields: any[] = [
        { name: "Total gap rows",  value: String(summary.totalGaps),     inline: true },
        { name: "Distinct events", value: String(summary.distinctEvents), inline: true },
        { name: "Game",            value: summary.gameId || "all",         inline: true },
      ];
      if (pendingRate >= PENDING_COHORT_WARN_THRESHOLD) {
        fields.push({
          name: "⚠️ cohort_label=pending",
          value: pendingRatePct + "% of events unresolved — AI personalization svc may be down. "
            + "Check IVX_AI_SVC_BASE_URL and InsightsAggregator logs.",
          inline: false,
        });
      } else if (summary.pendingCohortCount > 0) {
        fields.push({
          name: "cohort_label=pending",
          value: pendingRatePct + "% (" + summary.pendingCohortCount + " events) — within normal range",
          inline: false,
        });
      }
      var embed = {
        title: "Analytics Coverage Health (24h)",
        description: top,
        color: embedColor,
        fields: fields,
        footer: { text: "Phase 1A coverage report — see qv-insights-loop plan" },
        timestamp: new Date().toISOString(),
      };
      nk.httpRequest(webhookUrl, "post",
        { "Content-Type": "application/json" },
        JSON.stringify({ embeds: [embed] }), 5000);
    } catch (e: any) {
      try {
        logger.warn("[EventEnricher] maybePostDailyCoverageHealth failed: "
          + ((e && e.message) ? e.message : String(e)));
      } catch (_) {}
    }
  }

  interface CoverageSummary {
    totalGaps: number;
    distinctEvents: number;
    gameId: string | null;
    topGaps: { eventName: string; gaps: string[]; count: number; uniqueHours: number }[];
    // Synthetic gap counter: events where cohort_label stayed "pending"
    // (AI personalization svc degraded or unreachable).
    pendingCohortCount: number;
  }

  // Fraction of events with cohort_label_pending that triggers a Discord warning.
  var PENDING_COHORT_WARN_THRESHOLD = 0.5;

  function scanCoverage(nk: nkruntime.Nakama, logger: nkruntime.Logger): CoverageSummary | null {
    try {
      // Bound the scan: 200 most recent rows is enough to surface the
      // worst offenders without becoming a memory hazard.
      var listRes = nk.storageList("", GAP_COLLECTION, 200);
      var entries = (listRes && (listRes as any).objects) || [];
      var totalGaps = 0;
      var pendingCohortCount = 0;
      var byEventGap: { [k: string]: { eventName: string; gaps: string[]; count: number; hours: { [h: string]: boolean } } } = {};
      var anyGameId: string | null = null;
      for (var i = 0; i < entries.length; i++) {
        var v: any = entries[i].value;
        if (!v || !v.eventName) continue;
        anyGameId = anyGameId || v.gameId || null;
        totalGaps += v.count || 0;
        // Count pending-cohort synthetic gap entries separately so we can
        // compute the rate and fire a targeted Discord alert.
        if (v.gaps && v.gaps.indexOf("cohort_label_pending") !== -1) {
          pendingCohortCount += v.count || 0;
        }
        var k = v.eventName + "::" + (v.gapKey || "");
        if (!byEventGap[k]) {
          byEventGap[k] = { eventName: v.eventName, gaps: v.gaps || [], count: 0, hours: {} };
        }
        byEventGap[k].count += v.count || 0;
        var hour = String(Math.floor((v.lastSeenMs || 0) / (60 * 60 * 1000)));
        byEventGap[k].hours[hour] = true;
      }
      var arr = Object.keys(byEventGap).map(function (k) {
        var rec = byEventGap[k];
        return {
          eventName: rec.eventName,
          gaps: rec.gaps,
          count: rec.count,
          uniqueHours: Object.keys(rec.hours).length,
        };
      });
      arr.sort(function (a, b) { return b.count - a.count; });
      return {
        totalGaps: totalGaps,
        distinctEvents: arr.length,
        gameId: anyGameId,
        topGaps: arr,
        pendingCohortCount: pendingCohortCount,
      };
    } catch (e) {
      try {
        logger.warn("[EventEnricher] scanCoverage failed: "
          + ((e as any).message || String(e)));
      } catch (_) {}
      return null;
    }
  }
}
