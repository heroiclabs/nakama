// learner_review.js — First-class spaced-repetition review queue for TutorX
// (Goja ES5, no Node built-ins, all RPC fns at global scope).
//
// Promotes the web "Review queue" (Leitner-box spaced repetition / Ebbinghaus
// forgetting curve) from a localStorage + S3 best-effort mirror into an
// authoritative Nakama store that syncs across devices AND lets the server own
// the review SCHEDULE. The native iOS/Android shell reads lt_review_due to
// register local notifications at the exact due time, and a server cron
// (LegacyPush.runReviewCron) sends a real OS push as a backstop.
//
// Each review item is a saved concept the learner wants to lock into long-term
// memory:
//   { id, q, a, exam, box, reps, addedTs, dueTs, lastTs }
// Scheduling is server-authoritative: grading an item moves it up/down the
// Leitner ladder and recomputes dueTs from REVIEW_INTERVALS — so every device
// (and the push cron) agrees on when it is next due.
//
// RPCs:
//   lt_review_get   → { success, items:[...], due_count, next_due_ts, updated_at }
//   lt_review_set   ← { items:[...] } → replaces the whole list (web cross-device
//                     mirror / bulk edit) → { success, items, due_count }
//   lt_review_add   ← { q, a?, exam? } | { item:{...} } → appends a concept
//                     (server assigns id, box=0, dueTs=start of tomorrow), best-effort
//                     in-app confirmation notification → { success, items, added }
//   lt_review_grade ← { id, remembered:bool } → server recomputes box + dueTs via
//                     the Leitner ladder → { success, item, due_count }
//   lt_review_due   ← { horizon_days? (default 3), limit? (default 40) } → due +
//                     soon-due items as native-ready nudge payloads
//                     { success, now, items:[{ id, title, body, due_ts, deeplink }] }
//
// Storage: collection "qv_review", key "list_v1", owner-read(1) server-write(0).

// ============================================================================
// CONSTANTS
// ============================================================================

var RV_COLLECTION = "qv_review";
var RV_KEY = "list_v1";
var RV_MAX = 300;          // cap concepts per user (matches web slice cap)
var RV_MAX_Q = 180;        // concept/question text cap
var RV_MAX_A = 700;        // saved answer/explanation cap
var RV_MAX_EXAM = 64;
var RV_NOTIF_CODE = 221;   // in-app notification code for review (220 = reminders)

// Leitner box index → days until next review. Mirrors the web _QV_SR_INTERVALS
// so client and server schedules agree exactly.
var REVIEW_INTERVALS = [1, 3, 7, 16, 35];
var RV_DAY_MS = 86400000;
var RV_DEEPLINK = "quizverse://tutorx/review";

// ============================================================================
// HELPERS
// ============================================================================

function rvOk(obj) { obj = obj || {}; obj.success = true; return JSON.stringify(obj); }
function rvErr(msg) { return JSON.stringify({ success: false, error: msg || "error" }); }
function rvNowMs() { return Date.now(); }

function rvStr(v, max, fallback) {
    if (v == null) return fallback || "";
    var s = String(v);
    if (max && s.length > max) s = s.substring(0, max);
    return s;
}

function rvNum(v, fallback) {
    var n = parseInt(v, 10);
    return (typeof n === "number" && !isNaN(n)) ? n : (fallback || 0);
}

function rvId(v) {
    var s = rvStr(v, 48, "").replace(/[^a-zA-Z0-9_\-:.]/g, "");
    return s;
}

function rvGenId() {
    return "r_" + rvNowMs().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
}

// Start of the user's "tomorrow" in UTC. We intentionally schedule fresh saves
// for the next calendar day (server UTC) — the same default the web store used
// (_qvStartOfTomorrow) — so a concept saved during a session resurfaces the
// next day rather than immediately.
function rvStartOfTomorrowMs() {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() + RV_DAY_MS;
}

function rvClampBox(b) {
    var n = rvNum(b, 0);
    if (n < 0) n = 0;
    if (n > REVIEW_INTERVALS.length - 1) n = REVIEW_INTERVALS.length - 1;
    return n;
}

function rvSanitize(it) {
    if (!it || typeof it !== "object") return null;
    var q = rvStr(it.q, RV_MAX_Q, "").replace(/[\r\n\t]+/g, " ").trim();
    if (!q || q.length < 3) return null;
    var box = rvClampBox(it.box);
    var addedTs = (typeof it.addedTs === "number" && it.addedTs > 0) ? it.addedTs : rvNowMs();
    var dueTs = (typeof it.dueTs === "number" && it.dueTs > 0) ? it.dueTs : rvStartOfTomorrowMs();
    var lastTs = (typeof it.lastTs === "number" && it.lastTs > 0) ? it.lastTs : 0;
    return {
        id: rvId(it.id) || rvGenId(),
        q: q,
        a: rvStr(it.a, RV_MAX_A, ""),
        exam: rvStr(it.exam, RV_MAX_EXAM, ""),
        box: box,
        reps: rvNum(it.reps, 0),
        addedTs: addedTs,
        dueTs: dueTs,
        lastTs: lastTs
    };
}

function rvSanitizeList(list) {
    var out = [];
    if (!list || typeof list.length !== "number") return out;
    var seen = {};
    var seenQ = {};
    for (var i = 0; i < list.length && out.length < RV_MAX; i++) {
        var c = rvSanitize(list[i]);
        if (!c) continue;
        // De-dup by normalized concept text (matches the web _qvNorm guard) so a
        // cross-device merge or a double save never stacks the same card twice.
        var qk = c.q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
        if (seenQ[qk]) continue;
        // Guarantee a unique id even if two ids collide (rvGenId's timestamp is
        // constant inside this synchronous loop, so only the random part varies);
        // regenerate until actually unused, capped to avoid a pathological loop.
        if (seen[c.id]) {
            var guard = 0;
            do { c.id = rvGenId(); guard++; } while (seen[c.id] && guard < 100);
        }
        seen[c.id] = 1;
        seenQ[qk] = 1;
        out.push(c);
    }
    return out;
}

function rvDueCount(list, now) {
    var n = 0;
    for (var i = 0; i < list.length; i++) { if ((list[i].dueTs || 0) <= now) n++; }
    return n;
}

function rvNextDueTs(list) {
    var next = 0;
    for (var i = 0; i < list.length; i++) {
        var d = list[i].dueTs || 0;
        if (d > 0 && (next === 0 || d < next)) next = d;
    }
    return next;
}

function rvRead(nk, uid) {
    try {
        var recs = nk.storageRead([{ collection: RV_COLLECTION, key: RV_KEY, userId: uid }]);
        if (recs && recs.length > 0 && recs[0].value && recs[0].value.items) {
            return { list: rvSanitizeList(recs[0].value.items), updated_at: recs[0].value.updated_at || 0 };
        }
    } catch (e) { /* default below */ }
    return { list: [], updated_at: 0 };
}

function rvWrite(nk, uid, list) {
    nk.storageWrite([{
        collection: RV_COLLECTION,
        key: RV_KEY,
        userId: uid,
        value: { items: list, updated_at: rvNowMs() },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

// ============================================================================
// RPCs
// ============================================================================

function rpcLtReviewGet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rvErr("no_user");
    var r = rvRead(nk, uid);
    var now = rvNowMs();
    return rvOk({
        items: r.list,
        due_count: rvDueCount(r.list, now),
        next_due_ts: rvNextDueTs(r.list),
        updated_at: r.updated_at
    });
}

function rpcLtReviewSet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rvErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return rvErr("bad_payload"); }

    var list = rvSanitizeList(data.items);

    try { rvWrite(nk, uid, list); }
    catch (e) { logger.warn("[Review] set write failed for " + uid + ": " + e); return rvErr("write_failed"); }

    return rvOk({ items: list, due_count: rvDueCount(list, rvNowMs()) });
}

function rpcLtReviewAdd(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rvErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return rvErr("bad_payload"); }

    // Accept either a flat { q, a, exam } shape or a nested { item:{...} }.
    var src = data.item || data;
    var item = rvSanitize({
        q: src.q,
        a: src.a,
        exam: src.exam,
        box: 0,
        reps: 0,
        addedTs: rvNowMs(),
        dueTs: rvStartOfTomorrowMs()
    });
    if (!item) return rvErr("invalid_concept");

    var r = rvRead(nk, uid);
    var list = r.list;

    // Skip duplicates by normalized concept text (idempotent save).
    var qk = item.q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
    for (var i = 0; i < list.length; i++) {
        var ek = String(list[i].q || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
        if (ek === qk) return rvOk({ items: list, added: null, duplicate: true });
    }
    if (list.length >= RV_MAX) list = list.slice(0, RV_MAX - 1);
    list.unshift(item);

    try { rvWrite(nk, uid, list); }
    catch (e) { logger.warn("[Review] add write failed for " + uid + ": " + e); return rvErr("write_failed"); }

    // Best-effort in-app confirmation (persistent inbox entry). Non-critical.
    try {
        nk.notificationsSend([{
            userId: uid,
            subject: "\uD83E\uDDE0 Saved to review",
            content: { type: "review_saved", id: item.id, q: item.q, exam: item.exam, due_ts: item.dueTs },
            code: RV_NOTIF_CODE,
            persistent: true
        }]);
    } catch (e) { /* ignore */ }

    return rvOk({ items: list, added: item });
}

function rpcLtReviewGrade(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rvErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return rvErr("bad_payload"); }

    var id = rvId(data.id);
    if (!id) return rvErr("missing_id");
    var remembered = (data.remembered === true || data.remembered === 1 || data.remembered === "true");

    var r = rvRead(nk, uid);
    var list = r.list;
    var found = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            var it = list[i];
            // Server-authoritative Leitner step: promote on recall, reset to box 0
            // on a miss; recompute the next due date from REVIEW_INTERVALS.
            it.box = remembered ? rvClampBox((it.box || 0) + 1) : 0;
            it.reps = (it.reps || 0) + 1;
            it.lastTs = rvNowMs();
            it.dueTs = rvNowMs() + (REVIEW_INTERVALS[it.box] || 1) * RV_DAY_MS;
            found = it;
            break;
        }
    }
    if (!found) return rvErr("not_found");

    try { rvWrite(nk, uid, list); }
    catch (e) { logger.warn("[Review] grade write failed for " + uid + ": " + e); return rvErr("write_failed"); }

    return rvOk({ item: found, due_count: rvDueCount(list, rvNowMs()) });
}

// Native-ready nudge feed: every item due now or within horizon_days, shaped so
// the iOS/Android shell can register a local notification per item at due_ts.
function rpcLtReviewDue(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rvErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { data = {}; }

    var horizonDays = rvNum(data.horizon_days, 3);
    if (horizonDays < 0) horizonDays = 0;
    if (horizonDays > 60) horizonDays = 60;
    var limit = rvNum(data.limit, 40);
    if (limit < 1) limit = 1;
    if (limit > RV_MAX) limit = RV_MAX;

    var now = rvNowMs();
    var horizon = now + horizonDays * RV_DAY_MS;

    var r = rvRead(nk, uid);
    var list = r.list.slice();
    // Soonest-due first so the most urgent nudges register first under `limit`.
    list.sort(function (a, b) { return (a.dueTs || 0) - (b.dueTs || 0); });

    var out = [];
    for (var i = 0; i < list.length && out.length < limit; i++) {
        var it = list[i];
        var due = it.dueTs || 0;
        if (due > horizon) break;   // sorted — nothing further is within horizon
        var examTag = it.exam ? (" \u00B7 " + it.exam) : "";
        out.push({
            id: it.id,
            title: "\uD83E\uDDE0 Time to review" + examTag,
            body: it.q,
            due_ts: due,
            deeplink: RV_DEEPLINK
        });
    }

    return rvOk({ now: now, horizon_ts: horizon, due_count: rvDueCount(r.list, now), items: out });
}

// ============================================================================
// MODULE INIT
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("lt_review_get", rpcLtReviewGet);
    initializer.registerRpc("lt_review_set", rpcLtReviewSet);
    initializer.registerRpc("lt_review_add", rpcLtReviewAdd);
    initializer.registerRpc("lt_review_grade", rpcLtReviewGrade);
    initializer.registerRpc("lt_review_due", rpcLtReviewDue);
    logger.info("[Review] Registered RPCs: lt_review_get, lt_review_set, lt_review_add, lt_review_grade, lt_review_due");
}
