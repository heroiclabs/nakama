// ---------------------------------------------------------------------------
// ActiveRolling — rolling-window distinct-user counts for admin live KPIs.
//
// Written on ingest (analytics_log_event + onboarding_events_batch), read by
// satori_dashboard_summary. One storage doc per channel + scope holds recent
// user touches (userId + lastSeenMs), pruned to 24h / capped at MAX_TOUCHES.
// ---------------------------------------------------------------------------
namespace ActiveRolling {

  var COLLECTION = "analytics_active_rolling";
  var MAX_TOUCHES = 8000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var HOUR_MS = 60 * 60 * 1000;
  var MIN_5_MS = 5 * 60 * 1000;

  export interface Touch {
    u: string;
    t: number;
  }

  export interface Doc {
    touches: Touch[];
    updatedAt: number;
  }

  export interface WindowCounts {
    active5m: number;
    active1h: number;
    active24h: number;
  }

  function isPlatformScope(gameId?: string): boolean {
    return !gameId || gameId === "all" || gameId === "global";
  }

  function scopeKey(channel: string, gameId?: string): string {
    if (channel === "onboarding") return "roll_onboarding";
    return "roll_in_app_" + (isPlatformScope(gameId) ? "all" : gameId);
  }

  function prune(touches: Touch[], now: number): Touch[] {
    var cutoff = now - DAY_MS;
    var out: Touch[] = [];
    for (var i = 0; i < touches.length; i++) {
      if (touches[i].u && touches[i].t >= cutoff) out.push(touches[i]);
    }
    if (out.length > MAX_TOUCHES) out = out.slice(out.length - MAX_TOUCHES);
    return out;
  }

  function upsertTouch(doc: Doc, userId: string, tsMs: number): void {
    var touches = doc.touches || [];
    for (var i = 0; i < touches.length; i++) {
      if (touches[i].u === userId) {
        if (tsMs > touches[i].t) touches[i].t = tsMs;
        doc.touches = touches;
        return;
      }
    }
    touches.push({ u: userId, t: tsMs });
    doc.touches = touches;
  }

  function writeDoc(nk: nkruntime.Nakama, key: string, doc: Doc): void {
    Storage.writeSystemJson(nk, COLLECTION, key, doc);
  }

  // Record activity for a channel. in_app also mirrors to roll_in_app_all when scoped.
  export function touch(
    nk: nkruntime.Nakama,
    channel: "in_app" | "onboarding",
    userId: string,
    gameId?: string,
    tsMs?: number
  ): void {
    if (!userId) return;
    var now = tsMs || Date.now();
    try {
      var key = scopeKey(channel, gameId);
      var doc = Storage.readSystemJson<Doc>(nk, COLLECTION, key) || { touches: [], updatedAt: 0 };
      doc.touches = prune(doc.touches || [], now);
      upsertTouch(doc, userId, now);
      doc.touches = prune(doc.touches, now);
      doc.updatedAt = now;
      writeDoc(nk, key, doc);

      if (channel === "in_app" && !isPlatformScope(gameId)) {
        var allKey = scopeKey("in_app", "all");
        var allDoc = Storage.readSystemJson<Doc>(nk, COLLECTION, allKey) || { touches: [], updatedAt: 0 };
        allDoc.touches = prune(allDoc.touches || [], now);
        upsertTouch(allDoc, userId, now);
        allDoc.touches = prune(allDoc.touches, now);
        allDoc.updatedAt = now;
        writeDoc(nk, allKey, allDoc);
      }
    } catch (e) {
      // Never break ingest on KPI bookkeeping.
    }
  }

  export function countWindows(
    nk: nkruntime.Nakama,
    channel: "in_app" | "onboarding",
    gameId?: string,
    nowMs?: number
  ): WindowCounts {
    var now = nowMs || Date.now();
    var key = scopeKey(channel, gameId);
    var doc = Storage.readSystemJson<Doc>(nk, COLLECTION, key);
    var touches = (doc && doc.touches) || [];
    var s5: { [u: string]: boolean } = {};
    var s1: { [u: string]: boolean } = {};
    var s24: { [u: string]: boolean } = {};
    for (var i = 0; i < touches.length; i++) {
      var row = touches[i];
      if (!row.u) continue;
      var age = now - row.t;
      if (age < 0) continue;
      if (age <= MIN_5_MS) s5[row.u] = true;
      if (age <= HOUR_MS) s1[row.u] = true;
      if (age <= DAY_MS) s24[row.u] = true;
    }
    return {
      active5m: Object.keys(s5).length,
      active1h: Object.keys(s1).length,
      active24h: Object.keys(s24).length
    };
  }

  export function mergeCounts(a: WindowCounts, b: WindowCounts): WindowCounts {
    return {
      active5m: a.active5m + b.active5m,
      active1h: a.active1h + b.active1h,
      active24h: a.active24h + b.active24h
    };
  }
}
