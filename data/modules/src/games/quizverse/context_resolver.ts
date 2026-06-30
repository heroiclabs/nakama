// QuizVerse — Context Resolver
//
// Provides a single resolveContext() helper that every QuizVerse RPC
// calls at entry to get a consistent, validated request context.
//
// Resolves:
//   userId     — from ctx (authentication required)
//   username   — from ctx
//   gameId     — req.game_id → DEFAULT_GAME_ID env → ""
//   lang       — req.lang → "en"
//   countryCode — req.country_code → Nakama profile location → "US"
//
// ALLOWED_GAME_IDS gate prevents unknown game IDs from polluting
// leaderboards or bypassing per-game question routing.

namespace QvContextResolver {

  // ── Allowlist ──────────────────────────────────────────────────────────────
  // Add new game UUIDs here as new games join the IntelliVerseX platform.

  var ALLOWED_GAME_IDS: { [id: string]: string } = {
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": "quizverse",  // QuizVerse production
    "quizverse":                             "quizverse",  // slug alias
    "":                                      "default"     // empty = use DEFAULT_GAME_ID
  };

  // ── Returned shape ─────────────────────────────────────────────────────────

  export interface ResolvedContext {
    userId:      string;
    username:    string;
    gameId:      string;
    lang:        string;
    countryCode: string;
    mode:        string;  // "standard" | "personalized" | …
  }

  // ── Low-level helpers ──────────────────────────────────────────────────────

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  // ── Main resolver ──────────────────────────────────────────────────────────

  /**
   * resolve() validates authentication and normalises all context fields.
   * Throws UNAUTHENTICATED if ctx.userId is missing.
   *
   * @param nk   — Nakama runtime (used for profile lookup)
   * @param ctx  — RPC context
   * @param req  — parsed JSON request payload (plain object)
   */
  export function resolve(
    nk:  nkruntime.Nakama,
    ctx: nkruntime.Context,
    req: any
  ): ResolvedContext {
    var userId = ctx.userId;
    if (!userId) throw nakamaError("not authenticated", nkruntime.Codes.UNAUTHENTICATED);

    var username = ctx.username || "";

    // ── game_id ─────────────────────────────────────────────────────────────
    var rawGameId = (typeof req.game_id === "string" && req.game_id) ? req.game_id : "";
    var defaultGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) ? ctx.env["DEFAULT_GAME_ID"] : "";
    var gameId: string;

    if (!rawGameId) {
      gameId = defaultGameId;
    } else if (ALLOWED_GAME_IDS[rawGameId]) {
      gameId = rawGameId;
    } else {
      // Unknown game_id — fall back to default (soft fail, no error thrown)
      gameId = defaultGameId;
    }

    // ── lang ─────────────────────────────────────────────────────────────────
    var lang = (typeof req.lang === "string" && req.lang)
      ? req.lang.toLowerCase().trim()
      : "en";

    // ── countryCode: req → Nakama profile → "US" ────────────────────────────
    var countryCode = "US";
    var reqCountry = (typeof req.country_code === "string") ? req.country_code.trim().toUpperCase() : "";
    if (reqCountry.length === 2 && /^[A-Z]{2}$/.test(reqCountry)) {
      countryCode = reqCountry;
    } else {
      try {
        var acc = nk.accountGetId(userId);
        if (acc && acc.user && acc.user.location) {
          var loc = acc.user.location.trim().toUpperCase();
          if (loc.length === 2 && /^[A-Z]{2}$/.test(loc)) countryCode = loc;
        }
      } catch (_e) {}
    }

    // ── mode ──────────────────────────────────────────────────────────────────
    var mode = (typeof req.mode === "string" && req.mode) ? req.mode : "standard";

    return {
      userId:      userId,
      username:    username,
      gameId:      gameId,
      lang:        lang,
      countryCode: countryCode,
      mode:        mode
    };
  }
}
