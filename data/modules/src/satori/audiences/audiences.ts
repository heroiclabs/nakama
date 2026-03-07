namespace SatoriAudiences {

  function getAudienceDefinitions(nk: nkruntime.Nakama): { [id: string]: Satori.AudienceDefinition } {
    var custom = ConfigLoader.loadSatoriConfig<{ [id: string]: Satori.AudienceDefinition }>(nk, "audiences", {});
    return applyDefaults(custom);
  }

  function applyDefaults(audiences: { [id: string]: Satori.AudienceDefinition }): { [id: string]: Satori.AudienceDefinition } {
    if (!audiences["new_players"]) {
      audiences["new_players"] = {
        id: "new_players",
        name: "New Players",
        description: "Players who joined in the last 7 days",
        rule: {
          combinator: "and",
          filters: [{ property: "first_seen_days_ago", operator: "lte", value: "7" }]
        },
        createdAt: 0,
        updatedAt: 0
      };
    }
    if (!audiences["returning_players"]) {
      audiences["returning_players"] = {
        id: "returning_players",
        name: "Returning Players",
        description: "Players with 3+ sessions",
        rule: {
          combinator: "and",
          filters: [{ property: "session_count", operator: "gte", value: "3" }]
        },
        createdAt: 0,
        updatedAt: 0
      };
    }
    if (!audiences["spenders"]) {
      audiences["spenders"] = {
        id: "spenders",
        name: "Spenders",
        description: "Players who have spent money",
        rule: {
          combinator: "and",
          filters: [{ property: "total_spend", operator: "gt", value: "0" }]
        },
        createdAt: 0,
        updatedAt: 0
      };
    }
    return audiences;
  }

  export function isInAudience(nk: nkruntime.Nakama, userId: string, audienceId: string): boolean {
    var audiences = getAudienceDefinitions(nk);
    var def = audiences[audienceId];
    if (!def) return false;

    if (def.excludeIds && def.excludeIds.indexOf(userId) >= 0) return false;
    if (def.includeIds && def.includeIds.indexOf(userId) >= 0) return true;

    if (def.samplePct !== undefined && def.samplePct < 100) {
      var hash = 0;
      var seed = userId + ":" + audienceId;
      for (var c = 0; c < seed.length; c++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(c);
        hash = hash & 0x7FFFFFFF;
      }
      if ((hash % 100) >= def.samplePct) return false;
    }

    var props = SatoriIdentities.getAllProperties(nk, userId);
    var allProps: { [key: string]: string } = {};
    for (var k in props.defaultProperties) allProps[k] = props.defaultProperties[k];
    for (var ck in props.customProperties) allProps[ck] = props.customProperties[ck];
    for (var pk in props.computedProperties) allProps[pk] = props.computedProperties[pk];

    // Add computed time-based properties
    if (allProps["first_seen"]) {
      var firstSeen = new Date(allProps["first_seen"]).getTime();
      var daysSince = Math.floor((Date.now() - firstSeen) / 86400000);
      allProps["first_seen_days_ago"] = String(daysSince);
    }

    return evaluateRule(allProps, def.rule);
  }

  function evaluateRule(props: { [key: string]: string }, rule: Satori.AudienceRule): boolean {
    var results: boolean[] = [];

    if (rule.filters) {
      for (var i = 0; i < rule.filters.length; i++) {
        results.push(evaluateFilter(props, rule.filters[i]));
      }
    }

    if (rule.rules) {
      for (var j = 0; j < rule.rules.length; j++) {
        results.push(evaluateRule(props, rule.rules[j]));
      }
    }

    if (results.length === 0) return true;

    if (rule.combinator === "or") {
      for (var r = 0; r < results.length; r++) {
        if (results[r]) return true;
      }
      return false;
    }

    for (var a = 0; a < results.length; a++) {
      if (!results[a]) return false;
    }
    return true;
  }

  function evaluateFilter(props: { [key: string]: string }, filter: Satori.AudienceFilter): boolean {
    var propValue = props[filter.property];

    switch (filter.operator) {
      case "exists": return propValue !== undefined && propValue !== null;
      case "not_exists": return propValue === undefined || propValue === null;
      case "eq": return propValue === filter.value;
      case "neq": return propValue !== filter.value;
      case "gt": return parseFloat(propValue || "0") > parseFloat(filter.value);
      case "gte": return parseFloat(propValue || "0") >= parseFloat(filter.value);
      case "lt": return parseFloat(propValue || "0") < parseFloat(filter.value);
      case "lte": return parseFloat(propValue || "0") <= parseFloat(filter.value);
      case "contains": return (propValue || "").indexOf(filter.value) >= 0;
      case "not_contains": return (propValue || "").indexOf(filter.value) < 0;
      case "in": return filter.value.split(",").indexOf(propValue || "") >= 0;
      case "not_in": return filter.value.split(",").indexOf(propValue || "") < 0;
      case "matches":
        try { return new RegExp(filter.value).test(propValue || ""); }
        catch (_) { return false; }
      default: return false;
    }
  }

  // ---- RPCs ----

  function rpcGetMemberships(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var audiences = getAudienceDefinitions(nk);
    var memberships: string[] = [];

    for (var id in audiences) {
      if (isInAudience(nk, userId, id)) {
        memberships.push(id);
      }
    }

    return RpcHelpers.successResponse({ audiences: memberships });
  }

  function rpcCompute(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var targetUserId = data.userId || ctx.userId;
    if (!targetUserId) return RpcHelpers.errorResponse("userId required");

    var audiences = getAudienceDefinitions(nk);
    var memberships: string[] = [];

    for (var id in audiences) {
      if (isInAudience(nk, targetUserId, id)) {
        memberships.push(id);
      }
    }

    return RpcHelpers.successResponse({ userId: targetUserId, audiences: memberships });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_audiences_get_memberships", rpcGetMemberships);
    initializer.registerRpc("satori_audiences_compute", rpcCompute);
  }
}
