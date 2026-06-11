// ---------------------------------------------------------------------------
// Satori Identity Inspector — admin-only 360° view of one identity, matching
// the hosted Satori console's "Identities" drill-down:
//   - account basics (when the ID resolves to a Nakama user)
//   - identity properties (default / custom / computed)
//   - recent event timeline (per-user rolling history, newest first)
//   - audience memberships (evaluated live against current definitions)
//   - experiment assignments (across all game scopes)
// One RPC, a handful of point reads — safe to call from the admin UI on click.
// ---------------------------------------------------------------------------
namespace SatoriIdentityInspector {

  var TIMELINE_DEFAULT = 100;
  var TIMELINE_MAX = 500;

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  // satori_identity_inspect — Payload: { user_id, game_id?, timeline_limit? }
  function rpcInspect(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var userId = data.user_id || data.userId;
    if (!userId) return RpcHelpers.errorResponse("user_id required");
    var gameId = RpcHelpers.gameId(data);
    var timelineLimit = Math.min(Math.max(parseInt(data.timeline_limit, 10) || TIMELINE_DEFAULT, 1), TIMELINE_MAX);

    // Account basics — external/synthetic identities won't resolve; that's fine.
    var account: any = null;
    try {
      var acct = nk.accountGetId(userId);
      if (acct && acct.user) {
        account = {
          username: acct.user.username || "",
          displayName: acct.user.displayName || "",
          createTime: acct.user.createTime || 0,
          online: !!acct.user.online
        };
      }
    } catch (err: any) {
      // Not a Nakama user UUID (e.g. QR-studio synthetic identity) — skip.
    }

    // Identity properties.
    var props = SatoriIdentities.getAllProperties(nk, userId);
    var allProps: { [key: string]: string } = {};
    for (var k in (props.defaultProperties || {})) allProps[k] = props.defaultProperties[k];
    for (var ck in (props.customProperties || {})) allProps[ck] = props.customProperties[ck];
    for (var pk in (props.computedProperties || {})) allProps[pk] = props.computedProperties[pk];

    // Recent event timeline (rolling per-user history, capped at 500 at write
    // time by SatoriEventCapture). Newest first.
    var timeline: any[] = [];
    var history = Storage.readJson<{ events: any[] }>(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId);
    var events = (history && history.events) || [];
    for (var i = events.length - 1; i >= 0 && timeline.length < timelineLimit; i--) {
      timeline.push({
        name: events[i].name,
        timestampMs: toMs(events[i].timestamp),
        metadata: events[i].metadata || {}
      });
    }

    // Audience memberships — evaluated against current definitions using the
    // props we already loaded (no per-audience storage reads).
    var memberships: string[] = [];
    var audienceIds: string[] = [];
    var defs = listAudienceDefs(nk, gameId);
    for (var aid in defs) {
      audienceIds.push(aid);
      if (SatoriAudiences.matchesWithProps(defs[aid], userId, allProps)) {
        memberships.push(aid);
      }
    }

    // Experiment assignments — one storage object per game scope.
    var assignments: any[] = [];
    try {
      var page = nk.storageList(userId, Constants.SATORI_ASSIGNMENTS_COLLECTION, 50);
      var objects = (page && page.objects) || [];
      for (var o = 0; o < objects.length; o++) {
        var scopeKey = objects[o].key; // "assignments" or "<gameId>:assignments"
        var scoped = (objects[o].value as any).assignments || {};
        for (var expId in scoped) {
          assignments.push({
            experimentId: expId,
            variantId: scoped[expId].variantId,
            assignedAtMs: toMs(scoped[expId].assignedAt || 0),
            scope: scopeKey === "assignments" ? "global" : scopeKey.split(":")[0]
          });
        }
      }
    } catch (err: any) {
      logger.warn("[IdentityInspector] assignments read failed for %s: %s", userId, err.message || String(err));
    }

    return RpcHelpers.successResponse({
      userId: userId,
      account: account,
      properties: {
        defaultProperties: props.defaultProperties || {},
        customProperties: props.customProperties || {},
        computedProperties: props.computedProperties || {}
      },
      timeline: timeline,
      timelineTotal: events.length,
      audiences: memberships,
      audiencesEvaluated: audienceIds.length,
      experiments: assignments
    });
  }

  // Local mirror of SatoriAudiences' definition loading (that namespace keeps
  // it private); ConfigLoader caching makes this cheap.
  function listAudienceDefs(nk: nkruntime.Nakama, gameId?: string): { [id: string]: Satori.AudienceDefinition } {
    var raw = ConfigLoader.loadSatoriConfigForGame<any>(nk, "audiences", gameId, {});
    var source = raw && raw.audiences ? raw.audiences : (raw || {});
    var out: { [id: string]: Satori.AudienceDefinition } = {};
    for (var id in source) {
      var def = source[id] || {};
      var fullDef = SatoriAudiences.getDefinition(nk, def.id || id, gameId);
      if (fullDef) out[fullDef.id] = fullDef;
    }
    // Include built-in defaults even when no custom config exists.
    var builtins = ["new_players", "returning_players", "spenders"];
    for (var b = 0; b < builtins.length; b++) {
      if (!out[builtins[b]]) {
        var builtinDef = SatoriAudiences.getDefinition(nk, builtins[b], gameId);
        if (builtinDef) out[builtins[b]] = builtinDef;
      }
    }
    return out;
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_identity_inspect", rpcInspect);
  }
}
