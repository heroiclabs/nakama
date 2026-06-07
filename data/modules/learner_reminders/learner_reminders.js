// learner_reminders.js — Per-user study reminders for TutorX (Goja ES5, no Node built-ins).
//
// Lets a learner create study reminders (one-off or recurring: daily / weekdays /
// weekly) that power the Reminders Home-screen widget and an in-app reminders
// sheet. Stored per user in Nakama storage so they sync across devices; a native
// mobile shell can read this same list to schedule local notifications, and the
// web/WebView surfaces due reminders in-app.
//
// Reminder cadences are grounded in spaced-repetition research (the "2357 method":
// review at +1/+2/+3/+5/+7 day intervals off the forgetting curve). The client
// expands a 2357 preset into individual one-off dated reminders, so this module
// stays a simple, robust store.
//
// RPCs:
//   lt_reminders_get → { success, reminders:[...], updated_at }
//   lt_reminders_add ← { reminder:{...} } → assigns id, appends, sends an in-app
//                       confirmation notification → { success, reminders }
//   lt_reminders_set ← { reminders:[...] } → replaces the whole list (used for
//                       toggle-done / edit / delete / reorder) → { success, reminders }
//
// Storage: collection "qv_reminders", key "list_v1", owner-read(1) server-write(0).

// ============================================================================
// CONSTANTS
// ============================================================================

var RM_COLLECTION = "qv_reminders";
var RM_KEY = "list_v1";
var RM_MAX = 60;            // cap reminders per user
var RM_MAX_TEXT = 160;
var RM_MAX_TAG = 32;
var RM_NOTIF_CODE = 220;    // in-app notification code for reminders
var RM_REPEATS = { once: 1, daily: 1, weekdays: 1, weekly: 1 };

// ============================================================================
// HELPERS
// ============================================================================

function rmOk(obj) { obj = obj || {}; obj.success = true; return JSON.stringify(obj); }
function rmErr(msg) { return JSON.stringify({ success: false, error: msg || "error" }); }
function rmNowMs() { return Date.now(); }

function rmStr(v, max, fallback) {
    if (v == null) return fallback || "";
    var s = String(v);
    if (max && s.length > max) s = s.substring(0, max);
    return s;
}

// "HH:MM" 24h → normalized, else default "09:00".
function rmTime(v) {
    var s = String(v == null ? "" : v);
    var m = /^([0-9]{1,2}):([0-9]{2})$/.exec(s);
    if (!m) return "09:00";
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return "09:00";
    return (h < 10 ? "0" + h : "" + h) + ":" + (mi < 10 ? "0" + mi : "" + mi);
}

// "YYYY-MM-DD" → itself, else "".
function rmDate(v) {
    var s = String(v == null ? "" : v);
    return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : "";
}

function rmId(v) {
    var s = rmStr(v, 48, "");
    s = s.replace(/[^a-zA-Z0-9_\-:.]/g, "");
    return s;
}

function rmGenId() {
    return "rem_" + rmNowMs().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
}

function rmSanitize(r) {
    if (!r || typeof r !== "object") return null;
    var text = rmStr(r.text, RM_MAX_TEXT, "").replace(/[\r\n\t]+/g, " ");
    if (!text) return null;
    var repeat = RM_REPEATS[r.repeat] ? r.repeat : "daily";
    var wd = parseInt(r.weekday, 10);
    if (isNaN(wd) || wd < 0 || wd > 6) wd = -1;
    return {
        id: rmId(r.id) || rmGenId(),
        text: text,
        time: rmTime(r.time),
        repeat: repeat,
        date: rmDate(r.date),       // used when repeat === "once"
        weekday: wd,                // used when repeat === "weekly" (0=Sun)
        tag: rmStr(r.tag, RM_MAX_TAG, ""),
        done: r.done === true,
        doneDate: rmDate(r.doneDate),   // "YYYY-MM-DD" the reminder was last ticked (for recurring/daily)
        createdAt: (typeof r.createdAt === "number" && r.createdAt > 0) ? r.createdAt : rmNowMs()
    };
}

function rmSanitizeList(list) {
    var out = [];
    if (!list || typeof list.length !== "number") return out;
    var seen = {};
    for (var i = 0; i < list.length && out.length < RM_MAX; i++) {
        var c = rmSanitize(list[i]);
        if (!c) continue;
        if (seen[c.id]) c.id = rmGenId();
        seen[c.id] = 1;
        out.push(c);
    }
    return out;
}

function rmRead(nk, uid) {
    try {
        var recs = nk.storageRead([{ collection: RM_COLLECTION, key: RM_KEY, userId: uid }]);
        if (recs && recs.length > 0 && recs[0].value && recs[0].value.reminders) {
            return { list: rmSanitizeList(recs[0].value.reminders), updated_at: recs[0].value.updated_at || 0 };
        }
    } catch (e) { /* default below */ }
    return { list: [], updated_at: 0 };
}

function rmWrite(nk, uid, list) {
    nk.storageWrite([{
        collection: RM_COLLECTION,
        key: RM_KEY,
        userId: uid,
        value: { reminders: list, updated_at: rmNowMs() },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

// ============================================================================
// RPCs
// ============================================================================

function rpcLtRemindersGet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rmErr("no_user");
    var r = rmRead(nk, uid);
    return rmOk({ reminders: r.list, updated_at: r.updated_at });
}

function rpcLtRemindersAdd(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rmErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return rmErr("bad_payload"); }

    var rem = rmSanitize(data.reminder || data);
    if (!rem) return rmErr("invalid_reminder");

    var r = rmRead(nk, uid);
    var list = r.list;
    if (list.length >= RM_MAX) return rmErr("reminder_cap");
    list.push(rem);

    try { rmWrite(nk, uid, list); }
    catch (e) { logger.warn("[Reminders] add write failed for " + uid + ": " + e); return rmErr("write_failed"); }

    // Best-effort in-app confirmation notification (persistent inbox entry).
    try {
        nk.notificationsSend([{
            userId: uid,
            subject: "\u23F0 Reminder set",
            content: { type: "reminder_set", id: rem.id, text: rem.text, time: rem.time, repeat: rem.repeat, date: rem.date },
            code: RM_NOTIF_CODE,
            persistent: true
        }]);
    } catch (e) { /* notifications are non-critical */ }

    return rmOk({ reminders: list, added: rem });
}

function rpcLtRemindersSet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return rmErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return rmErr("bad_payload"); }

    var list = rmSanitizeList(data.reminders);

    try { rmWrite(nk, uid, list); }
    catch (e) { logger.warn("[Reminders] set write failed for " + uid + ": " + e); return rmErr("write_failed"); }

    return rmOk({ reminders: list });
}

// ============================================================================
// MODULE INIT
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("lt_reminders_get", rpcLtRemindersGet);
    initializer.registerRpc("lt_reminders_add", rpcLtRemindersAdd);
    initializer.registerRpc("lt_reminders_set", rpcLtRemindersSet);
    logger.info("[Reminders] Registered RPCs: lt_reminders_get, lt_reminders_add, lt_reminders_set");
}
