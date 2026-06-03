// analytics_backfill.js — historical-data backfill into BOTH dashboards.
//
// Why this exists:
//   The user just provisioned Heroic Labs Satori AND has months of historical
//   data sitting in Nakama Storage. They want both dashboards (the in-house
//   one at /analytics.html and the Satori cloud one) to show that history,
//   not just events from now-on. This module replays history into both.
//
// Why NOT a Go cron job:
//   1. Goja is single-threaded but the JS runtime already exposes everything
//      we need (storageList, storageRead, storageWrite, getSatori).
//   2. CodeBuild + EKS roll-out times mean a JS RPC is faster to ship.
//   3. The caller (an operator running curl) controls pacing — no risk of
//      the cron running twice on a redeploy.
//
// Source documents:
//   game_player_analytics  → per-user identity + last-500-events buffer
//                            (see player_analytics_store.js for schema)
//   analytics_dau          → daily active users by gameId+date (Satori-only
//                            synthetic events; we never had per-event history
//                            in dash_* form, so dau-synthetic is the best we
//                            can do for the chart-level reconstruction)
//
// Targets:
//   in-house dashboard:   write `dash_<gameId>_<YYYY-MM-DD>_<eventName>_<ts>_<rand>`
//                         keys to `analytics_events` collection (SYSTEM_USER).
//                         analytics_rollup.js scans these to build the
//                         daily aggregates the dashboard reads.
//   Satori cloud:         nk.getSatori().eventsPublish() / identityUpdate().
//
// Auth:
//   Same as analytics_admin — DASHBOARD_SECRET shared secret OR admin session.
//   Forwards through aaRequireAdmin defined in analytics_admin.js (Goja
//   concatenates all .js in runtime path into one virtual file before exec,
//   so cross-module function refs are fine).
//
// Pacing:
//   Caller passes `cursor` (returned in previous response) + `limit`. We
//   process up to `limit` GPA docs per call, then return next_cursor=null
//   when done. The operator runs a small bash loop on top of curl; see
//   docs/SATORI_INTEGRATION.md for the runbook. Recommended limit=100, which
//   processes 100 users × ~500 events = ~50k events per call.

var AB_GPA_COLLECTION = "game_player_analytics";
var AB_DAU_COLLECTION = "analytics_dau";
var AB_DASH_COLLECTION = "analytics_events";
var AB_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AB_DEFAULT_LIMIT = 100;
var AB_MAX_LIMIT = 500;

// 2026-05 — abModeEventsExisting batch size. Each Satori publish takes one
// HTTP call; we batch up to this many events per call to amortize TLS+auth
// cost and keep Satori's per-request limits comfortable.
var AB_EXISTING_PAGE_SIZE  = 200;
var AB_EXISTING_BATCH_SIZE = 50;

function abParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}
function abOk(data) {
    var out = { success: true };
    if (data) { for (var k in data) { if (data.hasOwnProperty(k)) out[k] = data[k]; } }
    return JSON.stringify(out);
}
function abErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

/**
 * Whether the satori_direct module's hardcoded Satori client is reachable.
 * It's auto-loaded into the JS scope by postbuild concatenation, so we just
 * check that the function exists. (Always true once the bundle is built;
 * the wrapper is here so a future split into a separate Goja VM still works.)
 */
function abGetSatoriOrNull(nk, logger) {
    return (typeof sdEventsPublish === "function") ? "satori_direct" : null;
}

/**
 * Convert a game_player_analytics event tuple {n,t,d} back into the
 * normalized event shape that persistNormalizedEvent / dash readers expect.
 *   n: event name        (string)
 *   t: unix ms timestamp (number — gpa stores ms; analytics_events stores sec)
 *   d: event data object (any)
 */
function abExpandGpaEvent(doc, ev) {
    // Fix #3: GPA stores t as unix SECONDS (not ms), so no division needed.
    // Previously dividing by 1000 produced 1970-era timestamps, making all
    // backfilled dash_* keys land outside the rollup scanner's date window.
    var unixSec = ev.t || 0;
    return {
        eventName: String(ev.n || "unknown"),
        eventData: ev.d || {},
        userId: doc.user_id,
        gameId: doc.game_id,
        platform: doc.platform || "unknown",
        unixTimestamp: unixSec,
        sessionId: ""
    };
}

function abMakeDashKey(ev) {
    var dateStr = new Date(ev.unixTimestamp * 1000).toISOString().slice(0, 10);
    var rand = Math.random().toString(36).slice(2, 8);
    return "dash_" + ev.gameId + "_" + dateStr + "_" + ev.eventName + "_" +
           ev.unixTimestamp + "_" + rand;
}

/**
 * Page over a storage collection. Returns { values, cursor }. We use raw
 * storageList rather than dashboard_storage_list because we need SYSTEM_USER
 * access and don't need to normalize for the UI.
 */
function abListPage(nk, collection, userId, limit, cursor) {
    var out = nk.storageList(userId || AB_SYSTEM_USER, collection, limit, cursor || "");
    return {
        values: (out && out.objects) || [],
        cursor: (out && out.cursor) || null
    };
}

/**
 * Mode A: identity backfill.
 *
 * Scan game_player_analytics docs (one per user/game) and push the rich
 * identity profile to Satori as identity properties. Satori's UI then knows
 * how to slice DAU by platform/country/locale/device_tier without us having
 * to explode every event with redundant identity fields.
 *
 * In-house dashboard: nothing to do — game_player_analytics IS the in-house
 * profile store, the dashboard reads it directly via dashboard_storage_list.
 */
function abModeIdentity(ctx, logger, nk, opts) {
    var satori = (opts.to_satori === false) ? null : abGetSatoriOrNull(nk, logger);
    var limit = Math.min(opts.limit || AB_DEFAULT_LIMIT, AB_MAX_LIMIT);

    // GPA docs are mirrored under the system user by gpaWriteSystemMirror,
    // so a system-user scan returns exactly one doc per player.
    var page = abListPage(nk, AB_GPA_COLLECTION, AB_SYSTEM_USER, limit, opts.cursor);
    var processed = 0, skipped = 0, satoriCalls = 0;
    var errors = [];

    for (var i = 0; i < page.values.length; i++) {
        var rec = page.values[i];
        var doc = rec.value || {};
        if (!doc.user_id) { skipped++; continue; }

        if (opts.dry_run) { processed++; continue; }

        if (satori) {
            try {
                // satori_direct.js::sdPropertiesUpdate — see header for the
                // hardcoded-creds rationale.
                var customProps = {
                    platform: doc.platform || "unknown",
                    country: doc.country || "??",
                    locale: doc.locale || "en",
                    device_tier: doc.device_tier || "unknown",
                    device_model: doc.device_model || "",
                    os_version: doc.os_version || "",
                    app_version: doc.app_version || "",
                    install_source: doc.install_source || "",
                    consent: doc.consent || "unknown",
                    first_seen_utc: String(doc.first_seen_utc || 0),
                    lt_events: String(doc.lt_events || 0),
                    lt_sessions: String(doc.lt_sessions || 0),
                    lt_quiz_plays: String(doc.lt_quiz_plays || 0),
                    fav_mode: doc.fav_mode || "",
                    spend_usd: String((doc.money && doc.money.spend_usd) || 0),
                    ad_views: String((doc.money && doc.money.ad_views) || 0),
                    reward_tier: (doc.money && doc.money.reward_tier) || "bronze"
                };
                var pr = sdPropertiesUpdate(ctx, nk, logger, doc.user_id, { custom: customProps });
                if (pr && pr.ok === false) {
                    errors.push({ user_id: doc.user_id, code: pr.code, err: (pr.body || "").slice(0, 200) });
                } else {
                    satoriCalls++;
                }
            } catch (e) {
                errors.push({ user_id: doc.user_id, err: String(e.message || e) });
            }
        }
        processed++;
    }

    return {
        mode: "identity",
        processed: processed,
        skipped: skipped,
        satori_calls: satoriCalls,
        errors: errors.slice(0, 20),
        next_cursor: page.cursor || null,
        done: !page.cursor
    };
}

/**
 * Mode B: events_replay.
 *
 * For each game_player_analytics doc, walk doc.events[] (capped at 500 per
 * user — that's how the rolling buffer works in player_analytics_store.js).
 * For each event:
 *   1. If to_dashboard: write a dash_* key to analytics_events.
 *   2. If to_satori: call satori.eventsPublish().
 *
 * NB: This is only LAST-500 events per user — anything older isn't in the
 * GPA buffer (it was overwritten as new events came in) and is genuinely
 * lost. That's a known limitation of the existing storage design, not a
 * backfill bug.
 */
function abModeEventsReplay(ctx, logger, nk, opts) {
    var satori = (opts.to_satori === false) ? null : abGetSatoriOrNull(nk, logger);
    var writeDash = (opts.to_dashboard !== false);
    var limit = Math.min(opts.limit || AB_DEFAULT_LIMIT, AB_MAX_LIMIT);

    // GPA docs are mirrored under the system user by gpaWriteSystemMirror,
    // so a system-user scan returns exactly one doc per player.
    var page = abListPage(nk, AB_GPA_COLLECTION, AB_SYSTEM_USER, limit, opts.cursor);
    var docsProcessed = 0, eventsPushed = 0, dashWrites = 0, satoriCalls = 0;
    var errors = [];

    for (var i = 0; i < page.values.length; i++) {
        var rec = page.values[i];
        var doc = rec.value || {};
        if (!doc.user_id || !Array.isArray(doc.events)) { docsProcessed++; continue; }

        // Build dash_* writes in one batch per user (cheaper than per-event).
        var dashBatch = [];
        // Build Satori events array per user (Satori accepts a list).
        var satoriBatch = [];

        for (var j = 0; j < doc.events.length; j++) {
            var raw = doc.events[j];
            if (!raw || !raw.n || !raw.t) continue;
            var ev = abExpandGpaEvent(doc, raw);

            if (writeDash) {
                dashBatch.push({
                    collection: AB_DASH_COLLECTION,
                    key: abMakeDashKey(ev),
                    userId: AB_SYSTEM_USER,
                    value: ev,
                    permissionRead: 0,
                    permissionWrite: 0
                });
            }
            if (satori) {
                var meta = { game_id: ev.gameId, platform: ev.platform };
                if (ev.eventData && typeof ev.eventData === "object") {
                    for (var k in ev.eventData) {
                        if (Object.prototype.hasOwnProperty.call(ev.eventData, k)) {
                            var v = ev.eventData[k];
                            if (v === null || v === undefined) continue;
                            meta[k] = (typeof v === "object") ? JSON.stringify(v) : String(v);
                        }
                    }
                }
                satoriBatch.push({
                    name: ev.eventName,
                    // Unix seconds as int64. See analytics.js for the same fix
                    // and the goja-side validation at runtime_javascript_nakama.go:9209.
                    timestamp: ev.unixTimestamp,
                    metadata: meta
                });
            }
            eventsPushed++;
        }

        if (opts.dry_run) {
            docsProcessed++;
            continue;
        }

        if (dashBatch.length > 0) {
            // storageWrite has a hard limit of 64 ops per call (Nakama default).
            // Chunk the batch defensively.
            try {
                var chunkSize = 50;
                for (var s = 0; s < dashBatch.length; s += chunkSize) {
                    nk.storageWrite(dashBatch.slice(s, s + chunkSize));
                }
                dashWrites += dashBatch.length;
            } catch (e) {
                errors.push({ user_id: doc.user_id, kind: "dash_write", err: String(e.message || e) });
            }
        }

        if (satoriBatch.length > 0 && satori) {
            try {
                // sdEventsPublish accepts a list — one HTTP call per user is
                // much cheaper than one per event. Returns null on success,
                // or a {ok:false, code, body} object on HTTP error.
                var er = sdEventsPublish(ctx, nk, logger, doc.user_id, satoriBatch);
                if (er && er.ok === false) {
                    errors.push({ user_id: doc.user_id, kind: "satori_publish", code: er.code, err: (er.body || "").slice(0, 200) });
                } else {
                    satoriCalls++;
                }
            } catch (e) {
                errors.push({ user_id: doc.user_id, kind: "satori_publish", err: String(e.message || e) });
            }
        }

        docsProcessed++;
    }

    return {
        mode: "events_replay",
        docs_processed: docsProcessed,
        events_pushed: eventsPushed,
        dash_writes: dashWrites,
        satori_calls: satoriCalls,
        errors: errors.slice(0, 20),
        next_cursor: page.cursor || null,
        done: !page.cursor
    };
}

/**
 * Mode B-bis: events_existing.
 *
 * 2026-05 — In production, `game_player_analytics` is empty (Unity writes
 * directly into `analytics_events` via persistNormalizedEvent, never via
 * the GPA buffer). That means abModeEventsReplay short-circuits with
 * docs_processed=0 and Satori never sees historical events.
 *
 * This mode walks `analytics_events` directly, batches by user, and pushes
 * to Satori. Idempotent — events already published this session are tracked
 * in `analytics_backfill_existing` storage so re-runs don't double-publish.
 *
 *   opts.cursor    storage cursor for pagination
 *   opts.limit     events to read per call (default 200, max 500)
 *   opts.to_satori default true; false to dry-run
 *   opts.dry_run   no-op flag
 */
function abModeEventsExisting(ctx, logger, nk, opts) {
    var satori = (opts.to_satori === false) ? null : abGetSatoriOrNull(nk, logger);
    var limit  = Math.min(opts.limit || AB_EXISTING_PAGE_SIZE, AB_MAX_LIMIT);
    var page   = abListPage(nk, AB_DASH_COLLECTION, AB_SYSTEM_USER, limit, opts.cursor);

    var eventsScanned = 0, eventsPushed = 0, satoriCalls = 0, eventsSkippedDup = 0;
    var errors = [];

    // ── Idempotency state ──
    // Tracks the dash_* storage keys that were already published to Satori
    // by previous backfill runs. Without this, kicking the auto-state-machine
    // twice (e.g. on a redeploy) would double-publish the entire history.
    // State doc shape: { keys: ["dash_…", …], updated_utc, total_processed }
    // Capped at AB_EXISTING_DEDUPE_MAX entries to bound storage size; once
    // we exceed the cap we drop the oldest. The dedupe set is a one-page
    // window — fine because storageList returns pages in stable cursor
    // order, so cursor advancement plus the in-page dedupe set is enough
    // to prevent same-page resubmission.
    var dedupeMax = AB_EXISTING_DEDUPE_MAX;
    var seenSet   = abLoadExistingDedupe(nk, logger);
    var seenAddedThisRun = [];

    // Bucket by userId so we can publish one Satori HTTP request per user.
    var byUser = {};
    var pushedKeys = {}; // key → array of {uid, name, ts} so we can mark on success
    for (var i = 0; i < page.values.length; i++) {
        var rec = page.values[i];
        var ev  = rec.value || {};
        eventsScanned++;
        var uid = ev.userId || ev.user_id;
        var name = ev.eventName || ev.name;
        var ts   = ev.unixTimestamp || ev.unix_timestamp;
        var dashKey = rec.key;
        if (!uid || !name || !ts) continue;
        // Skip the synthetic admin smoke-test fan-outs and dau_check events
        // already produced by the dau_synthetic phase; those are housekeeping
        // and don't represent real user activity.
        if (name === "admin_smoke_test" || name === "dau_check") continue;
        if (dashKey && seenSet[dashKey]) { eventsSkippedDup++; continue; }
        if (!byUser[uid]) byUser[uid] = [];
        byUser[uid].push({
            name: String(name),
            timestamp: ts,
            metadata: {
                game_id: ev.gameId || ev.game_id || "",
                platform: ev.platform || "",
                source: "events_existing_backfill"
            }
        });
        if (dashKey) {
            (pushedKeys[uid] = pushedKeys[uid] || []).push(dashKey);
            seenAddedThisRun.push(dashKey);
            if (seenAddedThisRun.length > dedupeMax) seenAddedThisRun.shift();
        }
    }

    if (opts.dry_run) {
        return {
            mode: "events_existing",
            events_scanned: eventsScanned,
            events_pushed: 0,
            satori_calls: 0,
            users: Object.keys(byUser).length,
            next_cursor: page.cursor || null,
            done: !page.cursor,
            dry_run: true
        };
    }

    var publishedAnything = false;
    if (satori) {
        for (var uid2 in byUser) {
            if (!Object.prototype.hasOwnProperty.call(byUser, uid2)) continue;
            var bucket = byUser[uid2];
            // Chunk per-user to bound payload sizes
            for (var s = 0; s < bucket.length; s += AB_EXISTING_BATCH_SIZE) {
                var slice = bucket.slice(s, s + AB_EXISTING_BATCH_SIZE);
                try {
                    var er = sdEventsPublish(ctx, nk, logger, uid2, slice);
                    if (er && er.ok === false) {
                        errors.push({ user_id: uid2, kind: "satori_publish", code: er.code, err: (er.body || "").slice(0, 200) });
                    } else {
                        satoriCalls++;
                        eventsPushed += slice.length;
                        publishedAnything = true;
                    }
                } catch (e) {
                    errors.push({ user_id: uid2, kind: "satori_publish", err: String(e.message || e) });
                }
            }
        }
    }

    // Persist the dedupe set so the next call (or next deploy) can skip
    // already-published keys. Only commit on at least one successful push
    // to avoid blocking retries when Satori is rejecting events outright.
    if (publishedAnything && seenAddedThisRun.length > 0) {
        abSaveExistingDedupe(nk, logger, seenSet, seenAddedThisRun, dedupeMax, eventsScanned);
    }

    return {
        mode: "events_existing",
        events_scanned: eventsScanned,
        events_pushed: eventsPushed,
        events_skipped_dup: eventsSkippedDup,
        satori_calls: satoriCalls,
        users: Object.keys(byUser).length,
        errors: errors.slice(0, 20),
        next_cursor: page.cursor || null,
        done: !page.cursor
    };
}

// ── Dedupe state helpers (used by abModeEventsExisting) ──
//
// Storage shape: collection `analytics_backfill_existing`, key `state`,
// SYSTEM_USER. We store the seen-set as a flat string array (not a hash)
// so a fresh export/import preserves it. Keys we care about are bounded
// to ~26 chars (`dash_<userId>_<ts>_<rand>`); 5000 of those is ~130KB
// well under Nakama's 1MB storage value cap.
var AB_EXISTING_DEDUPE_COLL = "analytics_backfill_existing";
var AB_EXISTING_DEDUPE_KEY  = "state";
var AB_EXISTING_DEDUPE_MAX  = 5000;

function abLoadExistingDedupe(nk, logger) {
    var seen = {};
    try {
        var recs = nk.storageRead([{
            collection: AB_EXISTING_DEDUPE_COLL,
            key: AB_EXISTING_DEDUPE_KEY,
            userId: AB_SYSTEM_USER
        }]);
        if (recs && recs.length > 0 && recs[0].value && recs[0].value.keys) {
            var arr = recs[0].value.keys;
            for (var i = 0; i < arr.length; i++) seen[arr[i]] = true;
        }
    } catch (e) {
        if (logger && logger.warn) logger.warn("[abExistingDedupe] load failed: " + e);
    }
    return seen;
}

function abSaveExistingDedupe(nk, logger, seenSet, addedThisRun, capacity, scanned) {
    try {
        // Merge added into existing, then trim oldest. We don't track
        // insertion time per key — rely on insertion order in the array.
        var merged = [];
        for (var k in seenSet) if (Object.prototype.hasOwnProperty.call(seenSet, k)) merged.push(k);
        for (var j = 0; j < addedThisRun.length; j++) {
            if (!seenSet[addedThisRun[j]]) merged.push(addedThisRun[j]);
        }
        // Drop oldest entries to fit within capacity
        if (merged.length > capacity) merged = merged.slice(merged.length - capacity);
        nk.storageWrite([{
            collection: AB_EXISTING_DEDUPE_COLL,
            key: AB_EXISTING_DEDUPE_KEY,
            userId: AB_SYSTEM_USER,
            value: {
                keys: merged,
                updated_utc: Math.floor(Date.now() / 1000),
                last_scanned: scanned || 0,
                last_added: addedThisRun.length
            },
            permissionRead: 1,
            permissionWrite: 1
        }]);
    } catch (e) {
        if (logger && logger.warn) logger.warn("[abExistingDedupe] save failed: " + e);
    }
}

/**
 * Mode C: dau_synthetic.
 *
 * The legacy analytics_dau collection has aggregate counters by
 * gameId+YYYY-MM-DD (DAU, new users, total events). For the Satori dashboard
 * to show a historical DAU chart, we synthesize one `dau_check` event per
 * user-day using these counters. This is best-effort — Satori will see
 * the right SHAPE of the chart (peaks/valleys/trend) even if individual
 * user attribution is approximated.
 *
 * In-house dashboard: rollups already read analytics_dau directly, so no
 * dash_* fan-out needed here.
 */
function abModeDauSynthetic(ctx, logger, nk, opts) {
    var satori = (opts.to_satori === false) ? null : abGetSatoriOrNull(nk, logger);
    if (!satori) {
        return { mode: "dau_synthetic", skipped: true, reason: "Satori unavailable; in-house dashboard already reads analytics_dau directly." };
    }
    var limit = Math.min(opts.limit || AB_DEFAULT_LIMIT, AB_MAX_LIMIT);

    var page = abListPage(nk, AB_DAU_COLLECTION, AB_SYSTEM_USER, limit, opts.cursor);
    var daysProcessed = 0, satoriCalls = 0;
    var errors = [];

    for (var i = 0; i < page.values.length; i++) {
        var rec = page.values[i];
        var doc = rec.value || {};
        var key = rec.key || "";
        // Key format: "dau_<gameId>_<YYYY-MM-DD>"
        // (matches analytics.js line 745-753 which scans the same collection).
        // Skip secondary keys like "dau_platform_<platform>_<date>".
        if (key.indexOf("dau_") !== 0 || key.indexOf("dau_platform_") === 0) continue;
        var rest = key.slice(4); // strip "dau_"
        var underscoreIdx = rest.lastIndexOf("_");
        if (underscoreIdx < 0) continue;
        var gameId = rest.slice(0, underscoreIdx);
        var dateStr = rest.slice(underscoreIdx + 1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        // Unix seconds at noon UTC of that date. Satori expects int64 seconds
        // (see runtime_javascript_nakama.go:9209), not a Date object.
        var tsSec = Math.floor(new Date(dateStr + "T12:00:00Z").getTime() / 1000);

        if (opts.dry_run) { daysProcessed++; continue; }

        // Synthetic dau_check event — one per user we have on record. We use
        // the SYSTEM_USER as identity because we don't know which specific
        // users were active that day (analytics_dau is just a count). Satori
        // will count this as 1 unique user per day for the historical bucket.
        // If finer granularity is needed, run mode=events_replay (which has
        // real per-user attribution from the events buffer).
        try {
            var dr = sdEventsPublish(ctx, nk, logger, AB_SYSTEM_USER, [{
                name: "dau_synthetic",
                timestamp: tsSec,
                metadata: {
                    game_id: gameId,
                    date: dateStr,
                    // Field names follow analytics.js line 755 — analytics_dau
                    // docs use {count, uniqueUsers, newUsers, totalEvents}
                    // depending on writer version, so we read with fallbacks.
                    dau_count: String(doc.count || doc.uniqueUsers || doc.dau || 0),
                    new_users: String(doc.newUsers || 0),
                    total_events: String(doc.totalEvents || 0),
                    backfill: "true"
                }
            }]);
            if (dr && dr.ok === false) {
                errors.push({ key: key, code: dr.code, err: (dr.body || "").slice(0, 200) });
            } else {
                satoriCalls++;
            }
        } catch (e) {
            errors.push({ key: key, err: String(e.message || e) });
        }
        daysProcessed++;
    }

    return {
        mode: "dau_synthetic",
        days_processed: daysProcessed,
        satori_calls: satoriCalls,
        errors: errors.slice(0, 20),
        next_cursor: page.cursor || null,
        done: !page.cursor
    };
}

/**
 * RPC: analytics_backfill_dual
 *
 * Payload:
 *   {
 *     "dashboard_secret": "<DASHBOARD_SECRET>",
 *     "mode": "identity" | "events_replay" | "dau_synthetic",
 *     "cursor": "<from previous response, or omit on first call>",
 *     "limit": 100,
 *     "to_satori": true,
 *     "to_dashboard": true,
 *     "dry_run": false
 *   }
 *
 * Response:
 *   { success: true, mode, processed, satori_calls, next_cursor, done, ... }
 *
 * Run from a curl loop until `done: true`. See docs/SATORI_INTEGRATION.md.
 */
function rpcAnalyticsBackfillDual(ctx, logger, nk, payload) {
    var data = abParse(payload);

    // Auth — reuse analytics_admin's gate. Concatenated runtime means we can
    // call this directly without a require().
    var auth;
    try {
        auth = aaRequireAdmin(ctx, nk, logger, data);
    } catch (e) {
        return abErr("admin auth helper not loaded — is analytics_admin module in runtime path?", 500);
    }
    if (!auth.ok) return abErr(auth.reason || "unauthorized", 401);

    var mode = String(data.mode || "events_replay");
    var opts = {
        cursor: data.cursor || "",
        limit: parseInt(data.limit, 10) || AB_DEFAULT_LIMIT,
        to_satori: (data.to_satori !== false),
        to_dashboard: (data.to_dashboard !== false),
        dry_run: !!data.dry_run
    };

    var t0 = Date.now();
    var result;
    try {
        if (mode === "identity") {
            result = abModeIdentity(ctx, logger, nk, opts);
        } else if (mode === "events_replay") {
            result = abModeEventsReplay(ctx, logger, nk, opts);
        } else if (mode === "events_existing") {
            result = abModeEventsExisting(ctx, logger, nk, opts);
        } else if (mode === "dau_synthetic") {
            result = abModeDauSynthetic(ctx, logger, nk, opts);
        } else {
            return abErr("Unknown mode '" + mode + "'. Use one of: identity, events_replay, events_existing, dau_synthetic", 400);
        }
    } catch (e) {
        if (logger && logger.error) {
            logger.error("[analytics_backfill] mode=" + mode + " failed: " + (e.message || e));
        }
        return abErr("backfill failed: " + (e.message || e), 500);
    }

    result.elapsed_ms = Date.now() - t0;
    result.bypass = auth.bypass || "session";
    return abOk(result);
}

// ───────────────────────────────────────────────────────────────────────
//                  AUTO-DRAIN STATE MACHINE  (2026-05-10)
// ───────────────────────────────────────────────────────────────────────
//
// Goal: after `git push`, both dashboards backfill themselves with no
// human intervention — no curl loops, no DevOps cron, no manual triggers.
//
// Mechanism:
//   1. State doc lives at storage[AB_AUTO_COLLECTION/AB_AUTO_KEY] (system
//      user). Tracks {phase, cursor, stats, lastTickAt, …}.
//   2. abAutoRunIfNeeded(ctx, nk, logger) is debounced (5 sec): one tick
//      processes ONE page of the current phase (≈50 docs, ≈500 ms-1s).
//   3. Multiple high-traffic RPCs piggyback on it:
//        analytics_log_event   — fires on every Unity event ingest
//        admin_login           — fires when an admin opens the dashboard
//        analytics_auto_kick   — manual / external kicker
//      The first piggyback after deploy initializes state and starts work;
//      subsequent calls drain until phase=="done".
//   4. Phase order:
//        init           — initialize state, derive rollup date range
//        identity       — push GPA profiles to Satori (ctx.env identities)
//        events_replay  — write dash_* keys + push events to Satori
//        dau_synthetic  — historical DAU shape into Satori
//        rollup         — call rpcAnalyticsRollupBackfill chunk-by-chunk
//                         to populate analytics_rollup_* (in-house charts)
//        done           — no-op forever (until manual reset)
//
// Idempotency:
//   • State doc uses Nakama's optimistic-concurrency `version` field.
//     Two concurrent piggybacks read the same state, both compute, only
//     one wins the write (the loser silently skips). No double-processing.
//   • If a tick crashes mid-page, the cursor isn't advanced; the next
//     tick retries from the same point.
//
// Cost ceiling per tick:
//   ≤ 1 page of work + 1 storage write. 5-sec debounce means at most
//   12 ticks/min, ≈600 docs/min. A 50K-doc backfill drains in ~80 min.

var AB_AUTO_COLLECTION = "analytics_backfill_auto";
var AB_AUTO_KEY        = "state";
var AB_AUTO_DEBOUNCE_SEC = 5;
var AB_AUTO_PAGE_SIZE = 50;
var AB_AUTO_ROLLUP_CHUNK_DAYS = 30;        // rpcAnalyticsRollupBackfill caps at 90; 30 keeps each tick under ~5s
var AB_AUTO_MAX_LOOKBACK_DAYS = 180;       // rollup phase only goes back this far
var AB_AUTO_STATE_VERSION = 1;

// Phases in order. nextPhase[X] = the phase to advance to when X completes.
// 2026-05 — added events_existing between events_replay and dau_synthetic.
// In production GPA is empty so events_replay completes immediately with 0
// docs; events_existing then pushes the events that already live in
// analytics_events to Satori so the Satori dashboard shows historical data.
var AB_AUTO_PHASES = ["init", "identity", "events_replay", "events_existing", "dau_synthetic", "rollup", "done"];

function abAutoRead(nk) {
    try {
        var objs = nk.storageRead([{
            collection: AB_AUTO_COLLECTION, key: AB_AUTO_KEY, userId: AB_SYSTEM_USER
        }]);
        if (objs && objs.length > 0) {
            return { value: objs[0].value || null, version: objs[0].version || null };
        }
    } catch (e) { /* treat as not-exists */ }
    return { value: null, version: null };
}

function abAutoWrite(nk, state, version) {
    var rec = {
        collection: AB_AUTO_COLLECTION,
        key: AB_AUTO_KEY,
        userId: AB_SYSTEM_USER,
        value: state,
        permissionRead: 1,
        permissionWrite: 0
    };
    if (version) rec.version = version;
    else         rec.version = "*"; // create-only on first write to avoid clobber
    try {
        nk.storageWrite([rec]);
        return true;
    } catch (e) {
        // OCC failure = another piggyback won the race. That's fine — they'll
        // own the next tick. Drop our write silently.
        return false;
    }
}

function abAutoInitState() {
    return {
        v: AB_AUTO_STATE_VERSION,
        phase: "init",
        cursor: "",
        rollup_from: "",
        rollup_cursor: "",
        rollup_to: "",
        started_at: Math.floor(Date.now() / 1000),
        last_tick_at: 0,
        ticks: 0,
        errors: [],
        stats: {
            identity:        { users: 0, satori_calls: 0 },
            events_replay:   { users: 0, events_pushed: 0, dash_writes: 0, satori_calls: 0 },
            events_existing: { users: 0, events_pushed: 0, satori_calls: 0, scanned: 0 },
            dau_synthetic:   { days: 0, satori_calls: 0 },
            rollup:          { dates_done: 0, dates_failed: 0 }
        }
    };
}

/** Advance to the next phase. Resets cursor for the new phase. */
function abAutoAdvance(state, logger) {
    var idx = AB_AUTO_PHASES.indexOf(state.phase);
    if (idx < 0 || idx >= AB_AUTO_PHASES.length - 1) {
        state.phase = "done";
    } else {
        state.phase = AB_AUTO_PHASES[idx + 1];
    }
    state.cursor = "";
    if (logger && logger.info) {
        logger.info("[ab-auto] phase advanced → " + state.phase);
    }
    return state;
}

/** Find the oldest analytics_dau date so the rollup phase knows how far back to go. */
function abAutoDeriveRollupRange(nk, logger) {
    var oldest = null;
    var cursor = null;
    var pages = 0;
    while (pages < 20) { // hard cap — 20 × 100 = 2000 keys is plenty to find min date
        var page;
        try {
            page = nk.storageList(AB_SYSTEM_USER, AB_DAU_COLLECTION, 100, cursor);
        } catch (e) { break; }
        if (!page || !page.objects || page.objects.length === 0) break;
        for (var i = 0; i < page.objects.length; i++) {
            var k = page.objects[i].key || "";
            // Keys: dau_<gameId>_<YYYY-MM-DD>
            var m = k.match(/_(\d{4}-\d{2}-\d{2})$/);
            if (m && m[1]) {
                if (!oldest || m[1] < oldest) oldest = m[1];
            }
        }
        if (!page.cursor) break;
        cursor = page.cursor;
        pages++;
    }

    var today = new Date();
    var to = today.toISOString().slice(0, 10);
    var from;
    if (oldest) {
        // Cap to AB_AUTO_MAX_LOOKBACK_DAYS regardless of how old the data is.
        var lb = new Date(today.getTime() - AB_AUTO_MAX_LOOKBACK_DAYS * 86400000)
                    .toISOString().slice(0, 10);
        from = (oldest < lb) ? lb : oldest;
    } else {
        // No DAU data — backfill the last 30 days as a default starting point.
        from = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    }
    if (logger && logger.info) {
        logger.info("[ab-auto] rollup range derived: " + from + " → " + to + " (oldest_dau=" + (oldest || "none") + ")");
    }
    return { from: from, to: to };
}

/** Add 1 day to a YYYY-MM-DD string. */
function abAutoIsoAddDays(dateStr, n) {
    var d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * Run one tick of the state machine. Returns a small summary.
 *
 * Safe to call from anywhere (any RPC, any user context). Debounced,
 * idempotent, and never throws. Always wrap callers in try/catch anyway —
 * runtime quirks (storage backend hiccups) shouldn't block the parent RPC.
 *
 * forceTick=true bypasses the 5-sec debounce (used by the manual kicker
 * RPC; not used by the piggyback hooks).
 */
function abAutoRunTick(ctx, nk, logger, forceTick) {
    var read = abAutoRead(nk);
    var state = read.value;
    var version = read.version;

    var now = Math.floor(Date.now() / 1000);

    // Initial bootstrap — no state doc yet.
    if (!state || !state.phase) {
        state = abAutoInitState();
        version = null; // create
    }

    if (state.phase === "done") {
        return { skipped: "done", state_phase: "done", ticks: state.ticks || 0 };
    }

    // Debounce so a burst of analytics_log_event calls doesn't pummel
    // storage / Satori with concurrent ticks.
    if (!forceTick && state.last_tick_at && (now - state.last_tick_at) < AB_AUTO_DEBOUNCE_SEC) {
        return { skipped: "debounced", state_phase: state.phase, since_last_tick_sec: (now - state.last_tick_at) };
    }

    state.last_tick_at = now;
    state.ticks = (state.ticks || 0) + 1;

    var summary = { state_phase: state.phase, processed: 0 };

    try {
        if (state.phase === "init") {
            // Derive the rollup date range once and immediately advance.
            var range = abAutoDeriveRollupRange(nk, logger);
            state.rollup_from = range.from;
            state.rollup_cursor = range.from;
            state.rollup_to = range.to;
            abAutoAdvance(state, logger);

        } else if (state.phase === "identity") {
            var r1 = abModeIdentity(ctx, logger, nk, {
                cursor: state.cursor || "", limit: AB_AUTO_PAGE_SIZE,
                to_satori: true, dry_run: false
            });
            state.cursor = r1.next_cursor || "";
            state.stats.identity.users         += (r1.processed_users || r1.processed || 0);
            state.stats.identity.satori_calls  += (r1.satori_calls || 0);
            summary.processed = r1.processed_users || r1.processed || 0;
            if (r1.done || !r1.next_cursor) abAutoAdvance(state, logger);

        } else if (state.phase === "events_replay") {
            var r2 = abModeEventsReplay(ctx, logger, nk, {
                cursor: state.cursor || "", limit: AB_AUTO_PAGE_SIZE,
                to_satori: true, to_dashboard: true, dry_run: false
            });
            state.cursor = r2.next_cursor || "";
            state.stats.events_replay.users         += (r2.docs_processed || 0);
            state.stats.events_replay.events_pushed += (r2.events_pushed || 0);
            state.stats.events_replay.dash_writes   += (r2.dash_writes || 0);
            state.stats.events_replay.satori_calls  += (r2.satori_calls || 0);
            summary.processed = r2.docs_processed || 0;
            if (r2.done || !r2.next_cursor) abAutoAdvance(state, logger);

        } else if (state.phase === "events_existing") {
            // Idempotently push existing analytics_events rows to Satori.
            // 2026-05 — fills the gap when game_player_analytics is empty
            // (which is the case in production).
            // Defensive: ensure stats slot exists for state docs created
            // before this phase was added.
            if (!state.stats.events_existing) {
                state.stats.events_existing = { users: 0, events_pushed: 0, satori_calls: 0, scanned: 0 };
            }
            var r2x = abModeEventsExisting(ctx, logger, nk, {
                cursor: state.cursor || "",
                limit: AB_EXISTING_PAGE_SIZE,
                to_satori: true,
                dry_run: false
            });
            state.cursor = r2x.next_cursor || "";
            state.stats.events_existing.users         += (r2x.users || 0);
            state.stats.events_existing.events_pushed += (r2x.events_pushed || 0);
            state.stats.events_existing.satori_calls  += (r2x.satori_calls || 0);
            state.stats.events_existing.scanned       += (r2x.events_scanned || 0);
            summary.processed = r2x.events_pushed || 0;
            if (r2x.done || !r2x.next_cursor) abAutoAdvance(state, logger);

        } else if (state.phase === "dau_synthetic") {
            var r3 = abModeDauSynthetic(ctx, logger, nk, {
                cursor: state.cursor || "", limit: AB_AUTO_PAGE_SIZE,
                to_satori: true, dry_run: false
            });
            state.cursor = r3.next_cursor || "";
            state.stats.dau_synthetic.days         += (r3.days_processed || 0);
            state.stats.dau_synthetic.satori_calls += (r3.satori_calls || 0);
            summary.processed = r3.days_processed || 0;
            if (r3.done || !r3.next_cursor) abAutoAdvance(state, logger);

        } else if (state.phase === "rollup") {
            // Drive rpcAnalyticsRollupBackfill chunk-by-chunk along the date
            // range derived in `init`. Each chunk processes up to
            // AB_AUTO_ROLLUP_CHUNK_DAYS days (capped to <= range end).
            if (!state.rollup_cursor || !state.rollup_to || state.rollup_cursor > state.rollup_to) {
                abAutoAdvance(state, logger);
            } else {
                var chunkEnd = abAutoIsoAddDays(state.rollup_cursor, AB_AUTO_ROLLUP_CHUNK_DAYS - 1);
                if (chunkEnd > state.rollup_to) chunkEnd = state.rollup_to;

                var dashboardSecret = "";
                try {
                    if (typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
                        dashboardSecret = AA_FALLBACK_DASHBOARD_SECRET;
                    }
                    if (ctx && ctx.env && ctx.env.DASHBOARD_SECRET) {
                        dashboardSecret = String(ctx.env.DASHBOARD_SECRET);
                    }
                } catch (e) { /* fall back to "" — phase will fail-open and skip below */ }

                if (!dashboardSecret) {
                    state.errors = (state.errors || []).slice(-4);
                    state.errors.push({ phase: "rollup", err: "no DASHBOARD_SECRET available" });
                    abAutoAdvance(state, logger); // skip this phase rather than loop forever
                } else if (typeof rpcAnalyticsRollupBackfill !== "function") {
                    state.errors = (state.errors || []).slice(-4);
                    state.errors.push({ phase: "rollup", err: "rpcAnalyticsRollupBackfill not in scope" });
                    abAutoAdvance(state, logger);
                } else {
                    var rollupPayload = JSON.stringify({
                        from: state.rollup_cursor,
                        to: chunkEnd,
                        dashboard_secret: dashboardSecret
                    });
                    try {
                        var rawResp = rpcAnalyticsRollupBackfill(ctx, logger, nk, rollupPayload);
                        var parsed = {};
                        try { parsed = JSON.parse(rawResp); } catch (e2) { parsed = {}; }
                        if (parsed && parsed.success) {
                            var done = (parsed.results || []).filter(function (x) { return x.success; }).length;
                            var fail = (parsed.results || []).length - done;
                            state.stats.rollup.dates_done   += done;
                            state.stats.rollup.dates_failed += fail;
                            summary.processed = (parsed.results || []).length;
                        } else {
                            state.errors = (state.errors || []).slice(-4);
                            state.errors.push({ phase: "rollup", chunk: state.rollup_cursor + "→" + chunkEnd, err: parsed.error || "unknown" });
                        }
                    } catch (e) {
                        state.errors = (state.errors || []).slice(-4);
                        state.errors.push({ phase: "rollup", chunk: state.rollup_cursor + "→" + chunkEnd, err: String(e.message || e) });
                    }
                    state.rollup_cursor = abAutoIsoAddDays(chunkEnd, 1);
                    if (state.rollup_cursor > state.rollup_to) abAutoAdvance(state, logger);
                }
            }
        }
    } catch (eOuter) {
        state.errors = (state.errors || []).slice(-4);
        state.errors.push({ phase: state.phase, err: String(eOuter.message || eOuter) });
        if (logger && logger.warn) {
            logger.warn("[ab-auto] tick crashed in phase " + state.phase + ": " + (eOuter.message || eOuter));
        }
        // Don't advance — next tick retries from the same cursor.
    }

    // Persist state. OCC: if version mismatches, another piggyback already
    // moved the cursor — drop our write silently.
    abAutoWrite(nk, state, version);

    summary.state_phase = state.phase;
    summary.cursor = state.cursor || (state.rollup_cursor || "");
    summary.ticks = state.ticks;
    return summary;
}

/**
 * Public entry-point for the piggyback hooks. Same as abAutoRunTick but
 * fully wraps in try/catch so the caller never sees a throw, and short-
 * circuits without any storage I/O when phase is "done" (cached check).
 */
var abAutoDoneCacheUntil = 0;
function abAutoRunIfNeeded(ctx, nk, logger) {
    try {
        var now = Math.floor(Date.now() / 1000);
        // Fast path: if the last tick said "done", skip storage I/O for 5 min.
        // (Doesn't matter if a manual reset happens — next 5 min stays no-op.)
        if (abAutoDoneCacheUntil && now < abAutoDoneCacheUntil) return null;

        var summary = abAutoRunTick(ctx, nk, logger, false);
        if (summary && summary.state_phase === "done") {
            abAutoDoneCacheUntil = now + 300;
        }
        return summary;
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[ab-auto] piggyback error: " + (e.message || e));
        }
        return null;
    }
}

// ── RPC: analytics_auto_kick (no-auth — single tick is harmless) ──
//
// Anyone can poke this. Useful for: (a) initial bootstrap if no
// analytics_log_event traffic is flowing yet, (b) manual unblock if a
// tick keeps crashing on the same cursor (after a fix is deployed).
function rpcAnalyticsAutoKick(ctx, logger, nk, payload) {
    var data = abParse(payload);

    // SECURITY: this RPC drains up to 500 pages of GPA / events_existing /
    // dau_synthetic / rollup work per call. Cron drives it via the
    // dashboard_secret shared secret; admin sessions drive it from the
    // dashboard UI. Either is acceptable, nothing else is.
    var secret = (ctx && ctx.env && ctx.env["DASHBOARD_SECRET"]) || null;
    var bySecret = !!(secret && data && data.dashboard_secret === secret);
    var bySession = false;
    if (!bySecret) {
        try {
            if (typeof ahIsAdmin === "function") {
                bySession = ahIsAdmin(ctx, nk);
            } else if (typeof arIsAdminUser === "function" && ctx && ctx.userId) {
                bySession = arIsAdminUser(nk, logger, ctx.userId, ctx.username);
            }
        } catch (e) { /* fall through to deny */ }
    }
    if (!bySecret && !bySession) {
        return abErr("admin authentication required", 401);
    }

    var force = !!data.force;
    var summary = abAutoRunTick(ctx, nk, logger, force);
    return abOk(summary || { state_phase: "unknown" });
}

// ── RPC: analytics_auto_status (read-only) ──
//
// Returns the current state doc plus a derived progress percentage. Used
// by the dashboard footer or a watch script to monitor backfill progress.
function rpcAnalyticsAutoStatus(ctx, logger, nk, payload) {
    var read = abAutoRead(nk);
    if (!read.value) return abOk({ initialized: false });
    var s = read.value;
    var pct = 0;
    var idx = AB_AUTO_PHASES.indexOf(s.phase);
    if (idx >= 0) pct = Math.round((idx / (AB_AUTO_PHASES.length - 1)) * 100);
    return abOk({
        initialized: true,
        phase: s.phase,
        progress_pct: pct,
        ticks: s.ticks || 0,
        started_at: s.started_at || 0,
        last_tick_at: s.last_tick_at || 0,
        cursor: s.cursor || "",
        rollup_window: { from: s.rollup_from || "", cursor: s.rollup_cursor || "", to: s.rollup_to || "" },
        stats: s.stats || {},
        errors: (s.errors || []).slice(-5)
    });
}

// ── RPC: analytics_auto_reset (admin-gated; rare ops use only) ──
//
// Wipes the state doc so the state machine restarts from "init" on the
// next piggyback. Use after a code change that would re-process history
// differently (e.g. fixing a bug in events_replay).
function rpcAnalyticsAutoReset(ctx, logger, nk, payload) {
    var data = abParse(payload);
    var auth;
    try { auth = aaRequireAdmin(ctx, nk, logger, data); }
    catch (e) { return abErr("admin gate not loaded", 500); }
    if (!auth.ok) return abErr(auth.reason || "unauthorized", 401);

    try {
        nk.storageDelete([{
            collection: AB_AUTO_COLLECTION, key: AB_AUTO_KEY, userId: AB_SYSTEM_USER
        }]);
    } catch (e) { /* ok if it didn't exist */ }
    abAutoDoneCacheUntil = 0;
    return abOk({ reset: true, message: "state cleared, next piggyback will re-init" });
}

// ── Module init ───────────────────────────────────────────
// postbuild.js scans for registerRpc calls in InitModule and rewires them
// into the bundled index.js entrypoint that Nakama actually loads.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_backfill_dual", rpcAnalyticsBackfillDual);
    initializer.registerRpc("analytics_auto_kick",     rpcAnalyticsAutoKick);
    initializer.registerRpc("analytics_auto_status",   rpcAnalyticsAutoStatus);
    initializer.registerRpc("analytics_auto_reset",    rpcAnalyticsAutoReset);
    if (logger && logger.info) {
        logger.info("[analytics_backfill] module loaded — RPCs: analytics_backfill_dual, analytics_auto_kick, analytics_auto_status, analytics_auto_reset");
    }
}
