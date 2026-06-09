// =============================================================================
// src/games/quizverse/live-banner.ts
// =============================================================================
// RPC: quizverse_live_banner_check
//
// Single authoritative endpoint that Unity calls on every HomeScreen visit.
// Aggregates three event sources (Satori live events, creator live events,
// active tournaments) into ONE banner payload — Unity only needs to check
// `response.data.show` and render the returned fields.
//
// Creator events are resolved from all publish paths (no Unity changes):
//   • `creator_event_publish` → satori_creator_events + events_index
//   • `creator_live_event_publish` / SPA → live_events (system or user-scoped)
//   • Legacy records with startsAt/endsAt on live_events (SYSTEM user)
// Window: scheduledAt + duration (minutes, per creator_event_live) or
//         startsAt/endsAt when present.
//
// Priority order (highest wins when multiple are active simultaneously):
//   1. Active tournament   (competitive, high urgency)
//   2. Creator live event  (curated, time-sensitive)
//   3. Satori live event   (algorithmic / A-B tested)
//
// Per-user server-side 60-second response cache stored in Nakama storage.
// This prevents thundering-herd on HomeScreen open when many users are
// active simultaneously (e.g. right after a push notification blast).
//
// Response shape (LiveBannerPayload):
// {
//   show              : boolean
//   event_id          : string
//   event_type        : "tournament" | "creator" | "satori" | "none"
//   title             : string          — e.g. "🔴 LIVE NOW"
//   subtitle          : string          — e.g. "Weekly Championship · Ends in 2h"
//   cta_text          : string          — "JOIN NOW" | "CONTINUE" | "SET REMINDER"
//   cta_url           : string          — deep link or web URL
//   starts_at         : number          — Unix epoch (sec)
//   ends_at           : number          — Unix epoch (sec)
//   time_remaining_sec: number          — pre-computed for countdown
//   badge             : "hot"|"new"|"ending_soon"|"upcoming"|""
//   has_rewards       : boolean
//   joined            : boolean
//   participant_count : number
//   server_time       : number          — epoch sec; Unity uses for clock sync
// }
// =============================================================================

namespace QuizVerseLiveBanner {

  // ── Tunables ─────────────────────────────────────────────────────────────
  var CACHE_COLLECTION  = "qv_live_banner_cache";
  var CACHE_KEY         = "banner";
  var CACHE_TTL_SEC     = 60;          // 1 min cache per user (hot path dedup)
  var NO_EVENT_TTL_SEC  = 300;         // 5 min cache when show=false (save DB reads)
  // How early an UPCOMING event surfaces on the banner. Set generously so a
  // public event shows as soon as it's published (not just 30 min before start).
  // Change this single number to tighten/widen the horizon (e.g. 1800 = 30 min,
  // 86400 = 1 day, 604800 = 7 days).
  var UPCOMING_WINDOW_SEC = 604800;    // 7 days — event shows right after publish
  var ENDING_SOON_SEC  = 900;          // "Ending soon" badge within 15 min of end
  var LIVE_URL_BASE    = "https://live.quizverse.world/player";
  var QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
  var SYSTEM_USER      = "00000000-0000-0000-0000-000000000000";
  var CREATOR_EVENTS_COLLECTION = "satori_creator_events";
  var CREATOR_EVENTS_INDEX_KEY  = "events_index";
  var LIVE_EVENTS_COLLECTION    = "live_events";

  /**
   * Dev kill-switch — when true, RPC always returns show=false / force_live=false.
   * Flip to false when public live events should drive the home banner.
   */
  var FORCE_LIVE_BANNER_OFF = false;

  function emptyBannerPayload(): any {
    return {
      show: false,
      force_live: false,
      event_id: "",
      event_type: "none",
      title: "",
      subtitle: "",
      cta_text: "",
      cta_url: "",
      starts_at: 0,
      ends_at: 0,
      time_remaining_sec: 0,
      badge: "",
      has_rewards: false,
      joined: false,
      participant_count: 0,
      server_time: Math.floor(Date.now() / 1000)
    };
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  interface CacheEntry {
    payload: any;
    cachedAt: number;
    ttl: number;
  }

  function readCache(nk: nkruntime.Nakama, userId: string): any | null {
    try {
      var rows = nk.storageRead([{ collection: CACHE_COLLECTION, key: CACHE_KEY, userId: userId }]);
      if (!rows || rows.length === 0) return null;
      var entry = rows[0].value as CacheEntry;
      if (!entry || !entry.cachedAt || !entry.ttl) return null;
      var age = Math.floor(Date.now() / 1000) - entry.cachedAt;
      if (age > entry.ttl) return null;
      return entry.payload;
    } catch (_) {
      return null;
    }
  }

  function writeCache(nk: nkruntime.Nakama, userId: string, payload: any, ttl: number): void {
    try {
      var entry: CacheEntry = { payload: payload, cachedAt: Math.floor(Date.now() / 1000), ttl: ttl };
      nk.storageWrite([{
        collection: CACHE_COLLECTION, key: CACHE_KEY, userId: userId,
        value: entry as any,
        permissionRead: 1, permissionWrite: 0
      }]);
    } catch (_) { }
  }

  // ── Badge computation ─────────────────────────────────────────────────────

  function computeBadge(now: number, startsAt: number, endsAt: number, status: string): string {
    if (status === "upcoming") return "upcoming";
    var remaining = endsAt - now;
    if (remaining < ENDING_SOON_SEC) return "ending_soon";
    var age = now - startsAt;
    if (age < 1800) return "new"; // New in last 30 min
    return "hot";
  }

  // ── Human countdown label ─────────────────────────────────────────────────
  // Renders a seconds-until value as a friendly "in 3 days" / "in 5h" / "in 12m"
  // so far-future upcoming events don't show "Starts in 4320 min".
  function formatCountdownLabel(secUntil: number): string {
    var s = Math.max(0, Math.floor(secUntil));
    if (s >= 172800) return Math.floor(s / 86400) + " days";   // 2d+
    if (s >= 86400)  return "1 day";
    if (s >= 3600)   return Math.floor(s / 3600) + "h";
    var m = Math.floor(s / 60);
    return (m < 1 ? 1 : m) + "m";
  }

  // ── Build CTA URL ─────────────────────────────────────────────────────────

  function buildCtaUrl(eventId: string, eventType: string, userId: string, sessionToken: string): string {
    return LIVE_URL_BASE
      + "?event_id=" + encodeURIComponent(eventId)
      + "&event_type=" + encodeURIComponent(eventType)
      + "&user=" + encodeURIComponent(userId)
      + "&mobile=1&view=mobile"
      + "&parent=true"
      + "&return_url=" + encodeURIComponent("quizverse://home");
  }

  // ── Source: Satori live events ────────────────────────────────────────────

  interface SatoriCandidate {
    id: string;
    name: string;
    description: string;
    startsAt: number;
    endsAt: number;
    status: string;
    joined: boolean;
    hasRewards: boolean;
    participantCount: number;
  }

  function fetchSatoriCandidate(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string): SatoriCandidate | null {
    try {
      var configRaw = nk.storageRead([{
        collection: "satori_configs",
        key: gameId + "_live_events",
        userId: SYSTEM_USER
      }]);
      if (!configRaw || configRaw.length === 0) return null;

      var eventDefs: any = configRaw[0].value;
      if (!eventDefs) return null;

      var now = Math.floor(Date.now() / 1000);
      var best: SatoriCandidate | null = null;

      for (var id in eventDefs) {
        if (!Object.prototype.hasOwnProperty.call(eventDefs, id)) continue;
        var def: any = eventDefs[id];
        if (!def || !def.startAt || !def.endAt) continue;

        // Compute effective window (recurrence-aware)
        var startAt = def.startAt as number;
        var endAt = def.endAt as number;
        if (def.recurrenceCron && def.recurrenceIntervalSec) {
          var interval = def.recurrenceIntervalSec as number;
          var duration = endAt - startAt;
          var elapsed = now - startAt;
          if (elapsed >= 0) {
            var cycleIdx = Math.floor(elapsed / interval);
            startAt = startAt + (cycleIdx * interval);
            endAt = startAt + duration;
          }
        }

        // Status
        var status = "";
        if (now < startAt) {
          if (startAt - now > UPCOMING_WINDOW_SEC) continue; // Too far future
          status = "upcoming";
        } else if (now > endAt) {
          continue; // Ended
        } else {
          status = "active";
        }

        // User state
        var joined = false;
        try {
          var stateRows = nk.storageRead([{
            collection: "satori_configs",
            key: gameId + "_live_event_state_" + userId,
            userId: userId
          }]);
          if (stateRows && stateRows.length > 0) {
            var states: any = stateRows[0].value;
            if (states && states.events && states.events[id] && states.events[id].joinedAt) {
              joined = true;
            }
          }
        } catch (_) { }

        if (!best || status === "active") {
          best = {
            id: id,
            name: def.name || "Live Event",
            description: def.description || "",
            startsAt: startAt,
            endsAt: endAt,
            status: status,
            joined: joined,
            hasRewards: !!(def.reward),
            participantCount: 0
          };
          if (status === "active") break; // Prefer first active
        }
      }
      return best;
    } catch (e: any) {
      logger.warn("[LiveBanner] fetchSatoriCandidate error: " + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  // ── Source: Creator live events ───────────────────────────────────────────

  interface CreatorCandidate {
    id: string;
    title: string;
    description: string;
    startsAt: number;
    endsAt: number;
    status: string;
    hasRewards: boolean;
    participantCount: number;
    creatorId: string;
  }

  function numericField(v: any, fallback: number): number {
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      var parsed = parseFloat(v);
      if (!isNaN(parsed)) return parsed;
    }
    return fallback;
  }

  /** Aligns with creator-event-live: duration is minutes unless durationSec is set. */
  function resolveCreatorEventWindow(ev: any): { startAt: number; endAt: number } | null {
    if (!ev) return null;

    var startAt = Math.floor(numericField(ev.startsAt || ev.start_at || ev.scheduledAt || ev.scheduled_at, 0));
    var endAt = Math.floor(numericField(ev.endsAt || ev.end_at, 0));

    if (startAt > 0 && endAt > startAt) {
      return { startAt: startAt, endAt: endAt };
    }
    if (startAt <= 0) return null;

    var durationSec: number;
    if (typeof ev.durationSec === "number") {
      durationSec = Math.max(1, Math.floor(ev.durationSec));
    } else if (typeof ev.duration_seconds === "number") {
      durationSec = Math.max(1, Math.floor(ev.duration_seconds));
    } else {
      var duration = numericField(ev.duration, 30);
      // creator_event_create default: 30 minutes; SPA may send small second values
      if (duration > 0 && duration < 10) {
        durationSec = Math.max(1, Math.floor(duration));
      } else {
        durationSec = Math.max(60, Math.floor(duration * 60));
      }
    }

    return { startAt: startAt, endAt: startAt + durationSec };
  }

  function isBannerEligibleCreatorRecord(ev: any): boolean {
    if (!ev || !ev.id) return false;
    var recordStatus = String(ev.status || "published").toLowerCase();
    if (recordStatus === "draft" || recordStatus === "cancelled" ||
        recordStatus === "distributed" || recordStatus === "funded" ||
        recordStatus === "ended") {
      return false;
    }
    if (ev.visibility && String(ev.visibility).toLowerCase() === "private") {
      return false;
    }
    var gameId = ev.gameId || ev.game_id;
    if (gameId && String(gameId) !== QUIZVERSE_GAME_ID) return false;
    return true;
  }

  function classifyBannerTimeStatus(now: number, startAt: number, endAt: number): string | null {
    if (now < startAt) {
      if (startAt - now > UPCOMING_WINDOW_SEC) return null;
      return "upcoming";
    }
    if (now > endAt) return null;
    return "active";
  }

  function creatorCandidateFromRecord(ev: any, now: number): CreatorCandidate | null {
    if (!isBannerEligibleCreatorRecord(ev)) return null;

    var window = resolveCreatorEventWindow(ev);
    if (!window) return null;

    var timeStatus = classifyBannerTimeStatus(now, window.startAt, window.endAt);
    if (!timeStatus) return null;

    var participantCount = numericField(ev.participantCount || ev.participant_count, 0);
    if (timeStatus === "active" && participantCount === 0 && ev.requiresParticipants) {
      return null;
    }

    return {
      id: String(ev.id),
      title: ev.title || ev.name || "Live Event",
      description: ev.description || "",
      startsAt: window.startAt,
      endsAt: window.endAt,
      status: timeStatus,
      hasRewards: !!(
        ev.prizePool || ev.prize_pool ||
        (ev.prizes && ev.prizes.length) ||
        ev.giftCardPrizes || ev.gift_card_prizes ||
        ev.reward || ev.prize
      ),
      participantCount: participantCount,
      creatorId: ev.creatorId || ev.creator_id || ""
    };
  }

  function pickBestCreatorCandidate(candidates: CreatorCandidate[]): CreatorCandidate | null {
    var best: CreatorCandidate | null = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      if (!best || c.status === "active") {
        best = c;
        if (c.status === "active") break;
      }
    }
    return best;
  }

  function collectLiveEventsFromStorageList(
    nk: nkruntime.Nakama,
    userId: string,
    maxPages: number,
    seen: { [id: string]: boolean },
    out: any[]
  ): void {
    var cursor = "";
    for (var page = 0; page < maxPages; page++) {
      var result = nk.storageList(userId, LIVE_EVENTS_COLLECTION, 50, cursor);
      var objects = (result && result.objects) ? result.objects : [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj || !obj.value || !obj.value.id) continue;
        var id = String(obj.value.id);
        if (seen[id]) continue;
        seen[id] = true;
        out.push(obj.value);
      }
      cursor = (result && result.cursor) ? result.cursor : "";
      if (!cursor) break;
    }
  }

  function collectSatoriCreatorEvents(nk: nkruntime.Nakama, seen: { [id: string]: boolean }, out: any[]): void {
    var index = Storage.readSystemJson<{ eventIds: string[] }>(
      nk, CREATOR_EVENTS_COLLECTION, CREATOR_EVENTS_INDEX_KEY
    );
    if (!index || !index.eventIds || index.eventIds.length === 0) return;

    for (var i = 0; i < index.eventIds.length; i++) {
      var eventId = index.eventIds[i];
      if (!eventId || seen[eventId]) continue;
      var def = Storage.readSystemJson<any>(nk, CREATOR_EVENTS_COLLECTION, eventId);
      if (!def || !def.id) continue;
      seen[String(def.id)] = true;
      out.push(def);
    }
  }

  function fetchCreatorCandidate(nk: nkruntime.Nakama, logger: nkruntime.Logger): CreatorCandidate | null {
    try {
      var now = Math.floor(Date.now() / 1000);
      var seen: { [id: string]: boolean } = {};
      var records: any[] = [];

      // 1) creator_event_publish — satori_creator_events (system index)
      collectSatoriCreatorEvents(nk, seen, records);

      // 2) creator_live_event_publish — live_events under SYSTEM
      collectLiveEventsFromStorageList(nk, SYSTEM_USER, 2, seen, records);

      // 3) SPA direct PUT — user-scoped live_events (public read)
      collectLiveEventsFromStorageList(nk, "", 3, seen, records);

      var candidates: CreatorCandidate[] = [];
      for (var r = 0; r < records.length; r++) {
        var candidate = creatorCandidateFromRecord(records[r], now);
        if (candidate) candidates.push(candidate);
      }

      return pickBestCreatorCandidate(candidates);
    } catch (e: any) {
      logger.warn("[LiveBanner] fetchCreatorCandidate error: " + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  // ── Source: Active tournament ─────────────────────────────────────────────

  interface TournamentCandidate {
    id: string;
    title: string;
    description: string;
    startsAt: number;
    endsAt: number;
    status: string;
    hasRewards: boolean;
    participantCount: number;
  }

  function fetchTournamentCandidate(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): TournamentCandidate | null {
    try {
      var now = Math.floor(Date.now() / 1000);

      // Read active tournament list from storage (persisted by tournament module)
      var page = nk.storageList(SYSTEM_USER, "active_tournaments", 10, "");
      if (!page || !page.objects || page.objects.length === 0) return null;

      var best: TournamentCandidate | null = null;
      for (var i = 0; i < page.objects.length; i++) {
        var t: any = page.objects[i].value;
        if (!t || !t.id || !t.startAt || !t.endAt) continue;

        var startAt = t.startAt as number;
        var endAt = t.endAt as number;
        var status = "";

        if (now < startAt) {
          if (startAt - now > UPCOMING_WINDOW_SEC) continue;
          status = "upcoming";
        } else if (now > endAt) {
          continue;
        } else {
          status = "active";
        }

        if (!best || status === "active") {
          best = {
            id: t.id,
            title: t.title || t.name || "Live Tournament",
            description: t.description || "",
            startsAt: startAt,
            endsAt: endAt,
            status: status,
            hasRewards: true, // Tournaments always have prizes
            participantCount: t.participantCount || 0
          };
          if (status === "active") break;
        }
      }
      return best;
    } catch (e: any) {
      logger.warn("[LiveBanner] fetchTournamentCandidate error: " + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  // ── Banner assembly ───────────────────────────────────────────────────────

  function buildBannerPayload(
    eventId: string,
    eventType: string,
    title: string,
    description: string,
    startsAt: number,
    endsAt: number,
    status: string,
    joined: boolean,
    hasRewards: boolean,
    participantCount: number,
    userId: string
  ): any {
    var now = Math.floor(Date.now() / 1000);
    var timeRemaining = Math.max(0, endsAt - now);
    var badge = computeBadge(now, startsAt, endsAt, status);

    var ctaText = "JOIN NOW";
    if (status === "upcoming") ctaText = "SET REMINDER";
    else if (joined) ctaText = "CONTINUE";

    // Build human subtitle
    var subtitle = description || title;
    if (status === "upcoming") {
      subtitle = "Starts in " + formatCountdownLabel(startsAt - now) + " · " + title;
    } else if (timeRemaining < 3600) {
      var minsLeft = Math.floor(timeRemaining / 60);
      subtitle = title + " · Ends in " + minsLeft + "m";
    } else {
      var hoursLeft = Math.floor(timeRemaining / 3600);
      subtitle = title + " · Ends in " + hoursLeft + "h";
    }

    var ctaUrl = buildCtaUrl(eventId, eventType, userId, "");

    return {
      show: true,
      // Unity ignores this today; signals "must show" while the event is in the live window.
      force_live: status === "active",
      event_id: eventId,
      event_type: eventType,
      title: status === "upcoming" ? "⏰ UPCOMING" : "🔴 LIVE NOW",
      subtitle: subtitle,
      cta_text: ctaText,
      cta_url: ctaUrl,
      starts_at: startsAt,
      ends_at: endsAt,
      time_remaining_sec: timeRemaining,
      badge: badge,
      has_rewards: hasRewards,
      joined: joined,
      participant_count: participantCount,
      server_time: now
    };
  }

  /**
   * True when any source currently has a banner-worthy event — either live
   * right now OR upcoming within UPCOMING_WINDOW_SEC. Used to bust a stale
   * `show=false` cache so a freshly-started (or about-to-start) public event
   * surfaces without waiting out the no-event TTL.
   */
  function hasShowableEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string): boolean {
    var tournament = fetchTournamentCandidate(nk, logger, userId);
    if (tournament) return true; // fetch* only return active/upcoming candidates
    var creator = fetchCreatorCandidate(nk, logger);
    if (creator) return true;
    var satori = fetchSatoriCandidate(nk, logger, userId, gameId);
    if (satori) return true;
    return false;
  }

  // ── Diagnostics (debug=true) ──────────────────────────────────────────────
  // Explains, per creator record, why it was accepted or rejected as a banner
  // candidate. This is the fast path to answer "why isn't my public event
  // showing?" without DB access — it mirrors the exact filters the hot path uses.

  interface CreatorRecordDiagnostic {
    id: string;
    eligible: boolean;
    reason: string;
    status?: string;
    visibility?: string;
    game_id?: string;
    starts_at?: number;
    ends_at?: number;
  }

  function creatorRecordDiagnostic(ev: any, now: number): CreatorRecordDiagnostic {
    var id = (ev && ev.id) ? String(ev.id) : "(no id)";
    if (!ev || !ev.id) {
      return { id: id, eligible: false, reason: "record has no id" };
    }

    var status = String(ev.status || "published").toLowerCase();
    var visibility = ev.visibility ? String(ev.visibility).toLowerCase() : "(unset → treated as public)";
    var gameId = ev.gameId || ev.game_id || "";

    if (status === "draft" || status === "cancelled" ||
        status === "distributed" || status === "funded" || status === "ended") {
      return { id: id, eligible: false, reason: "status=" + status + " is not bannerable", status: status };
    }
    if (ev.visibility && String(ev.visibility).toLowerCase() === "private") {
      return { id: id, eligible: false, reason: "visibility is private", status: status, visibility: visibility };
    }
    if (gameId && String(gameId) !== QUIZVERSE_GAME_ID) {
      return {
        id: id, eligible: false,
        reason: "gameId " + gameId + " != QuizVerse (" + QUIZVERSE_GAME_ID + ")",
        status: status, visibility: visibility, game_id: String(gameId)
      };
    }

    var window = resolveCreatorEventWindow(ev);
    if (!window) {
      return { id: id, eligible: false, reason: "no valid start time / duration", status: status, visibility: visibility };
    }

    var timeStatus = classifyBannerTimeStatus(now, window.startAt, window.endAt);
    if (!timeStatus) {
      var reason = (now > window.endAt)
        ? "ended " + (now - window.endAt) + "s ago"
        : "starts in " + (window.startAt - now) + "s (beyond the " + UPCOMING_WINDOW_SEC + "s upcoming window)";
      return {
        id: id, eligible: false, reason: reason,
        status: status, visibility: visibility,
        starts_at: window.startAt, ends_at: window.endAt
      };
    }

    return {
      id: id, eligible: true, reason: timeStatus,
      status: status, visibility: visibility,
      starts_at: window.startAt, ends_at: window.endAt
    };
  }

  function buildDiagnostics(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string): any {
    var now = Math.floor(Date.now() / 1000);
    var seen: { [id: string]: boolean } = {};
    var records: any[] = [];
    collectSatoriCreatorEvents(nk, seen, records);
    collectLiveEventsFromStorageList(nk, SYSTEM_USER, 2, seen, records);
    collectLiveEventsFromStorageList(nk, "", 3, seen, records);

    var creatorDiags: CreatorRecordDiagnostic[] = [];
    var eligibleCount = 0;
    for (var i = 0; i < records.length; i++) {
      var d = creatorRecordDiagnostic(records[i], now);
      if (d.eligible) eligibleCount++;
      creatorDiags.push(d);
    }

    var tournament = fetchTournamentCandidate(nk, logger, userId);
    var satori = fetchSatoriCandidate(nk, logger, userId, gameId);

    return {
      server_time: now,
      quizverse_game_id: QUIZVERSE_GAME_ID,
      force_live_banner_off: FORCE_LIVE_BANNER_OFF,
      tournament_candidate: tournament ? { id: tournament.id, status: tournament.status } : null,
      satori_candidate: satori ? { id: satori.id, status: satori.status } : null,
      creator_records_scanned: records.length,
      creator_records_eligible: eligibleCount,
      creator_records: creatorDiags
    };
  }

  function refreshCachedPayloadTimes(cached: any): void {
    if (!cached || !cached.show || !cached.ends_at) return;
    var nowSec = Math.floor(Date.now() / 1000);
    cached.time_remaining_sec = Math.max(0, cached.ends_at - nowSec);
    cached.server_time = nowSec;
    if (nowSec > cached.ends_at) {
      cached.show = false;
      cached.event_type = "none";
      cached.force_live = false;
      return;
    }
    // Re-assert live force while still inside the window (Unity only reads show today).
    if (nowSec >= (cached.starts_at || 0) && cached.badge !== "upcoming") {
      cached.force_live = true;
      cached.show = true;
    }
  }

  // ── RPC Handler ───────────────────────────────────────────────────────────

  function rpcLiveBannerCheck(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = (data && data.game_id) ? String(data.game_id) : QUIZVERSE_GAME_ID;
    var debug = !!(data && data.debug);
    // Debug calls always bypass the cache so diagnostics reflect live storage.
    var forceRefresh = !!(data && data.force_refresh) || debug;

    if (FORCE_LIVE_BANNER_OFF) {
      var disabledPayload = emptyBannerPayload();
      if (debug) {
        disabledPayload.diagnostics = buildDiagnostics(nk, logger, userId, gameId);
        logger.info("[LiveBanner] user=" + userId + " FORCE_LIVE_BANNER_OFF (debug) — kill-switch is ON, banner suppressed");
        return RpcHelpers.successResponse(disabledPayload);
      }
      writeCache(nk, userId, disabledPayload, NO_EVENT_TTL_SEC);
      logger.info("[LiveBanner] user=" + userId + " FORCE_LIVE_BANNER_OFF — show=false force_live=false");
      return RpcHelpers.successResponse(disabledPayload);
    }

    // ── Serve from cache (skip RPC work on hot path) ──────────────────────
    if (!forceRefresh) {
      var cached = readCache(nk, userId);
      if (cached !== null) {
        // Stale no-banner cache: if an event is now live OR upcoming after we
        // cached false, rebuild immediately instead of waiting out the TTL.
        if (!cached.show && hasShowableEvent(nk, logger, userId, gameId)) {
          logger.info("[LiveBanner] user=" + userId + " busting show=false cache — showable event present");
          cached = null;
        } else {
          refreshCachedPayloadTimes(cached);
          return RpcHelpers.successResponse(cached);
        }
      }
    }

    // ── Fetch all three sources in priority order ──────────────────────────
    // Tournament → highest urgency
    var tournament = fetchTournamentCandidate(nk, logger, userId);
    // Creator event → curated
    var creator = fetchCreatorCandidate(nk, logger);
    // Satori event → algorithmic / audience-filtered
    var satori = fetchSatoriCandidate(nk, logger, userId, gameId);

    var bannerPayload: any;
    var cacheTtl = NO_EVENT_TTL_SEC;

    if (tournament) {
      bannerPayload = buildBannerPayload(
        tournament.id, "tournament",
        tournament.title, tournament.description,
        tournament.startsAt, tournament.endsAt, tournament.status,
        false, tournament.hasRewards, tournament.participantCount, userId
      );
      cacheTtl = CACHE_TTL_SEC;
    } else if (creator) {
      bannerPayload = buildBannerPayload(
        creator.id, "creator",
        creator.title, creator.description,
        creator.startsAt, creator.endsAt, creator.status,
        false, creator.hasRewards, creator.participantCount, userId
      );
      cacheTtl = CACHE_TTL_SEC;
    } else if (satori) {
      bannerPayload = buildBannerPayload(
        satori.id, "satori",
        satori.name, satori.description,
        satori.startsAt, satori.endsAt, satori.status,
        satori.joined, satori.hasRewards, satori.participantCount, userId
      );
      cacheTtl = CACHE_TTL_SEC;
    } else {
      // Nothing active or upcoming — hide banner
      bannerPayload = {
        show: false,
        force_live: false,
        event_id: "",
        event_type: "none",
        title: "",
        subtitle: "",
        cta_text: "",
        cta_url: "",
        starts_at: 0,
        ends_at: 0,
        time_remaining_sec: 0,
        badge: "",
        has_rewards: false,
        joined: false,
        participant_count: 0,
        server_time: Math.floor(Date.now() / 1000)
      };
      cacheTtl = NO_EVENT_TTL_SEC;
    }

    if (debug) {
      // Don't cache debug results; return diagnostics alongside the real payload.
      bannerPayload.diagnostics = buildDiagnostics(nk, logger, userId, gameId);
      logger.info("[LiveBanner] user=" + userId + " (debug) show=" + bannerPayload.show + " type=" + bannerPayload.event_type + " creator_scanned=" + bannerPayload.diagnostics.creator_records_scanned + " eligible=" + bannerPayload.diagnostics.creator_records_eligible);
      return RpcHelpers.successResponse(bannerPayload);
    }

    writeCache(nk, userId, bannerPayload, cacheTtl);
    logger.info("[LiveBanner] user=" + userId + " show=" + bannerPayload.show + " force_live=" + !!bannerPayload.force_live + " type=" + bannerPayload.event_type);
    return RpcHelpers.successResponse(bannerPayload);
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_live_banner_check", rpcLiveBannerCheck);
  }
}
