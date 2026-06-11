// ---------------------------------------------------------------------------
// Satori Audience Estimator — admin-only size estimates for audience
// definitions, matching the hosted Satori console's "audience size" readout.
//
// Strategy: page through `satori_identity_props` (one object per user who has
// ever sent an event) and evaluate the audience rule against each user's
// already-loaded property map (SatoriAudiences.matchesWithProps — zero extra
// reads per user). The scan is page-capped, so on very large player bases the
// result degrades to a clearly-flagged extrapolated estimate instead of
// hanging a VM.
// ---------------------------------------------------------------------------
namespace SatoriAudienceEstimate {

  var PAGE_SIZE = 100;
  var DEFAULT_PAGES = 100;  // 10K identities
  var MAX_PAGES = 400;
  var SAMPLE_LIMIT = 10;

  // satori_audiences_estimate — Payload: { audienceId, game_id?, max_pages? }
  function rpcEstimate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var audienceId = data.audienceId || data.audience_id;
    if (!audienceId) return RpcHelpers.errorResponse("audienceId required");
    var gameId = RpcHelpers.gameId(data);

    var def = SatoriAudiences.getDefinition(nk, audienceId, gameId);
    if (!def) return RpcHelpers.errorResponse("Audience '" + audienceId + "' not found");

    var maxPages = Math.min(Math.max(parseInt(data.max_pages, 10) || DEFAULT_PAGES, 1), MAX_PAGES);

    var scanned = 0;
    var matched = 0;
    var sample: string[] = [];
    var cursor = "";
    var truncated = false;

    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList("", Constants.SATORI_IDENTITY_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];

      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (obj.key !== "props" || !obj.value || !obj.userId) continue;
        scanned++;

        var props = obj.value as any;
        var allProps: { [key: string]: string } = {};
        for (var k in (props.defaultProperties || {})) allProps[k] = props.defaultProperties[k];
        for (var ck in (props.customProperties || {})) allProps[ck] = props.customProperties[ck];
        for (var pk in (props.computedProperties || {})) allProps[pk] = props.computedProperties[pk];

        if (SatoriAudiences.matchesWithProps(def, obj.userId, allProps)) {
          matched++;
          if (sample.length < SAMPLE_LIMIT) sample.push(obj.userId);
        }
      }

      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;

    var matchRate = scanned > 0 ? matched / scanned : 0;

    return RpcHelpers.successResponse({
      audienceId: audienceId,
      name: def.name || audienceId,
      estimatedSize: matched,
      scannedIdentities: scanned,
      matchRate: matchRate,
      sampleUserIds: sample,
      truncated: truncated
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_audiences_estimate", rpcEstimate);
  }
}
