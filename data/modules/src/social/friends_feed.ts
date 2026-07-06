// friends_feed.ts — Gizmo-style friends activity feed (doc §14A).
//
// "Without this, the Social Zone answers 'who are my friends?'
//  With this, it answers 'what did my friends DO today — and can I beat them?'"
//
// RPCs:
//   ivx_social_friends_feed      — merged, time-sorted stream of friends' events
//   ivx_social_feed_privacy_set  — per-user control of what their friends see
//   ivx_social_feed_privacy_get  — read own settings (settings UI needs it)
//
// WRITER (internal, not an RPC): SocialFriendsFeed.writeEvent(...) — called
// by game flows (quizverse submit_result hooks quiz_completed; other emitters
// opt in the same way). Deliberate separation of concerns per §14A.6: the
// social layer renders the feed, game layers decide what is feed-worthy.
//
// STORAGE  (all corrections from the 2026-07-06 architecture pass applied)
//   ivx_friends_feed_events / {gameId}_{authorId}_{eventId}   owner = author
//     permissionRead: 1  (C-002: owner-only — public read would let ANY
//     client bypass both the friend check and privacy settings; this RPC
//     reads with server privileges so owner-read is sufficient)
//     expiresAt field + maintenance-tick sweep (C-001: Nakama has NO native
//     TTL; retention = 7 days via ivx_social_maintenance_tick)
//   ivx_user_settings / feed_privacy                          owner = user
//
// READ PATH (C-003): ONE SQL query over the storage table with a generated
// IN-list — NOT per-friend storageList calls (50 sequential round-trips
// would blow the 300ms budget). Ordered by the indexed create_time column
// (feed events are immutable, so create_time == occurredAt ordering).

namespace SocialFriendsFeed {

  var EVENTS_COLLECTION   = "ivx_friends_feed_events";
  var SETTINGS_COLLECTION = "ivx_user_settings";
  var SETTINGS_KEY        = "feed_privacy";
  var RETENTION_DAYS      = 7;
  var MAX_FRIENDS_SCANNED = 100;   // newest-relationship first beyond this
  var MAX_LIMIT           = 50;

  var STATE_FRIEND = 0;

  // Event types the feed understands. displayText templates are rendered
  // SERVER-side (§14A.5) so all clients show identical copy.
  var EVENT_TYPES: { [t: string]: boolean } = {
    "quiz_completed": true, "challenge_won": true, "streak_milestone": true,
    "group_joined": true, "group_level_up": true, "badge_earned": true,
    "friend_joined": true, "challenge_sent": true
  };

  // Which privacy toggle gates each event type.
  var TYPE_TO_PRIVACY_FIELD: { [t: string]: string } = {
    "quiz_completed":   "shareQuizScores",
    "challenge_won":    "shareQuizScores",
    "challenge_sent":   "shareQuizScores",
    "streak_milestone": "shareStreakMilestones",
    "badge_earned":     "shareBadges",
    "group_joined":     "shareFeedEvents",
    "group_level_up":   "shareFeedEvents",
    "friend_joined":    "shareFeedEvents"
  };

  var DEFAULT_PRIVACY = {
    shareFeedEvents:       true,
    shareQuizScores:       true,
    shareStreakMilestones: true,
    shareBadges:           true
  };

  // ── Internal writer — call from game flows, never throws ─────────────────
  export function writeEvent(
    nk: nkruntime.Nakama, logger: nkruntime.Logger,
    authorId: string, authorName: string, gameId: string,
    eventType: string, eventData: any,
    cta?: { type: string; label: string; payload: any }
  ): void {
    try {
      if (!authorId || !EVENT_TYPES[eventType]) return;
      var nowMs = Date.now();
      var eventId = "evt_" + nowMs.toString(36) + "_" + Math.floor(Math.random() * 1679616).toString(36);
      nk.storageWrite([{
        collection: EVENTS_COLLECTION,
        key:        gameId + "_" + authorId + "_" + eventId,
        userId:     authorId,
        value: {
          eventId:    eventId,
          eventType:  eventType,
          gameId:     gameId,
          authorId:   authorId,
          authorName: authorName || "",
          occurredAt: new Date(nowMs).toISOString(),
          expiresAt:  new Date(nowMs + RETENTION_DAYS * 86400000).toISOString(),
          data:       eventData || {},
          ctaType:    cta ? cta.type : "",
          ctaLabel:   cta ? cta.label : "",
          ctaPayload: cta ? cta.payload : null
        },
        permissionRead:  1,  // C-002: owner-only; served via this RPC only
        permissionWrite: 0
      }]);
    } catch (e: any) {
      if (logger && logger.warn) logger.warn("[FriendsFeed] writeEvent failed (non-fatal): " + (e && e.message));
    }
  }

  // ── Server-side display text (§14A.5) ─────────────────────────────────────
  function renderDisplayText(ev: any): string {
    var name = ev.authorName || "A friend";
    var d = ev.data || {};
    switch (ev.eventType) {
      case "quiz_completed":
        return name + " scored " + (d.score !== undefined ? d.score : "?") +
               (d.quizTitle ? " in " + d.quizTitle : (d.topic ? " in " + d.topic : ""));
      case "challenge_won":
        return name + " won a challenge" + (d.opponentName ? " against " + d.opponentName : "");
      case "challenge_sent":
        return name + " sent a challenge" + (d.targetScore ? " — beat " + d.targetScore + "!" : "");
      case "streak_milestone":
        return name + " hit a " + (d.days || "?") + "-day streak 🔥";
      case "group_joined":
        return name + " joined " + (d.groupName || "a group");
      case "group_level_up":
        return (d.groupName || "Your group") + " reached Level " + (d.level || "?") + "! 🎉";
      case "badge_earned":
        return name + " earned the " + (d.badgeName || "a") + " badge 🏅";
      case "friend_joined":
        return name + " just joined QuizVerse";
      default:
        return name + " did something awesome";
    }
  }

  function timeAgo(iso: string): string {
    var t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " minutes ago";
    if (s < 86400) return Math.floor(s / 3600) + " hours ago";
    return Math.floor(s / 86400) + " days ago";
  }

  function loadPrivacyFor(nk: nkruntime.Nakama, userIds: string[]): { [id: string]: any } {
    var out: { [id: string]: any } = {};
    if (!userIds || userIds.length === 0) return out;
    var reads: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < userIds.length; i++) {
      reads.push({ collection: SETTINGS_COLLECTION, key: SETTINGS_KEY, userId: userIds[i] });
    }
    try {
      var rows = nk.storageRead(reads);
      if (rows) {
        for (var r = 0; r < rows.length; r++) {
          if (rows[r] && rows[r].value && rows[r].userId) out[rows[r].userId] = rows[r].value;
        }
      }
    } catch (_) { /* defaults apply */ }
    return out;
  }

  function allows(privacy: any, eventType: string): boolean {
    var p = privacy || DEFAULT_PRIVACY;
    if (p.shareFeedEvents === false) return false; // global kill switch
    var field = TYPE_TO_PRIVACY_FIELD[eventType] || "shareFeedEvents";
    return p[field] !== false;
  }

  // ── RPC: ivx_social_friends_feed ──────────────────────────────────────────
  // Payload: { gameId?, limit?, cursor?, eventTypes?: string[] }
  function rpcFriendsFeed(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";
      var limit = (typeof data.limit === "number" && data.limit > 0) ? Math.min(Math.floor(data.limit), MAX_LIMIT) : 20;

      var typeFilter: { [t: string]: boolean } | null = null;
      if (data.eventTypes && Object.prototype.toString.call(data.eventTypes) === "[object Array]" && data.eventTypes.length > 0) {
        typeFilter = {};
        for (var tf = 0; tf < data.eventTypes.length; tf++) {
          if (typeof data.eventTypes[tf] === "string") typeFilter[data.eventTypes[tf]] = true;
        }
      }

      // 1. Confirmed friends (state=0), capped.
      var friendIds: string[] = [];
      try {
        var page = nk.friendsList(userId, 1000, STATE_FRIEND, null as any);
        if (page && page.friends) {
          for (var f = 0; f < page.friends.length && friendIds.length < MAX_FRIENDS_SCANNED; f++) {
            var fr: any = page.friends[f];
            if (fr && fr.user && fr.user.id) friendIds.push(fr.user.id);
          }
        }
      } catch (fe: any) {
        logger.warn("[FriendsFeed] friendsList failed: " + (fe && fe.message));
      }
      if (friendIds.length === 0) {
        return RpcHelpers.successResponse({ events: [], count: 0, nextCursor: "", emptyReason: "no_friends" });
      }

      // 2. ONE SQL query (C-003). Generated IN-list placeholders — the JS
      // runtime's sqlQuery does not take array parameters.
      var params: any[] = [EVENTS_COLLECTION];
      var placeholders: string[] = [];
      for (var p = 0; p < friendIds.length; p++) {
        params.push(friendIds[p]);
        placeholders.push("$" + (params.length));
      }
      params.push(gameId);
      var gameParam = "$" + params.length;
      var cursorClause = "";
      if (typeof data.cursor === "string" && data.cursor) {
        var cur = Date.parse(data.cursor);
        if (!isNaN(cur)) {
          params.push(new Date(cur).toISOString());
          cursorClause = " AND create_time < $" + params.length;
        }
      }
      params.push(limit + 1);
      var limitParam = "$" + params.length;

      var rows: any[] = [];
      try {
        rows = nk.sqlQuery(
          "SELECT value, create_time FROM storage " +
          "WHERE collection = " + "$1" +
          "  AND user_id IN (" + placeholders.join(",") + ") " +
          "  AND (value->>'gameId') = " + gameParam +
          cursorClause + " " +
          "ORDER BY create_time DESC " +
          "LIMIT " + limitParam,
          params
        ) as any[];
      } catch (sqlErr: any) {
        logger.error("[FriendsFeed] SQL failed: " + (sqlErr && sqlErr.message));
        return RpcHelpers.errorResponse("Feed unavailable — try again");
      }
      if (!rows) rows = [];
      var hasMore = rows.length > limit;
      if (hasMore) rows = rows.slice(0, limit);

      // 3. Author privacy (one batched read for distinct authors on this page).
      var authorSet: { [id: string]: boolean } = {};
      var parsed: any[] = [];
      for (var i = 0; i < rows.length; i++) {
        var v: any = rows[i] && rows[i].value;
        if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = null; } }
        if (!v || !v.authorId) continue;
        v.__createTime = rows[i].create_time;
        parsed.push(v);
        authorSet[v.authorId] = true;
      }
      var authors: string[] = [];
      for (var ak in authorSet) {
        if (Object.prototype.hasOwnProperty.call(authorSet, ak)) authors.push(ak);
      }
      var privacyById = loadPrivacyFor(nk, authors);

      // 4. Filter + render.
      var events: any[] = [];
      var lastCreate = "";
      for (var e = 0; e < parsed.length; e++) {
        var ev = parsed[e];
        lastCreate = ev.__createTime || lastCreate;
        if (ev.expiresAt && Date.parse(ev.expiresAt) < Date.now()) continue; // belt-and-braces vs sweep lag
        if (typeFilter && !typeFilter[ev.eventType]) continue;
        if (!allows(privacyById[ev.authorId], ev.eventType)) continue;
        events.push({
          eventId:     ev.eventId,
          eventType:   ev.eventType,
          authorId:    ev.authorId,
          authorName:  ev.authorName || "",
          occurredAt:  ev.occurredAt,
          timeAgo:     timeAgo(ev.occurredAt),
          displayText: renderDisplayText(ev),
          data:        ev.data || {},
          cta: ev.ctaType ? { type: ev.ctaType, label: ev.ctaLabel || "", payload: ev.ctaPayload || null } : null
        });
      }

      return RpcHelpers.successResponse({
        events:     events,
        count:      events.length,
        nextCursor: hasMore && lastCreate ? String(lastCreate) : ""
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse((err && err.message) || "Failed to load feed");
    }
  }

  // ── RPC: ivx_social_feed_privacy_set / _get ───────────────────────────────
  function rpcPrivacySet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var incoming = data.settings || data; // accept flat or wrapped

      // Merge over current (or defaults) — partial updates allowed.
      var current: any = null;
      try {
        var rows = nk.storageRead([{ collection: SETTINGS_COLLECTION, key: SETTINGS_KEY, userId: userId }]);
        if (rows && rows.length > 0 && rows[0] && rows[0].value) current = rows[0].value;
      } catch (_) {}
      var merged: any = {};
      for (var dk in DEFAULT_PRIVACY) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_PRIVACY, dk)) continue;
        if (incoming[dk] !== undefined) merged[dk] = incoming[dk] === true;
        else if (current && current[dk] !== undefined) merged[dk] = current[dk] === true;
        else merged[dk] = (DEFAULT_PRIVACY as any)[dk];
      }
      merged.updatedAt = new Date().toISOString();

      nk.storageWrite([{
        collection: SETTINGS_COLLECTION, key: SETTINGS_KEY, userId: userId,
        value: merged, permissionRead: 1, permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ settings: merged });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to save feed privacy");
    }
  }

  function rpcPrivacyGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var settings: any = DEFAULT_PRIVACY;
      try {
        var rows = nk.storageRead([{ collection: SETTINGS_COLLECTION, key: SETTINGS_KEY, userId: userId }]);
        if (rows && rows.length > 0 && rows[0] && rows[0].value) settings = rows[0].value;
      } catch (_) {}
      return RpcHelpers.successResponse({ settings: settings });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to read feed privacy");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_friends_feed", rpcFriendsFeed);
    initializer.registerRpc("ivx_social_feed_privacy_set", rpcPrivacySet);
    initializer.registerRpc("ivx_social_feed_privacy_get", rpcPrivacyGet);
  }
}
