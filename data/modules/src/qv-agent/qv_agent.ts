// qv_agent.ts
// ─────────────────────────────────────────────────────────────────────────────
// QuizVerse Agent runtime — Phase A tool surface for the omnichannel
// conversational agent.
//
// This module is the Nakama half of the "Learners Brain MCP" architecture
// tracked in:
//   - intelli-verse-x/Quizverse-web-frontend#81 (Conversational AI omnichannel)
//   - intelli-verse-x/Quizverse-web-frontend#82 (Learners Brain MCP, later phase)
//
// The Intelliverse-X-AI gateway calls these RPCs over HTTP using the standard
// http_key admin auth (no per-user Nakama session — the gateway acts on behalf
// of the authenticated user, identified by cognito_sub passed in the payload).
// This mirrors the pattern in src/wow/wow_moments.ts where service callers
// supply a `service_token` + `user_id` in the RPC payload.
//
// RPCs registered (7)
// -------------------
//   qv_agent_memory_write              service-only — append to user memory ring
//   qv_agent_memory_read               service-only — read last N memory entries
//   qv_agent_get_my_rank               service-only — rank + percentile from leaderboard_global
//   qv_agent_global_leaderboard_top10  anonymous-OK — top-10 read for marketing surfaces
//   qv_agent_analyze_quiz_performance  service-only — weak/strong topics + predicted score
//   qv_agent_generate_trivia           anonymous-OK — sample question (v1: in-module catalog)
//   qv_agent_ping                      no-auth     — liveness check for gateway → Nakama wiring
//
// Auth model
// ----------
// All "service-only" RPCs accept TWO equivalent paths:
//   (a) the caller IS the user — `ctx.userId` is set by Nakama auth middleware
//   (b) the caller is the gateway — `service_token` in payload matches
//       ctx.env["QV_AGENT_SERVICE_TOKEN"], AND `user_id` is supplied in payload
//
// http_key calls (which the gateway uses today via NakamaRpcClient) have empty
// ctx.userId, so the gateway MUST always pass `service_token` + `user_id`.
//
// Storage shape
// -------------
//   collection: "qv_agent_memory"
//   key:        "ring"                  // single ring buffer per user
//   userId:     <cognito_sub>
//   value:      { entries: MemoryEntry[]; updated_unix: number }
//   permissionRead/Write: 0 (server-only — never readable from client)
//
// Cap: last 50 entries per user (oldest dropped on append). Each entry capped
// at 4 KB of content; oversized writes are rejected with 413.
//
// Cross-references
// ----------------
//   src/wow/wow_moments.ts             (auth & analytics conventions)
//   src/shared/rpc-helpers.ts          (response shapes)
//   src/legacy/leaderboards.ts         (leaderboard_global is the read target)
//   src/games/quizverse/               (in-game scoring feeds leaderboard_global)
//   docs/qv-agent/README.md            (RPC contract — coming in PR-A4)

namespace QvAgent {

  // ── Constants ──────────────────────────────────────────────────────────────
  var MEMORY_COLLECTION = "qv_agent_memory";
  var MEMORY_KEY = "ring";
  var MAX_MEMORY_ENTRIES = 50;
  var MAX_CONTENT_BYTES = 4096;
  var ANALYTICS_GAME_ID = "quizverse";
  var GLOBAL_LEADERBOARD_ID = "leaderboard_global";

  // ── Types ──────────────────────────────────────────────────────────────────
  interface MemoryEntry {
    ts: number;
    role: string;     // "user" | "assistant" | "tool" | "system"
    content: string;
    trace_id: string;
    tags: string[];   // free-form, e.g. ["sat_practice", "weak_topic:photosynthesis"]
  }

  interface MemoryDoc {
    entries: MemoryEntry[];
    updated_unix: number;
  }

  interface TriviaSample {
    topic: string;
    difficulty: string;  // "easy" | "medium" | "hard"
    question: string;
    choices: string[];
    correct_index: number;
    explanation: string;
  }

  // ── In-module trivia catalog (v1 fallback) ─────────────────────────────────
  // PR-A3 ships with a small hand-curated catalog so the gateway can wire up
  // `generate_trivia` end-to-end. PR-A6 (later) swaps this for a content-factory
  // call so we get fresh, locale-aware questions on demand.
  var TRIVIA_CATALOG: TriviaSample[] = [
    {
      topic: "sat_math",
      difficulty: "easy",
      question: "If 3x + 5 = 20, what is x?",
      choices: ["3", "5", "15", "25"],
      correct_index: 1,
      explanation: "Subtract 5 from both sides: 3x = 15. Then divide by 3: x = 5.",
    },
    {
      topic: "sat_math",
      difficulty: "medium",
      question: "If f(x) = 2x^2 - 3x + 1, what is f(2)?",
      choices: ["3", "5", "7", "9"],
      correct_index: 0,
      explanation: "f(2) = 2(4) - 3(2) + 1 = 8 - 6 + 1 = 3.",
    },
    {
      topic: "sat_reading",
      difficulty: "easy",
      question: "Which word best completes: 'Her _____ tone made the audience laugh.'?",
      choices: ["solemn", "wry", "monotone", "bitter"],
      correct_index: 1,
      explanation: "'Wry' means dryly humorous, which matches an audience laughing.",
    },
    {
      topic: "biology",
      difficulty: "easy",
      question: "Which organelle is known as the powerhouse of the cell?",
      choices: ["Nucleus", "Mitochondrion", "Ribosome", "Golgi apparatus"],
      correct_index: 1,
      explanation: "Mitochondria produce ATP, the cell's primary energy currency.",
    },
    {
      topic: "world_geography",
      difficulty: "easy",
      question: "Which river is the longest in the world?",
      choices: ["Amazon", "Nile", "Yangtze", "Mississippi"],
      correct_index: 1,
      explanation: "The Nile is generally accepted as the longest river at ~6,650 km.",
    },
    {
      topic: "history",
      difficulty: "medium",
      question: "In what year did the Berlin Wall fall?",
      choices: ["1987", "1989", "1991", "1993"],
      correct_index: 1,
      explanation: "The Berlin Wall fell on 9 November 1989.",
    },
    {
      topic: "general_knowledge",
      difficulty: "easy",
      question: "What planet is known as the Red Planet?",
      choices: ["Venus", "Mars", "Jupiter", "Saturn"],
      correct_index: 1,
      explanation: "Mars appears red due to iron oxide (rust) on its surface.",
    },
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function randomId(): string {
    return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["QV_AGENT_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // Resolve the effective userId for a service-only RPC. Accepts either:
  //   (a) ctx.userId (caller authenticated as the user themselves)
  //   (b) service_token + user_id in payload (gateway acting on behalf of user)
  // Returns "" + error message on failure, callers must check.
  function resolveServiceUserId(
    ctx: nkruntime.Context,
    data: any
  ): { userId: string; error?: string; code?: number } {
    if (ctx.userId) {
      return { userId: ctx.userId };
    }
    if (!isServiceCaller(ctx, data)) {
      return { userId: "", error: "not authorised", code: 401 };
    }
    var u = "" + (data.user_id || "");
    if (!u) {
      return { userId: "", error: "user_id required for service caller", code: 400 };
    }
    return { userId: u };
  }

  function byteLength(s: string): number {
    // Approximate UTF-8 byte length. Goja lacks Buffer; this is good enough for
    // the 4 KB content cap (each high-BMP char counts as 3, surrogate pair as 4).
    var len = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) len += 1;
      else if (c < 0x800) len += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { len += 4; i++; }
      else len += 3;
    }
    return len;
  }

  function emitAnalytics(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    eventName: string,
    properties: any
  ): void {
    try {
      var unixTs = nowSec();
      var dateStr = todayDate();
      var rand = Math.random().toString(36).slice(2, 8);
      var dashKey = "dash_" + ANALYTICS_GAME_ID + "_" + dateStr + "_" + eventName + "_" + unixTs + "_" + rand;
      nk.storageWrite([{
        collection: Constants.ANALYTICS_COLLECTION,
        key: dashKey,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          eventName: eventName,
          gameId: ANALYTICS_GAME_ID,
          userId: userId,
          properties: properties,
          unixTimestamp: unixTs,
          date: dateStr,
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[qv-agent] emitAnalytics failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  function readMemoryDoc(nk: nkruntime.Nakama, userId: string): MemoryDoc {
    try {
      var rows = nk.storageRead([{
        collection: MEMORY_COLLECTION,
        key: MEMORY_KEY,
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v = rows[0].value as MemoryDoc;
        return {
          entries: Array.isArray(v.entries) ? v.entries : [],
          updated_unix: v.updated_unix || 0,
        };
      }
    } catch (e: any) { /* swallow — return empty doc */ }
    return { entries: [], updated_unix: 0 };
  }

  function writeMemoryDoc(nk: nkruntime.Nakama, userId: string, doc: MemoryDoc): void {
    nk.storageWrite([{
      collection: MEMORY_COLLECTION,
      key: MEMORY_KEY,
      userId: userId,
      value: doc,
      // Server-only — never expose memory to client SDK reads. Gateway is the
      // only legitimate reader, and it goes through this RPC (which enforces
      // service_token).
      permissionRead: 0,
      permissionWrite: 0,
    }]);
  }

  // ── RPC: qv_agent_ping ─────────────────────────────────────────────────────
  // Liveness probe for the gateway → Nakama wiring. No auth required so the
  // gateway can curl this during boot to confirm the http_key path works.
  //
  // Request:  {}
  // Response: { "success": true, "data": { "ok": true, "ts": 1716521234, "version": "qv-agent/1" } }
  function rpcPing(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string {
    return RpcHelpers.successResponse({
      ok: true,
      ts: nowSec(),
      version: "qv-agent/1",
    });
  }

  // ── RPC: qv_agent_memory_write ─────────────────────────────────────────────
  // Append a memory entry to the user's ring buffer. Oldest entry is dropped
  // when the buffer hits MAX_MEMORY_ENTRIES.
  //
  // Request:  { "role": "user"|"assistant"|"tool"|"system",
  //             "content": "...",
  //             "trace_id"?: "...",
  //             "tags"?: ["..."],
  //             "user_id"?: "<cognito_sub>",        // required when called by gateway
  //             "service_token"?: "..."             // required when called by gateway
  //           }
  // Response: { "success": true, "data": { "ok": true, "entry_count": 12 } }
  // Errors:   401 not authorised, 400 missing required field, 413 content too large
  function rpcMemoryWrite(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var role = ("" + (data.role || "")).toLowerCase();
      var content = "" + (data.content || "");
      var traceId = "" + (data.trace_id || randomId());
      var tags: string[] = Array.isArray(data.tags) ? data.tags.slice(0, 8).map(function (t: any) { return ("" + t).slice(0, 64); }) : [];

      if (role !== "user" && role !== "assistant" && role !== "tool" && role !== "system") {
        return RpcHelpers.errorResponse("role must be user|assistant|tool|system", 400);
      }
      if (!content) return RpcHelpers.errorResponse("content required", 400);
      if (byteLength(content) > MAX_CONTENT_BYTES) {
        return RpcHelpers.errorResponse("content exceeds " + MAX_CONTENT_BYTES + " bytes", 413);
      }

      var doc = readMemoryDoc(nk, auth.userId);
      var entry: MemoryEntry = {
        ts: nowSec(),
        role: role,
        content: content,
        trace_id: traceId,
        tags: tags,
      };
      doc.entries.push(entry);
      // Ring buffer: keep tail.
      if (doc.entries.length > MAX_MEMORY_ENTRIES) {
        doc.entries = doc.entries.slice(doc.entries.length - MAX_MEMORY_ENTRIES);
      }
      doc.updated_unix = nowSec();
      writeMemoryDoc(nk, auth.userId, doc);

      emitAnalytics(nk, logger, auth.userId, "qv_agent_memory_write", {
        role: role,
        content_bytes: byteLength(content),
        entry_count: doc.entries.length,
        trace_id: traceId,
      });

      return RpcHelpers.successResponse({ ok: true, entry_count: doc.entries.length });
    } catch (err: any) {
      logger.error("qv_agent_memory_write failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_memory_read ──────────────────────────────────────────────
  // Read the last N entries from the user's memory ring.
  //
  // Request:  { "limit"?: 20,                       // default 20, max 50
  //             "since_ts"?: 1716521234,            // optional, return only entries newer than this
  //             "user_id"?: "<cognito_sub>",
  //             "service_token"?: "..."
  //           }
  // Response: { "success": true, "data": { "entries": MemoryEntry[], "updated_unix": 1716521234 } }
  function rpcMemoryRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var limit = Math.min(Math.max(parseInt(data.limit) || 20, 1), MAX_MEMORY_ENTRIES);
      var sinceTs = parseInt(data.since_ts) || 0;

      var doc = readMemoryDoc(nk, auth.userId);
      var entries = doc.entries;
      if (sinceTs > 0) {
        entries = entries.filter(function (e) { return e.ts > sinceTs; });
      }
      // Last N (tail).
      if (entries.length > limit) {
        entries = entries.slice(entries.length - limit);
      }

      return RpcHelpers.successResponse({
        entries: entries,
        updated_unix: doc.updated_unix,
        total_in_ring: doc.entries.length,
      });
    } catch (err: any) {
      logger.error("qv_agent_memory_read failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_get_my_rank ──────────────────────────────────────────────
  // Returns the user's rank + percentile on the global leaderboard.
  //
  // We query the user's own record explicitly via leaderboardRecordsList with
  // ownerIds=[userId]. Nakama returns the record's rank in `ownerRecords[0].rank`
  // (1-indexed). For percentile we ask for the total rankCount in the same call.
  //
  // Request:  { "leaderboard_id"?: "leaderboard_global",  // default
  //             "user_id"?: "<cognito_sub>",
  //             "service_token"?: "..."
  //           }
  // Response: { "success": true, "data": {
  //             "rank": 142, "total": 50000, "percentile": 99.7,
  //             "score": 12345, "username": "playerName"
  //           }}
  //
  // 404 if the user has no record on this leaderboard yet.
  function rpcGetMyRank(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      var leaderboardId = "" + (data.leaderboard_id || GLOBAL_LEADERBOARD_ID);
      var result: any;
      try {
        result = nk.leaderboardRecordsList(leaderboardId, [auth.userId], 1, null, 0);
      } catch (e: any) {
        return RpcHelpers.errorResponse("leaderboard not found: " + leaderboardId, 404);
      }

      var owner = (result && result.ownerRecords && result.ownerRecords[0]) || null;
      if (!owner) {
        return RpcHelpers.errorResponse("no record for user on " + leaderboardId, 404);
      }

      var rank = parseInt(("" + owner.rank)) || 0;
      var total = parseInt(("" + result.rankCount)) || 0;
      var percentile = total > 0 ? +((1 - (rank - 1) / total) * 100).toFixed(2) : 0;

      return RpcHelpers.successResponse({
        leaderboard_id: leaderboardId,
        rank: rank,
        total: total,
        percentile: percentile,
        score: parseInt(("" + owner.score)) || 0,
        subscore: parseInt(("" + owner.subscore)) || 0,
        username: owner.username || "",
      });
    } catch (err: any) {
      logger.error("qv_agent_get_my_rank failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_global_leaderboard_top10 ─────────────────────────────────
  // Anonymous-safe read of the global leaderboard. Used by:
  //   - Phase A web chat in anonymous mode ("show me the top players")
  //   - /vs/* and /leaderboard/* SEO pages (issue #79)
  //
  // No service_token required — this is fully public data. Rate limiting and
  // result caching live in the gateway.
  //
  // Request:  { "leaderboard_id"?: "leaderboard_global", "limit"?: 10 }
  // Response: { "success": true, "data": { "records": [...] } }
  function rpcGlobalLeaderboardTop10(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var leaderboardId = "" + (data.leaderboard_id || GLOBAL_LEADERBOARD_ID);
      var limit = Math.min(Math.max(parseInt(data.limit) || 10, 1), 50);

      var result: any;
      try {
        result = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
      } catch (e: any) {
        return RpcHelpers.errorResponse("leaderboard not found: " + leaderboardId, 404);
      }

      var records = (result && result.records) || [];
      var slim: any[] = [];
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        slim.push({
          rank: parseInt(("" + r.rank)) || (i + 1),
          username: r.username || "",
          score: parseInt(("" + r.score)) || 0,
          subscore: parseInt(("" + r.subscore)) || 0,
        });
      }

      return RpcHelpers.successResponse({
        leaderboard_id: leaderboardId,
        records: slim,
        total: parseInt(("" + result.rankCount)) || slim.length,
      });
    } catch (err: any) {
      logger.error("qv_agent_global_leaderboard_top10 failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_analyze_quiz_performance ─────────────────────────────────
  // Returns a structured analysis of the user's recent quiz performance,
  // sourced from the KB enrichment cron's derived attributes (see
  // src/satori/identities/kb_enrichment.ts which writes `user_model/derived`).
  //
  // Phase A v1 is a thin read of that pre-computed blob. Phase B will add
  // rolling-window calculations server-side.
  //
  // Request:  { "user_id"?, "service_token"?, "window"?: "7d"|"30d"|"all" }
  // Response: { "success": true, "data": {
  //             "predicted_score_pct": 78,
  //             "weak_topics": ["photosynthesis", "logarithms"],
  //             "strong_topics": ["world_capitals", "synonyms"],
  //             "personality_archetype": "evening_burst_solver",
  //             "next_best_topic": "logarithms",
  //             "session_count_7d": 14,
  //             "data_freshness_unix": 1716521234
  //           }}
  function rpcAnalyzeQuizPerformance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var auth = resolveServiceUserId(ctx, data);
      if (auth.error) return RpcHelpers.errorResponse(auth.error, auth.code);

      // window arg is reserved for v2; v1 always returns the derived blob.
      var derived: any = {};
      var streaks: any = {};
      try {
        var rows = nk.storageRead([
          { collection: "user_model", key: "derived", userId: auth.userId },
          { collection: "user_streaks", key: "current", userId: auth.userId },
        ]);
        if (rows && rows.length > 0) {
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r || !r.value) continue;
            if (r.collection === "user_model" && r.key === "derived") derived = r.value;
            if (r.collection === "user_streaks" && r.key === "current") streaks = r.value;
          }
        }
      } catch (e: any) { /* fall through to empty defaults */ }

      var analysis = {
        predicted_score_pct: (derived as any).predicted_score_pct || null,
        weak_topics: (derived as any).weak_topics || [],
        strong_topics: (derived as any).strong_topics || [],
        personality_archetype: (derived as any).personality_archetype || "unknown",
        next_best_topic: (derived as any).next_best_topic || null,
        streak_count: (streaks as any).count || 0,
        session_count_7d: (derived as any).session_count_7d || 0,
        data_freshness_unix: (derived as any).updated_unix || 0,
        has_data: Object.keys(derived).length > 0,
      };

      emitAnalytics(nk, logger, auth.userId, "qv_agent_analyze_performance", {
        has_data: analysis.has_data,
        weak_topic_count: analysis.weak_topics.length,
        strong_topic_count: analysis.strong_topics.length,
      });

      return RpcHelpers.successResponse(analysis);
    } catch (err: any) {
      logger.error("qv_agent_analyze_quiz_performance failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_generate_trivia ──────────────────────────────────────────
  // Returns one trivia question from the in-module catalog. Filter by topic
  // and/or difficulty if supplied; otherwise random.
  //
  // Anonymous-safe — used by Phase A web chat in anonymous mode for the
  // "try a SAT question" surface. Authenticated callers can pass topic
  // preferences derived from weak_topics.
  //
  // v1 returns from TRIVIA_CATALOG. v2 (post-Phase A) will call content-factory
  // for a fresh question via nk.httpRequest. The gateway should be insensitive
  // to which source generated the question — the response shape is stable.
  //
  // Request:  { "topic"?: "sat_math", "difficulty"?: "easy"|"medium"|"hard",
  //             "user_id"?, "service_token"? }
  // Response: { "success": true, "data": {
  //             "question_id": "...", "topic": "sat_math", "difficulty": "easy",
  //             "question": "...", "choices": [...], "correct_index": 1,
  //             "explanation": "...", "source": "v1_catalog"
  //           }}
  function rpcGenerateTrivia(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var wantTopic = ("" + (data.topic || "")).toLowerCase();
      var wantDifficulty = ("" + (data.difficulty || "")).toLowerCase();

      var candidates: TriviaSample[] = TRIVIA_CATALOG.slice();
      if (wantTopic) {
        var filtered = candidates.filter(function (q) { return q.topic === wantTopic; });
        if (filtered.length > 0) candidates = filtered;
      }
      if (wantDifficulty) {
        var filteredD = candidates.filter(function (q) { return q.difficulty === wantDifficulty; });
        if (filteredD.length > 0) candidates = filteredD;
      }
      if (candidates.length === 0) {
        return RpcHelpers.errorResponse("no trivia matching filters", 404);
      }

      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      return RpcHelpers.successResponse({
        question_id: "qv_v1_" + pick.topic + "_" + randomId(),
        topic: pick.topic,
        difficulty: pick.difficulty,
        question: pick.question,
        choices: pick.choices,
        correct_index: pick.correct_index,
        explanation: pick.explanation,
        source: "v1_catalog",
      });
    } catch (err: any) {
      logger.error("qv_agent_generate_trivia failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: qv_agent_public_activity ──────────────────────────────────────────
  // Anonymous-OK, counts-only projection of the nightly analytics rollups for
  // the public /stats/activity marketing page (audience capture + backlinks).
  //
  // Sources counts from `analytics_rollup_daily` (rollup_<gameId>_<YYYY-MM-DD>
  // docs written by analytics_rollup.js under SYSTEM_USER) instead of scanning
  // raw `analytics_events`: the raw collection pages oldest-first with no
  // key-prefix filter, so a capped forward scan can never reach recent events
  // once the collection grows. Direct keyed reads of the last-N rollup docs are
  // O(N) and always current.
  //
  // Returns aggregate learner-activity counts bucketed by UTC day, with weekly
  // (ISO-8601) and monthly roll-ups. NO PII: only event counts + learner counts
  // per bucket. Daily learners = exact DAU from the rollup; weekly/monthly
  // learners = peak daily DAU within the bucket (distinct users across days are
  // not derivable from daily rollups) — this is signal for a marketing surface,
  // not an exact ledger.
  //
  // Request:  {}  (optional { "days"?: number } lookback window, default/max 365)
  // Response: { success, data: {
  //   game_id, generated_unix, sampled,
  //   totals: { learners, events, days },
  //   daily:  [{ bucket: "YYYY-MM-DD", events, learners }],   // last 30
  //   weekly: [{ bucket: "YYYY-Www",  events, learners }],    // last 12
  //   monthly:[{ bucket: "YYYY-MM",   events, learners }] } }  // last 12
  var ACTIVITY_ROLLUP_COLLECTION = "analytics_rollup_daily";
  var QV_GAME_UUID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";

  function pad2(n: number): string { return n < 10 ? "0" + n : "" + n; }

  function isoDateUtc(d: Date): string {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  function isoWeekUtc(d: Date): string {
    var date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
    var firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    var firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    var week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return date.getUTCFullYear() + "-W" + pad2(week);
  }

  function bumpBucket(
    map: { [k: string]: { events: number; learners: number } },
    key: string,
    events: number,
    dau: number
  ): void {
    if (!map[key]) map[key] = { events: 0, learners: 0 };
    map[key].events += events;
    // Peak daily DAU within the bucket — daily rollups can't give distinct
    // users across days, so this is the safest non-inflated learner signal.
    if (dau > map[key].learners) map[key].learners = dau;
  }

  function lastBuckets(
    map: { [k: string]: { events: number; learners: number } },
    n: number
  ): Array<{ bucket: string; events: number; learners: number }> {
    var keys: string[] = [];
    for (var k in map) { if (map.hasOwnProperty(k)) keys.push(k); }
    keys.sort(); // YYYY-MM-DD / YYYY-Www / YYYY-MM all sort lexicographically by time
    var start = Math.max(0, keys.length - n);
    var out: Array<{ bucket: string; events: number; learners: number }> = [];
    for (var i = start; i < keys.length; i++) {
      var b = map[keys[i]];
      out.push({ bucket: keys[i], events: b.events, learners: b.learners });
    }
    return out;
  }

  function rpcPublicActivity(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var lookbackDays = Math.min(Math.max(parseInt(data.days) || 365, 30), 365);

      var dayMap: { [k: string]: { events: number; learners: number } } = {};
      var weekMap: { [k: string]: { events: number; learners: number } } = {};
      var monthMap: { [k: string]: { events: number; learners: number } } = {};
      var totalEvents = 0;
      var peakDau = 0;
      var dayCount = 0;

      // Direct keyed reads of the last-N daily rollup docs (written nightly by
      // analytics_rollup.js under SYSTEM_USER as rollup_<gameId>_<YYYY-MM-DD>).
      // Batched storageRead: missing days simply return no record.
      var now = Date.now();
      var batch: nkruntime.StorageReadRequest[] = [];
      var recs: nkruntime.StorageObject[] = [];
      for (var back = 0; back < lookbackDays; back++) {
        var dStr = isoDateUtc(new Date(now - back * 86400000));
        batch.push({
          collection: ACTIVITY_ROLLUP_COLLECTION,
          key: "rollup_" + QV_GAME_UUID + "_" + dStr,
          userId: Constants.SYSTEM_USER_ID,
        });
        if (batch.length >= 100 || back === lookbackDays - 1) {
          try {
            var page = nk.storageRead(batch);
            for (var r = 0; r < page.length; r++) recs.push(page[r]);
          } catch (e: any) {
            logger.warn("qv_agent_public_activity rollup read failed: " + (e && e.message ? e.message : String(e)));
          }
          batch = [];
        }
      }

      for (var i = 0; i < recs.length; i++) {
        var v: any = recs[i] && recs[i].value;
        if (!v || !v.date) continue;
        var events = v.event_count || 0;
        var dau = v.dau || 0;
        var d = new Date(v.date + "T00:00:00.000Z");
        bumpBucket(dayMap, v.date, events, dau);
        bumpBucket(weekMap, isoWeekUtc(d), events, dau);
        bumpBucket(monthMap, v.date.substring(0, 7), events, dau);
        totalEvents += events;
        if (dau > peakDau) peakDau = dau;
        dayCount++;
      }

      return RpcHelpers.successResponse({
        game_id: ANALYTICS_GAME_ID,
        generated_unix: Math.floor(Date.now() / 1000),
        sampled: false, // exact rollup reads — never a capped scan
        totals: { learners: peakDau, events: totalEvents, days: dayCount },
        daily: lastBuckets(dayMap, 30),
        weekly: lastBuckets(weekMap, 12),
        monthly: lastBuckets(monthMap, 12),
      });
    } catch (err: any) {
      logger.error("qv_agent_public_activity failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ───────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("qv_agent_ping", rpcPing);
    initializer.registerRpc("qv_agent_memory_write", rpcMemoryWrite);
    initializer.registerRpc("qv_agent_memory_read", rpcMemoryRead);
    initializer.registerRpc("qv_agent_get_my_rank", rpcGetMyRank);
    initializer.registerRpc("qv_agent_global_leaderboard_top10", rpcGlobalLeaderboardTop10);
    initializer.registerRpc("qv_agent_analyze_quiz_performance", rpcAnalyzeQuizPerformance);
    initializer.registerRpc("qv_agent_generate_trivia", rpcGenerateTrivia);
    initializer.registerRpc("qv_agent_public_activity", rpcPublicActivity);
  }
}
