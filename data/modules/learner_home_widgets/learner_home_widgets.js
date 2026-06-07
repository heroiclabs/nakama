// learner_home_widgets.js — Per-user Home-screen widget configs for TutorX
// Nakama V8 JavaScript runtime (Goja ES5 — no ES modules, no Node built-ins).
//
// The TutorX dashboard (tutorx.quizverse.world) lets a learner pin live, animated
// widgets (Exam Countdown / GPA / Study Plan / School) to their Home screen. The
// *data* behind each widget already lives in Nakama (lt_exam_countdown_*, lt_gpa_*,
// lt_school_*). This module persists only the small *presentation config* (which
// tools are pinned + their style/theme/size/motion) so it:
//   • survives an iOS WKWebView / Android WebView cache-clear, and
//   • syncs across the learner's devices.
// The web client also keeps a localStorage copy, so these RPCs are best-effort:
// if they ever fail the widgets still work locally.
//
// RPCs:
//   lt_home_widgets_get  → { success:true, widgets:[...], updated_at:<ms> }
//   lt_home_widgets_set  ← { widgets:[...] }  → { success:true, count:N }
//
// Storage: collection "qv_home_widgets", key "config_v1", owned by the calling user
// (permissionRead:1 owner-only, permissionWrite:0 server-only).

// ============================================================================
// CONSTANTS
// ============================================================================

var HW_COLLECTION = "qv_home_widgets";
var HW_KEY = "config_v1";
var HW_MAX_WIDGETS = 24;      // sane cap — a Home screen won't hold more
var HW_MAX_STR = 160;         // clamp any single string field
var HW_KINDS = { countdown: 1, gpa: 1, studyplan: 1, school: 1, guided: 1, reminders: 1 };
var HW_STYLES = { number: 1, ring: 1, flip: 1, minimal: 1, checklist: 1 };
var HW_THEMES = { aurora: 1, sunset: 1, ocean: 1, forest: 1, rose: 1, mono: 1 };
var HW_SIZES = { s: 1, m: 1, l: 1 };
var HW_ANIMS = { pulse: 1, glow: 1, float: 1, shimmer: 1, none: 1 };

// ============================================================================
// HELPERS
// ============================================================================

function hwOk(obj) {
    obj = obj || {};
    obj.success = true;
    return JSON.stringify(obj);
}

function hwErr(msg) {
    return JSON.stringify({ success: false, error: msg || "error" });
}

function hwNowMs() {
    return Date.now();
}

function hwStr(v, fallback) {
    if (v == null) return fallback || "";
    var s = String(v);
    if (s.length > HW_MAX_STR) s = s.substring(0, HW_MAX_STR);
    return s;
}

// Keep only known fields with valid values so a tampered/oversized payload can
// never bloat storage or inject unexpected data.
function hwSanitizeSnap(snap) {
    if (!snap || typeof snap !== "object") return null;
    var out = {
        big: hwStr(snap.big, ""),
        unit: hwStr(snap.unit, ""),
        sub: hwStr(snap.sub, "")
    };
    if (typeof snap.frac === "number" && isFinite(snap.frac)) {
        out.frac = Math.max(0, Math.min(1, snap.frac));
    } else {
        out.frac = null;
    }
    if (snap.text === true) out.text = true;
    return out;
}

function hwSanitizeWidget(w) {
    if (!w || typeof w !== "object") return null;
    var kind = (HW_KINDS[w.kind]) ? w.kind : "countdown";
    var ref = hwStr(w.ref || w.exam_id || kind, kind);
    var cfg = {
        id: hwStr(w.id || (kind + ":" + ref), kind + ":" + ref),
        kind: kind,
        ref: ref,
        label: hwStr(w.label, ""),
        date_iso: hwStr(w.date_iso, ""),
        snap: hwSanitizeSnap(w.snap),
        style: (HW_STYLES[w.style]) ? w.style : "ring",
        theme: (HW_THEMES[w.theme]) ? w.theme : "aurora",
        size: (HW_SIZES[w.size]) ? w.size : "m",
        anim: (HW_ANIMS[w.anim]) ? w.anim : "pulse",
        seconds: w.seconds === true,
        milestones: w.milestones === true,
        brand: w.brand !== false
    };
    return cfg;
}

function hwSanitizeList(list) {
    var out = [];
    if (!list || typeof list.length !== "number") return out;
    var seen = {};
    for (var i = 0; i < list.length && out.length < HW_MAX_WIDGETS; i++) {
        var cfg = hwSanitizeWidget(list[i]);
        if (!cfg) continue;
        if (seen[cfg.id]) continue; // de-dupe by id
        seen[cfg.id] = 1;
        out.push(cfg);
    }
    return out;
}

// ============================================================================
// RPC: lt_home_widgets_get
// ============================================================================

function rpcLtHomeWidgetsGet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return hwErr("no_user");
    try {
        var records = nk.storageRead([{
            collection: HW_COLLECTION,
            key: HW_KEY,
            userId: uid
        }]);
        if (records && records.length > 0 && records[0].value && records[0].value.widgets) {
            var v = records[0].value;
            return hwOk({ widgets: hwSanitizeList(v.widgets), updated_at: v.updated_at || 0 });
        }
    } catch (e) {
        logger.warn("[HomeWidgets] get failed for " + uid + ": " + e);
    }
    return hwOk({ widgets: [], updated_at: 0 });
}

// ============================================================================
// RPC: lt_home_widgets_set
// ============================================================================

function rpcLtHomeWidgetsSet(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return hwErr("no_user");

    var data = {};
    try { data = JSON.parse(payload || "{}") || {}; } catch (e) { return hwErr("bad_payload"); }

    var widgets = hwSanitizeList(data.widgets);

    try {
        nk.storageWrite([{
            collection: HW_COLLECTION,
            key: HW_KEY,
            userId: uid,
            value: { widgets: widgets, updated_at: hwNowMs() },
            permissionRead: 1,  // owner-only read
            permissionWrite: 0  // server-only write
        }]);
    } catch (e) {
        logger.warn("[HomeWidgets] set failed for " + uid + ": " + e);
        return hwErr("write_failed");
    }

    return hwOk({ count: widgets.length });
}

// ============================================================================
// MODULE INIT
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("lt_home_widgets_get", rpcLtHomeWidgetsGet);
    initializer.registerRpc("lt_home_widgets_set", rpcLtHomeWidgetsSet);
    logger.info("[HomeWidgets] Registered RPCs: lt_home_widgets_get, lt_home_widgets_set");
}
