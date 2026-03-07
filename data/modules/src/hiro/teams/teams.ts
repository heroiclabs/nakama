namespace HiroTeams {

  interface TeamData {
    groupId: string;
    stats: { [statId: string]: number };
    wallet: { [currencyId: string]: number };
    achievements: { [achievementId: string]: { count: number; completedAt?: number; claimedAt?: number } };
  }

  function getTeamData(nk: nkruntime.Nakama, groupId: string): TeamData {
    var data = Storage.readSystemJson<TeamData>(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + groupId);
    return data || { groupId: groupId, stats: {}, wallet: {}, achievements: {} };
  }

  function saveTeamData(nk: nkruntime.Nakama, data: TeamData): void {
    Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + data.groupId, data);
  }

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.groupId) return RpcHelpers.errorResponse("groupId required");

    var teamData = getTeamData(nk, data.groupId);
    return RpcHelpers.successResponse({ team: teamData });
  }

  function rpcUpdateStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.groupId || !data.statId) return RpcHelpers.errorResponse("groupId and statId required");

    var teamData = getTeamData(nk, data.groupId);
    var current = teamData.stats[data.statId] || 0;
    teamData.stats[data.statId] = current + (data.value || 1);
    saveTeamData(nk, teamData);

    return RpcHelpers.successResponse({ statId: data.statId, value: teamData.stats[data.statId] });
  }

  function rpcGetWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.groupId) return RpcHelpers.errorResponse("groupId required");

    var teamData = getTeamData(nk, data.groupId);
    return RpcHelpers.successResponse({ wallet: teamData.wallet });
  }

  function rpcUpdateWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.groupId || !data.currencyId || data.amount === undefined) {
      return RpcHelpers.errorResponse("groupId, currencyId, and amount required");
    }

    var teamData = getTeamData(nk, data.groupId);
    var current = teamData.wallet[data.currencyId] || 0;
    var newBalance = current + data.amount;
    if (newBalance < 0) return RpcHelpers.errorResponse("Insufficient team funds");

    teamData.wallet[data.currencyId] = newBalance;
    saveTeamData(nk, teamData);

    return RpcHelpers.successResponse({ currencyId: data.currencyId, balance: newBalance });
  }

  function rpcAchievements(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.groupId) return RpcHelpers.errorResponse("groupId required");

    var teamData = getTeamData(nk, data.groupId);
    return RpcHelpers.successResponse({ achievements: teamData.achievements });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_teams_get", rpcGet);
    initializer.registerRpc("hiro_teams_stats", rpcUpdateStats);
    initializer.registerRpc("hiro_teams_wallet_get", rpcGetWallet);
    initializer.registerRpc("hiro_teams_wallet_update", rpcUpdateWallet);
    initializer.registerRpc("hiro_teams_achievements", rpcAchievements);
  }
}
