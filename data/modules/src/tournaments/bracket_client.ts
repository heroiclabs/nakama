// =============================================================================
// bracket_client.ts — Nakama ↔ Bracket service S2S bridge
//
// Plan ref: §3 Bracket integration. The `bracket` upstream FastAPI service
// is already deployed on EKS at:
//   internal: bracket.aicart.svc.cluster.local:8400
//   public:   https://bracket.intelli-verse-x.ai
//
// Bracket is a sync match runner; QuizVerse is async pack-based. We adapt
// by using a 24h round window: each "match" is "submit at least one pack
// during 24h; highest score wins the match; ties broken by submitted_at".
//
// Nakama calls Bracket only for the playoff stage (top 64 from qualifier).
// Bracket calls Nakama via existing http_key for result attribution.
// =============================================================================

namespace BracketClient {

  function getBaseUrl(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["BRACKET_INTERNAL_URL"]) || "http://bracket.aicart.svc.cluster.local:8400");
  }
  function getServiceJwt(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["BRACKET_SERVICE_JWT"]) || "");
  }

  function authHeaders(ctx: nkruntime.Context): { [k: string]: string } {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getServiceJwt(ctx),
    };
  }

  // Pre-create a Bracket shell at DRAFT→OPEN transition (per plan §3 fix).
  // Returns the bracket_id; subsequent calls are idempotent (we cache the id
  // in tournaments_meta.bracket_id).
  export function createBracketShell(ctx: nkruntime.Context, nk: nkruntime.Nakama, slug: string, name: string, playerCount: number): { ok: boolean; bracket_id?: string; error?: string } {
    var url = getBaseUrl(ctx) + "/tournaments";
    var body = {
      name: name + " — Playoffs",
      tournament_type: "SINGLE_ELIMINATION",
      max_players: playerCount,
      external_ref: slug,
      duel_match_size: 1,
    };
    try {
      var res = nk.httpRequest(url, "post", authHeaders(ctx), JSON.stringify(body), 10000);
      if (res.code >= 200 && res.code < 300) {
        var parsed: any = JSON.parse(res.body);
        return { ok: true, bracket_id: "" + (parsed.tournament_id || parsed.id || "") };
      }
      return { ok: false, error: "bracket returned " + res.code + ": " + (res.body || "").slice(0, 200) };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // Register a winner-set (top 64 from qualifier) as Bracket players.
  export function seedPlayers(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string, players: { user_id: string; username: string; seed_score: number }[]): { ok: boolean; error?: string } {
    var url = getBaseUrl(ctx) + "/tournaments/" + encodeURIComponent(bracketId) + "/players/batch";
    var body = { players: players };
    try {
      var res = nk.httpRequest(url, "post", authHeaders(ctx), JSON.stringify(body), 15000);
      if (res.code >= 200 && res.code < 300) return { ok: true };
      return { ok: false, error: "bracket returned " + res.code };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // Post a match result (winner_user_id, scores) back to Bracket so it can
  // advance the bracket tree. Called by tournament cron at end of each 24h
  // round window.
  export function postMatchResult(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string, matchId: string, winnerUserId: string, scores: any): { ok: boolean; error?: string } {
    var url = getBaseUrl(ctx) + "/tournaments/" + encodeURIComponent(bracketId) + "/matches/" + encodeURIComponent(matchId) + "/result";
    var body = { winner_user_id: winnerUserId, scores: scores };
    try {
      var res = nk.httpRequest(url, "put", authHeaders(ctx), JSON.stringify(body), 10000);
      if (res.code >= 200 && res.code < 300) return { ok: true };
      return { ok: false, error: "bracket returned " + res.code };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }

  // Read current bracket state (for iframe pre-warm + caller-side checks).
  export function getBracketState(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string): { ok: boolean; state?: any; error?: string } {
    var url = getBaseUrl(ctx) + "/tournaments/" + encodeURIComponent(bracketId);
    try {
      var res = nk.httpRequest(url, "get", authHeaders(ctx), null, 5000);
      if (res.code >= 200 && res.code < 300) return { ok: true, state: JSON.parse(res.body) };
      return { ok: false, error: "bracket returned " + res.code };
    } catch (err: any) {
      return { ok: false, error: "" + (err && err.message ? err.message : err) };
    }
  }
}
