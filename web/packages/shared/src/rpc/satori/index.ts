import { callRpc, type RpcOptions } from "../client";
import type { SatoriSystem } from "../../lib/constants";

export function satoriRpc<P = Record<string, unknown>, R = unknown>(
  system: string,
  action: string,
  payload: P,
  opts: RpcOptions,
): Promise<R> {
  return callRpc<P, R>(`satori_${system}_${action}`, payload, opts);
}

export function getSatoriConfig(
  system: SatoriSystem,
  opts: RpcOptions,
): Promise<Record<string, unknown>> {
  return callRpc("satori_config_get", { system }, opts);
}

export function setSatoriConfig(
  system: SatoriSystem,
  config: Record<string, unknown>,
  opts: RpcOptions,
): Promise<void> {
  return callRpc("satori_config_set", { system, config_json: JSON.stringify(config) }, opts);
}

export interface FeatureFlag {
  name: string;
  value: string;
  enabled: boolean;
  audiences?: string[];
  description?: string;
  updated_at?: string;
}

export function getAllFlags(opts: RpcOptions): Promise<{ flags: FeatureFlag[] }> {
  return satoriRpc("flags", "get_all", {}, opts);
}

export function toggleFlag(
  params: {
    name: string;
    enabled?: boolean;
    value?: string;
    audiences_json?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_flags_toggle", params, opts);
}

export function getAllExperiments(opts: RpcOptions) {
  return satoriRpc("experiments", "get_all", {}, opts);
}

export function setupExperiment(
  experiment: {
    id: string;
    name: string;
    variants_json: string;
    enabled?: boolean;
    audiences_json?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_experiment_setup", experiment, opts);
}

export interface LiveEvent {
  id: string;
  name: string;
  description?: string;
  start_time_sec?: number;
  end_time_sec?: number;
  rewards_json?: string;
  audiences?: string[];
  enabled: boolean;
}

export function listLiveEvents(
  opts: RpcOptions,
): Promise<{ events: LiveEvent[] }> {
  return satoriRpc("live_events", "list", {}, opts);
}

export function scheduleLiveEvent(
  event: {
    id: string;
    name: string;
    description?: string;
    start_time_sec?: number;
    end_time_sec?: number;
    rewards_json?: string;
    audiences_json?: string;
    enabled?: boolean;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_live_event_schedule", event, opts);
}

export function listAudiences(opts: RpcOptions) {
  return satoriRpc("audiences", "list", {}, opts);
}

export function listMessages(opts: RpcOptions) {
  return satoriRpc("messages", "list", {}, opts);
}

export function broadcastMessage(
  message: {
    title: string;
    body?: string;
    audience_id?: string;
    schedule_at?: number;
    rewards_json?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_message_broadcast", message, opts);
}

export function getMetrics(opts: RpcOptions) {
  return satoriRpc("metrics", "get", {}, opts);
}

export function setMetricAlert(
  alert: {
    metric_id: string;
    name: string;
    threshold: number;
    operator: "gt" | "lt" | "gte" | "lte";
  },
  opts: RpcOptions,
) {
  return callRpc("satori_metrics_set_alert", alert, opts);
}

export function getEventsTimeline(
  userId: string,
  opts: RpcOptions & { limit?: number },
) {
  return callRpc(
    "admin_events_timeline",
    { userId, ...(opts.limit && { limit: opts.limit }) },
    opts,
  );
}
