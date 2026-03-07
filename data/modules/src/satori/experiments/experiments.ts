namespace SatoriExperiments {

  function getExperiments(nk: nkruntime.Nakama): { [id: string]: Satori.ExperimentDefinition } {
    return ConfigLoader.loadSatoriConfig<{ [id: string]: Satori.ExperimentDefinition }>(nk, "experiments", {});
  }

  function getUserExperiments(nk: nkruntime.Nakama, userId: string): Satori.UserExperiments {
    var data = Storage.readJson<Satori.UserExperiments>(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId);
    return data || { assignments: {} };
  }

  function saveUserExperiments(nk: nkruntime.Nakama, userId: string, data: Satori.UserExperiments): void {
    Storage.writeJson(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId, data);
  }

  function deterministicAssign(userId: string, experimentId: string, variants: Satori.ExperimentVariant[], splitKey?: string): string {
    var totalWeight = 0;
    for (var i = 0; i < variants.length; i++) {
      totalWeight += variants[i].weight;
    }
    if (totalWeight <= 0) return variants[0].id;

    var seed = userId + ":" + experimentId;
    if (splitKey === "random") {
      seed = userId + ":" + experimentId + ":" + Date.now();
    }

    var hash = 0;
    for (var c = 0; c < seed.length; c++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(c);
      hash = hash & 0x7FFFFFFF;
    }
    var bucket = hash % totalWeight;
    var cumulative = 0;
    for (var j = 0; j < variants.length; j++) {
      cumulative += variants[j].weight;
      if (bucket < cumulative) return variants[j].id;
    }
    return variants[variants.length - 1].id;
  }

  function isExperimentActive(def: any): boolean {
    if (def.status !== "running") return false;
    var now = Math.floor(Date.now() / 1000);
    if (def.startAt && now < def.startAt) return false;
    if (def.endAt && now > def.endAt) return false;
    return true;
  }

  function isWithinAdmissionDeadline(def: any): boolean {
    if (!def.admissionDeadline) return true;
    return Math.floor(Date.now() / 1000) <= def.admissionDeadline;
  }

  export function getVariant(nk: nkruntime.Nakama, userId: string, experimentId: string): Satori.ExperimentVariant | null {
    var experiments = getExperiments(nk);
    var def = experiments[experimentId] as any;
    if (!def || !isExperimentActive(def)) return null;
    if (!def.variants || def.variants.length === 0) return null;

    if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId)) {
      return null;
    }

    var userExp = getUserExperiments(nk, userId);
    var assignment = userExp.assignments[experimentId];

    if (!assignment) {
      if (!isWithinAdmissionDeadline(def)) return null;

      var variantId = deterministicAssign(userId, experimentId, def.variants, def.splitKey);
      assignment = {
        experimentId: experimentId,
        variantId: variantId,
        assignedAt: Math.floor(Date.now() / 1000)
      };
      userExp.assignments[experimentId] = assignment;
      saveUserExperiments(nk, userId, userExp);
    }

    if (def.lockParticipation && assignment.locked) {
      // locked assignments cannot change
    }

    var found: Satori.ExperimentVariant | null = null;
    for (var i = 0; i < def.variants.length; i++) {
      if (def.variants[i].id === assignment.variantId) { found = def.variants[i]; break; }
    }

    // Multi-phase: check if current phase has different variants
    if (def.phases && Array.isArray(def.phases)) {
      var now = Math.floor(Date.now() / 1000);
      for (var p = 0; p < def.phases.length; p++) {
        var phase = def.phases[p];
        if (now >= phase.startAt && now <= phase.endAt && phase.variants) {
          for (var pv = 0; pv < phase.variants.length; pv++) {
            if (phase.variants[pv].id === assignment.variantId) {
              found = phase.variants[pv];
              break;
            }
          }
          break;
        }
      }
    }

    return found;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var experiments = getExperiments(nk);

    var result: any[] = [];
    for (var id in experiments) {
      var def = experiments[id] as any;
      if (!isExperimentActive(def)) continue;
      if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId)) continue;

      var variant = getVariant(nk, userId, id);
      result.push({
        id: id,
        name: def.name,
        description: def.description,
        type: def.experimentType || "custom",
        variant: variant ? { id: variant.id, name: variant.name, config: variant.config } : null,
        startAt: def.startAt,
        endAt: def.endAt,
        goalMetric: def.goalMetric
      });
    }

    return RpcHelpers.successResponse({ experiments: result });
  }

  function rpcGetVariant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.experimentId) return RpcHelpers.errorResponse("experimentId required");

    var variant = getVariant(nk, userId, data.experimentId);
    return RpcHelpers.successResponse({ variant: variant });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_experiments_get", rpcGet);
    initializer.registerRpc("satori_experiments_get_variant", rpcGetVariant);
  }
}
