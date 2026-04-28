import { callRpc, type RpcOptions } from "../client";
import type { HiroSystem } from "../../lib/constants";

function unwrapData<T>(value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "success" in value &&
    "data" in value
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export function hiroRpc<P = Record<string, unknown>, R = unknown>(
  system: string,
  action: string,
  payload: P,
  opts: RpcOptions,
): Promise<R> {
  return callRpc<P, R>(`hiro_${system}_${action}`, payload, opts);
}

export function getHiroConfig(
  system: HiroSystem,
  opts: RpcOptions,
  gameId?: string,
): Promise<Record<string, unknown>> {
  return callRpc("admin_config_get", { system, game_id: gameId }, opts).then((value) => {
    const data = unwrapData<{ config?: Record<string, unknown> }>(value);
    return data.config ?? (data as Record<string, unknown>);
  });
}

export function setHiroConfig(
  system: HiroSystem,
  config: Record<string, unknown>,
  opts: RpcOptions,
  gameId?: string,
): Promise<void> {
  return callRpc("admin_config_set", { system, game_id: gameId, config_json: JSON.stringify(config) }, opts);
}

export function listAchievements(opts: RpcOptions) {
  return hiroRpc("achievements", "list", {}, opts);
}

export function claimAchievement(id: string, opts: RpcOptions) {
  return hiroRpc("achievements", "claim", { id }, opts);
}

export function getEnergy(opts: RpcOptions) {
  return hiroRpc("energy", "get", {}, opts);
}

export function spendEnergy(amount: number, opts: RpcOptions) {
  return hiroRpc("energy", "spend", { count: amount }, opts);
}

export function listStore(opts: RpcOptions) {
  return hiroRpc("store", "list", {}, opts);
}

export function purchaseStoreItem(itemId: string, opts: RpcOptions) {
  return hiroRpc("store", "purchase", { id: itemId }, opts);
}

export function getProgression(opts: RpcOptions) {
  return hiroRpc("progression", "get", {}, opts);
}

export function listStreaks(opts: RpcOptions) {
  return hiroRpc("streaks", "list", {}, opts);
}

export function claimStreak(id: string, opts: RpcOptions) {
  return hiroRpc("streaks", "claim", { id }, opts);
}

export function updateStreak(id: string, opts: RpcOptions) {
  return hiroRpc("streaks", "update", { id }, opts);
}

export function listChallenges(opts: RpcOptions) {
  return hiroRpc("challenges", "list", {}, opts);
}

export function claimChallenge(id: string, opts: RpcOptions) {
  return hiroRpc("challenges", "claim", { id }, opts);
}

export function listInventory(opts: RpcOptions) {
  return hiroRpc("inventory", "list", {}, opts);
}

export function grantInventoryItem(
  itemId: string,
  quantity: number,
  opts: RpcOptions,
) {
  return hiroRpc("inventory", "grant", { id: itemId, count: quantity }, opts);
}

export function consumeInventoryItem(
  itemId: string,
  instanceId: string,
  count: number,
  opts: RpcOptions,
) {
  return hiroRpc("inventory", "consume", { id: itemId, instance_id: instanceId, count }, opts);
}

export function updateInventoryItem(
  itemId: string,
  instanceId: string,
  properties: Record<string, unknown>,
  opts: RpcOptions,
) {
  return hiroRpc("inventory", "update", { id: itemId, instance_id: instanceId, properties }, opts);
}

export function listEventLeaderboards(opts: RpcOptions) {
  return hiroRpc("event_leaderboards", "list", {}, opts);
}

export function submitEventLeaderboardScore(
  id: string,
  score: number,
  opts: RpcOptions,
) {
  return hiroRpc("event_leaderboards", "submit", { id, score }, opts);
}

export function getStats(opts: RpcOptions) {
  return hiroRpc("stats", "get", {}, opts);
}

export function getTutorials(opts: RpcOptions) {
  return hiroRpc("tutorials", "get", {}, opts);
}

export function listIncentives(opts: RpcOptions) {
  return hiroRpc("incentives", "list", {}, opts);
}

export function claimIncentive(id: string, opts: RpcOptions) {
  return hiroRpc("incentives", "claim", { id }, opts);
}
