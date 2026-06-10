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
//   lt_widget_render     → { success:true, widgets:[...resolved...], updated_at, server_time }
//                          Canonical read endpoint for the NATIVE iOS WidgetKit /
//                          Android AppWidget home-screen widgets. Returns each pinned
//                          widget with a render-ready snapshot (big/unit/sub/frac),
//                          a freshly recomputed countdown, and a quizverse:// deeplink
//                          so a widget tap opens the right screen. The native shells
//                          read this (or the same payload pushed from the web view via
//                          the gree bridge) and write it to their shared container
//                          (App Group / SharedPreferences).
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
var HW_KINDS = { countdown: 1, gpa: 1, studyplan: 1, school: 1, guided: 1, reminders: 1, streak: 1, stats: 1, predictor: 1, shortcut: 1 };
var HW_STYLES = { number: 1, ring: 1, flip: 1, minimal: 1, checklist: 1, stats: 1, shortcut: 1 };
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
    // Tappable shortcut tiles (Book Engine, Quiz, Notebook, …) carry an explicit
    // SPA deeplink + icon set by the web Desk; preserve them so cross-device sync
    // and native rendering route the tap correctly instead of falling back to home.
    if (w.deeplink) cfg.deeplink = hwStr(w.deeplink, "");
    if (w.icon) cfg.icon = hwStr(w.icon, "");
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
// RPC: lt_widget_render  (canonical payload for NATIVE home-screen widgets)
// ============================================================================

// quizverse:// deeplink per widget kind. The schemes/hosts are already registered
// in the iOS Info.plist + Android intent-filter, and the unity-auth-bridge maps
// these path aliases to SPA pages, so a widget tap deep-links straight in.
var HW_DEEPLINK = {
    countdown: "quizverse://exams",
    gpa:       "quizverse://exams",
    school:    "quizverse://exams",
    studyplan: "quizverse://study-plan",
    guided:    "quizverse://guided",
    reminders: "quizverse://home",
    streak:    "quizverse://home",
    stats:     "quizverse://profile",
    predictor: "quizverse://predictor"
};

// A shortcut widget stores its own SPA deeplink (quizverse://<page>); prefer it so
// new learning surfaces (book/quiz/notebook/research/visualize/…) route correctly
// without needing an entry per page in the kind→deeplink table.
function hwDeeplink(w) {
    if (w && w.deeplink) return w.deeplink;
    var kind = w && w.kind ? w.kind : w;
    return HW_DEEPLINK[kind] || "quizverse://home";
}

function hwPad2(n) { return (n < 10 ? "0" : "") + n; }

// Recompute a countdown snapshot server-side from the stored ISO date so the
// native widget shows the correct day count even if the cached snap is stale.
// Returns null when there's no parseable date (caller keeps the existing snap).
function hwCountdownSnap(dateIso) {
    if (!dateIso) return null;
    var t = Date.parse(dateIso);
    if (isNaN(t)) return null;
    var nowMs = Date.now();
    var diffMs = t - nowMs;
    if (diffMs <= 0) {
        return { big: "0", unit: "days", sub: "It's here \u2014 good luck!", frac: 1 };
    }
    var totalDays = Math.ceil(diffMs / 86400000);
    var hours = Math.floor((diffMs % 86400000) / 3600000);
    // frac = progress within a (capped) 180-day runway so a ring fills as the day nears.
    var frac = Math.max(0, Math.min(1, 1 - (totalDays / 180)));
    var unit = totalDays === 1 ? "day" : "days";
    var sub = totalDays <= 1 ? (hours + "h to go") : (totalDays + " " + unit + " to go");
    return { big: String(totalDays), unit: unit, sub: sub, frac: frac };
}

// Build a render-ready widget object from a sanitized config.
function hwRenderWidget(w) {
    var snap = w.snap || {};
    var big = snap.big || "";
    var unit = snap.unit || "";
    var sub = snap.sub || "";
    var frac = (typeof snap.frac === "number") ? snap.frac : null;

    if (w.kind === "countdown") {
        var cs = hwCountdownSnap(w.date_iso);
        if (cs) { big = cs.big; unit = cs.unit; sub = cs.sub; frac = cs.frac; }
    }

    return {
        id: w.id,
        kind: w.kind,
        ref: w.ref,
        label: w.label || "",
        style: w.style,
        theme: w.theme,
        size: w.size,
        anim: w.anim,
        seconds: w.seconds === true,
        milestones: w.milestones === true,
        brand: w.brand !== false,
        date_iso: w.date_iso || "",
        big: big,
        unit: unit,
        sub: sub,
        frac: frac,
        icon: w.icon || "",
        deeplink: hwDeeplink(w)
    };
}

function rpcLtWidgetRender(ctx, logger, nk, payload) {
    var uid = ctx.userId;
    if (!uid) return hwErr("no_user");

    var widgets = [];
    var updatedAt = 0;
    try {
        var records = nk.storageRead([{ collection: HW_COLLECTION, key: HW_KEY, userId: uid }]);
        if (records && records.length > 0 && records[0].value && records[0].value.widgets) {
            var v = records[0].value;
            updatedAt = v.updated_at || 0;
            var clean = hwSanitizeList(v.widgets);
            for (var i = 0; i < clean.length; i++) {
                widgets.push(hwRenderWidget(clean[i]));
            }
        }
    } catch (e) {
        logger.warn("[HomeWidgets] render failed for " + uid + ": " + e);
    }

    return hwOk({ widgets: widgets, updated_at: updatedAt, server_time: hwNowMs() });
}

// ============================================================================
// MODULE INIT
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("lt_home_widgets_get", rpcLtHomeWidgetsGet);
    initializer.registerRpc("lt_home_widgets_set", rpcLtHomeWidgetsSet);
    initializer.registerRpc("lt_widget_render", rpcLtWidgetRender);
    logger.info("[HomeWidgets] Registered RPCs: lt_home_widgets_get, lt_home_widgets_set, lt_widget_render");
}
