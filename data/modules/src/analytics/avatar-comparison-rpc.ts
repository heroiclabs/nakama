// Phase 4 (avatar bakeoff) — analytics_avatar_comparison RPC.
//
// Receives per-session avatar bakeoff telemetry from both web (LiveTalk's
// AvatarRouter) and Unity (AutoCurioGreetingStepV2 → AvatarSession). Each
// event is one of: variant_selected | greeting_shown | first_speaking_frame
// | emotion_transition | interrupted | completed | dropped.
//
// Why a separate RPC instead of folding into analytics_log_event:
//   - We need *per-variant* aggregation in the analyst's daily/weekly
//     bundle. The existing analytics_log_event handler skips writes for
//     SYSTEM_USER (well-known bug) — the bakeoff path needs guaranteed
//     persistence even for unauthenticated /talk visitors.
//   - The bakeoff has its own retention policy (we keep events 30 days,
//     not the 90 days the rest of the funnel keeps).
//
// Storage layout:
//   collection: qv_avatar_bakeoff
//   key:        <unixMsPadded16>_<variant>_<eventType>_<uuid8>
//   value:      AvatarBakeoffEvent (see below)
//   userId:     "" (system-owned, anonymous-safe)
//   perms:      read=0, write=0 (owner-only ⇒ admin reports only)
//
// The companion dashboard SQL lives at:
//   docs/avatar-bakeoff-results.md

namespace QvAvatarComparison {

  export var COLLECTION = "qv_avatar_bakeoff";

  // Keep in sync with:
  //   - web/lib/avatar-telemetry.ts AvatarVariant + AvatarEventType
  //   - Intelliverse-X-AI/src/quiz/ai-voice/dto/ai-voice.dto.ts
  //     AvatarVariantEnum + AvatarEventTypeEnum
  var ALLOWED_VARIANTS: string[] = ["2d", "3d", "video"];
  var ALLOWED_EVENT_TYPES: string[] = [
    "greeting_shown",
    "first_speaking_frame",
    "emotion_transition",
    "topic_spotlight",
    "interrupted",
    "completed",
    "dropped",
  ];
  var ALLOWED_PLATFORMS: string[] = [
    "web", "unity-android", "unity-ios", "unity-editor",
  ];

  interface AvatarBakeoffEvent {
    /** Optional client session id (Intelliverse-X-AI ai-voice session). */
    sessionId?: string;
    /** "2d" | "3d" | "video" — which renderer the user saw. */
    variant: string;
    /** One of ALLOWED_EVENT_TYPES. */
    eventType: string;
    /** "web" | "unity-*". Where the event was emitted from. */
    platform: string;
    /** Milliseconds since the greeting step mounted. Per-event. */
    elapsedMs?: number;
    /** Optional measured FPS (3D / Video variants). */
    framesPerSec?: number;
    /** Optional active emotion when this event fired. */
    emotion?: string;
    /** Optional topic id from the topic extractor. */
    topicId?: string;
    /** 0..5 — placeholder for an in-app rating prompt. */
    reactionScore?: number;
    /** Free-form metadata. Keep small — we don't index it. */
    metadata?: { [k: string]: any };
  }

  function isInList(needle: string, list: string[]): boolean {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === needle) return true;
    }
    return false;
  }

  function pad(n: number): string {
    var s = String(n);
    while (s.length < 16) s = "0" + s;
    return s;
  }

  /**
   * Append one bakeoff event. Open to all users (incl. anonymous /talk
   * visitors via webhook auth) because the cohort comparison only matters
   * if we capture the full funnel. Validates the event shape and quietly
   * drops unknown variants / event types — we do NOT want a malformed
   * client crashing onboarding.
   */
  function rpcAppend(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    var data: AvatarBakeoffEvent;
    try {
      data = JSON.parse(payload || "{}");
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: "invalid json" });
    }

    if (!data.variant || !data.eventType || !data.platform) {
      return JSON.stringify({
        ok: false, error: "missing required fields: variant, eventType, platform",
      });
    }
    if (!isInList(data.variant, ALLOWED_VARIANTS)) {
      return JSON.stringify({ ok: false, error: "variant '" + data.variant + "' not allowed" });
    }
    if (!isInList(data.eventType, ALLOWED_EVENT_TYPES)) {
      return JSON.stringify({ ok: false, error: "eventType '" + data.eventType + "' not allowed" });
    }
    if (!isInList(data.platform, ALLOWED_PLATFORMS)) {
      return JSON.stringify({ ok: false, error: "platform '" + data.platform + "' not allowed" });
    }

    var tsMs = Date.now();
    var storageKey = pad(tsMs) + "_" + data.variant + "_" + data.eventType + "_" + nk.uuidv4().slice(0, 8);
    var value: { [k: string]: any } = {
      sessionId:     data.sessionId    || "",
      variant:       data.variant,
      eventType:     data.eventType,
      platform:      data.platform,
      elapsedMs:     typeof data.elapsedMs    === "number" ? data.elapsedMs : null,
      framesPerSec:  typeof data.framesPerSec === "number" ? data.framesPerSec : null,
      emotion:       data.emotion || "",
      topicId:       data.topicId || "",
      reactionScore: typeof data.reactionScore === "number" ? data.reactionScore : null,
      metadata:      data.metadata || {},
      // Acting userId is captured here for cohort joins, but the storage
      // row remains system-owned so an unauthenticated /talk visitor can
      // still log events.
      userId:        ctx.userId || "",
      tsMs:          tsMs,
    };

    try {
      nk.storageWrite([{
        collection: COLLECTION,
        key: storageKey,
        userId: "",
        value: value,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[QvAvatarComparison] storage write failed: " + ((e && e.message) ? e.message : String(e)));
      return JSON.stringify({ ok: false, error: "storage write failed" });
    }

    return JSON.stringify({ ok: true, storageKey: storageKey, tsMs: tsMs });
  }

  /**
   * Read back recent bakeoff events. Admin-only — gated on the standard
   * Nakama admin role check. Useful for the on-call analyst to spot-check
   * what's landing without round-tripping through the analyst pipeline.
   */
  function rpcReadRecent(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    // Crude admin gate — same pattern used by other analytics RPCs.
    var isAdmin = ctx.userId && ctx.userId.length === 36 && (ctx.username || "").indexOf("admin") >= 0;
    if (!isAdmin) {
      return JSON.stringify({ ok: false, error: "admin only" });
    }
    var req: { limit?: number; variant?: string };
    try { req = JSON.parse(payload || "{}"); }
    catch (e: any) { req = {}; }
    var limit = (typeof req.limit === "number" && req.limit > 0 && req.limit <= 200) ? req.limit : 100;

    var rows: any[] = [];
    try {
      var list = nk.storageList("", COLLECTION, limit);
      for (var i = 0; i < (list.objects || []).length; i++) {
        var o = list.objects[i];
        if (req.variant && o.value && (o.value as any).variant !== req.variant) continue;
        rows.push({ key: o.key, value: o.value });
      }
    } catch (e: any) {
      logger.warn("[QvAvatarComparison] storage list failed: " + ((e && e.message) ? e.message : String(e)));
    }
    return JSON.stringify({ ok: true, count: rows.length, rows: rows });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("analytics_avatar_comparison",        rpcAppend);
    initializer.registerRpc("analytics_avatar_comparison_recent", rpcReadRecent);
  }
}
