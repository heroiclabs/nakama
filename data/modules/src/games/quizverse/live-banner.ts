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
  var UPCOMING_WINDOW_SEC = 1800;      // Show "upcoming" banner 30 min before start
  var ENDING_SOON_SEC  = 900;          // "Ending soon" badge within 15 min of end
  var LIVE_URL_BASE    = "https://live.quizverse.world/player";
  var QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
  var SYSTEM_USER      = "00000000-0000-0000-0000-000000000000";

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

  function fetchCreatorCandidate(nk: nkruntime.Nakama, logger: nkruntime.Logger): CreatorCandidate | null {
    try {
      var page = nk.storageList(SYSTEM_USER, "live_events", 20, "");
      if (!page || !page.objects || page.objects.length === 0) return null;

      var now = Math.floor(Date.now() / 1000);
      var best: CreatorCandidate | null = null;

      for (var i = 0; i < page.objects.length; i++) {
        var ev: any = page.objects[i].value;
        if (!ev || !ev.id || !ev.startsAt || !ev.endsAt) continue;

        var startAt = ev.startsAt as number;
        var endAt = ev.endsAt as number;

        var status = "";
        if (now < startAt) {
          if (startAt - now > UPCOMING_WINDOW_SEC) continue;
          status = "upcoming";
        } else if (now > endAt) {
          continue;
        } else {
          status = "active";
        }

        // Skip events with 0 or no participant data (ghost events)
        var participantCount = ev.participantCount || ev.participant_count || 0;
        if (status === "active" && participantCount === 0 && ev.requiresParticipants) continue;

        if (!best || status === "active") {
          best = {
            id: ev.id,
            title: ev.title || ev.name || "Live Event",
            description: ev.description || "",
            startsAt: startAt,
            endsAt: endAt,
            status: status,
            hasRewards: !!(ev.reward || ev.prize),
            participantCount: participantCount,
            creatorId: ev.creatorId || ""
          };
          if (status === "active") break;
        }
      }
      return best;
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
      var minUntil = Math.floor((startsAt - now) / 60);
      subtitle = "Starts in " + minUntil + " min · " + title;
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
    var forceRefresh = !!(data && data.force_refresh);

    // ── Serve from cache (skip RPC work on hot path) ──────────────────────
    if (!forceRefresh) {
      var cached = readCache(nk, userId);
      if (cached !== null) {
        // Recalculate time_remaining_sec from live clock even when cached,
        // so Unity always gets an accurate countdown without a fresh RPC.
        if (cached.show && cached.ends_at) {
          var nowSec = Math.floor(Date.now() / 1000);
          cached.time_remaining_sec = Math.max(0, cached.ends_at - nowSec);
          cached.server_time = nowSec;
          // Auto-hide if the cached event has ended since we last wrote cache
          if (nowSec > cached.ends_at) {
            cached.show = false;
            cached.event_type = "none";
          }
        }
        return RpcHelpers.successResponse(cached);
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

    writeCache(nk, userId, bannerPayload, cacheTtl);
    logger.info("[LiveBanner] user=" + userId + " show=" + bannerPayload.show + " type=" + bannerPayload.event_type);
    return RpcHelpers.successResponse(bannerPayload);
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_live_banner_check", rpcLiveBannerCheck);
  }
}
