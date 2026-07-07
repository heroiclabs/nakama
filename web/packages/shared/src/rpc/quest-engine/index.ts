import { callRpc, type RpcOptions } from "../client";

/** One step of a Quest Engine quest — progressed by analytics events. */
export interface QuestEngineStep {
  id: string;
  description: string;
  eventType: string;
  requiredCount: number;
  requiredValue?: number;
  filterField?: string;
  filterValue?: string;
}

export interface QuestEngineReward {
  guaranteed?: {
    currencies?: Record<string, number>;
    items?: Record<string, number>;
    energies?: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Quest definition consumed by the in-game Quest Engine (qv_quest_config). */
export interface QuestEngineQuest {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps: QuestEngineStep[];
  reward?: QuestEngineReward;
  expiresAt?: number;
  prerequisiteIds?: string[];
  repeatable?: boolean;
  resetIntervalSec?: number;
  /** Surprise reward: invisible to players until completed; reward auto-grants. */
  hidden?: boolean;
  additionalProperties?: Record<string, string>;
  [key: string]: unknown;
}

export interface QuestEngineConfig {
  quests: Record<string, QuestEngineQuest>;
}

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

/** Reads the Quest Engine config for one game (server-key only RPC). */
export function getQuestEngineConfig(
  gameId: string,
  opts: RpcOptions,
): Promise<QuestEngineConfig> {
  return callRpc("quest_engine_admin_get_config", { gameId }, opts).then(
    (value) => {
      const data = unwrapData<{ config?: QuestEngineConfig }>(value);
      return data.config ?? { quests: {} };
    },
  );
}

/** Saves the full Quest Engine config for one game (server-key only RPC). */
export function saveQuestEngineConfig(
  gameId: string,
  config: QuestEngineConfig,
  opts: RpcOptions,
): Promise<void> {
  return callRpc(
    "quest_engine_admin_save_config",
    { gameId, config },
    opts,
  ).then(() => undefined);
}
