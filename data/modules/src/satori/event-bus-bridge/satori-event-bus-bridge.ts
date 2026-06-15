// ============================================================
// Satori EventBus Bridge — feed the Satori analytics pipeline from the
// gameplay events Nakama ALREADY emits on its internal EventBus.
//
// WHY THIS EXISTS
//   The Satori admin console (Dashboard / Timeline / Funnels / Metrics /
//   Experiment-results) all read from the `satori_events` collection +
//   the `satori_debugger` ring buffer. Those are ONLY written when
//   something calls SatoriEventCapture (the `satori_event` /
//   `satori_events_batch` / `*_external` RPCs).
//
//   Today nothing calls them server-side: the Unity client's Satori
//   integration is still a stub, and the marketing web client posts to a
//   different ingest. So the console is empty even though the game is
//   very much alive — every quiz, session and purchase flows through the
//   server as an EventBus event (see QuestEventBusBridge, which already
//   listens to the exact same events to auto-progress quests).
//
//   This bridge mirrors QuestEventBusBridge: it subscribes to the
//   well-known gameplay EventBus events and forwards each one into
//   SatoriEventCapture.captureEvent(). Result: the Satori console fills
//   with REAL gameplay analytics with ZERO client or web changes — purely
//   server-side.
//
// LAZY INIT (same rationale as QuestEventBusBridge)
//   Reading `EventBus.Events.*` at namespace-eval time creates an
//   eval-order dependency on the EventBus namespace IIFE having already
//   run. The merged bundle's namespace order is not guaranteed across
//   tsc versions / file ordering, and getting it wrong crashes the whole
//   goja runtime with "Cannot read property 'Events' of undefined".
//   Deferring the reads to register() (called from InitModule) guarantees
//   EventBus is fully defined first.
//
// WRITE-AMPLIFICATION NOTE
//   Every captured event does extra storage writes (satori_events row +
//   per-user history + metrics + webhooks + data-lake + debugger ring).
//   We therefore capture a CURATED set of high-signal, lower-frequency
//   events (session/quiz/game/purchase/progression/achievement) and
//   deliberately skip the highest-frequency micro-events (xp_earned,
//   currency_*, item_*, stat_updated, energy_*, achievement_progress).
//   Tune SUBSCRIBED in one place if you want more/less granularity.
// ============================================================

namespace SatoriEventBusBridge {

  // Which EventBus events to forward into Satori analytics. The captured
  // Satori event name is the EventBus event name verbatim (already
  // snake_case), so taxonomy schemas line up 1:1.
  var _subscribed: string[] | null = null;

  function subscribed(): string[] {
    if (_subscribed) {
      return _subscribed;
    }
    _subscribed = [
      // Audience / DAU
      EventBus.Events.SESSION_START,
      EventBus.Events.SESSION_END,
      // Core gameplay
      EventBus.Events.QUIZ_COMPLETED,
      EventBus.Events.GAME_STARTED,
      EventBus.Events.GAME_COMPLETED,
      // NOTE: SCORE_SUBMITTED is intentionally excluded — it's the highest-
      // frequency gameplay event and would dominate write volume (and any
      // configured webhook/data-lake fan-out). DAU/engagement is already
      // well-covered by session/quiz/game events. Add it back here if you
      // want score-level granularity and have headroom.
      // Monetization
      EventBus.Events.STORE_PURCHASE,
      // Progression
      EventBus.Events.LEVEL_UP,
      // Achievements / challenges
      EventBus.Events.ACHIEVEMENT_COMPLETED,
      EventBus.Events.ACHIEVEMENT_CLAIMED,
      EventBus.Events.CHALLENGE_COMPLETED,
      // Retention loop
      EventBus.Events.STREAK_UPDATED,
      EventBus.Events.REWARD_GRANTED
    ];
    return _subscribed;
  }

  // Build a flat, primitive-only metadata object from the EventBus data
  // payload. We strip nested objects (e.g. resolved reward bundles) and
  // the userId (it's stored on the record itself), keeping the event row
  // small and the taxonomy validator happy (it expects scalar values).
  function buildMetadata(eventName: string, data: any): { [k: string]: any } {
    var meta: { [k: string]: any } = {};
    if (!data || typeof data !== "object") {
      return meta;
    }
    for (var key in data) {
      if (key === "userId" || key === "reward") {
        continue;
      }
      var v = data[key];
      var t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") {
        meta[key] = v;
      }
    }

    // Normalize a `revenue` field for the Daily Revenue chart. Real-money
    // IAP store_purchase events carry { iap: true, price }. We surface the
    // numeric price as `revenue` so downstream aggregation has one canonical
    // key regardless of the source event's field name.
    if (eventName === EventBus.Events.STORE_PURCHASE) {
      var price = data.price !== undefined ? data.price : data.priceUsd;
      var n = typeof price === "number" ? price : parseFloat(price);
      if (!isNaN(n) && n > 0) {
        meta.revenue = n;
      }
    }

    return meta;
  }

  function handleEvent(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    ctx: nkruntime.Context,
    eventName: string,
    data: any
  ): void {
    // Need a Nakama user to attribute the event to. captureEvent writes a
    // per-user history keyed by this id, which must be a real Nakama UUID.
    var userId = ctx.userId || (data && typeof data.userId === "string" ? data.userId : "");
    if (!userId) {
      return;
    }

    try {
      SatoriEventCapture.captureEvent(nk, logger, userId, {
        name: eventName,
        timestamp: Date.now(),
        metadata: buildMetadata(eventName, data)
      });
    } catch (err: any) {
      // Never let analytics capture break the gameplay path.
      logger.warn(
        "[SatoriEventBusBridge] capture failed for event=%s user=%s: %s",
        eventName, userId, err && err.message ? err.message : String(err)
      );
    }
  }

  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    var events = subscribed();
    logger.info("[SatoriEventBusBridge] Subscribing Satori capture to %d gameplay events", events.length);

    for (var i = 0; i < events.length; i++) {
      (function (capturedEventName: string) {
        EventBus.on(capturedEventName, function (nk, logger, ctx, data) {
          handleEvent(nk, logger, ctx, capturedEventName, data);
        });
      })(events[i]);
    }

    logger.info("[SatoriEventBusBridge] Registration complete. Satori console now tracks live gameplay.");
  }
}
