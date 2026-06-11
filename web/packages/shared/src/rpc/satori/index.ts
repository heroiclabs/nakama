import { callRpc, type RpcOptions } from "../client";
import type { SatoriSystem } from "../../lib/constants";
import type { Audience, Experiment, SatoriMessage } from "../types";

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
  gameId?: string,
): Promise<Record<string, unknown>> {
  return callRpc("satori_config_get", { system, game_id: gameId }, opts).then((value) => {
    const data = unwrapData<{ config?: Record<string, unknown> }>(value);
    return data.config ?? (data as Record<string, unknown>);
  });
}

export function setSatoriConfig(
  system: SatoriSystem,
  config: Record<string, unknown>,
  opts: RpcOptions,
  gameId?: string,
): Promise<void> {
  return callRpc("satori_config_set", { system, game_id: gameId, config_json: JSON.stringify(config) }, opts);
}

export interface FeatureFlag {
  name: string;
  value: string;
  enabled: boolean;
  audiences?: string[];
  description?: string;
  updated_at?: string;
}

export function getAllFlags(opts: RpcOptions, gameId?: string): Promise<{ flags: FeatureFlag[] }> {
  return callRpc("admin_satori_flags_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ flags: FeatureFlag[] }>(value),
  );
}

export function toggleFlag(
  params: {
    name: string;
    enabled?: boolean;
    value?: string;
    audiences_json?: string;
    game_id?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_flags_toggle", params, opts);
}

export function getAllExperiments(opts: RpcOptions, gameId?: string): Promise<{ experiments: Experiment[] }> {
  return callRpc("admin_satori_experiments_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ experiments: Experiment[] }>(value),
  );
}

export function setupExperiment(
  experiment: {
    id: string;
    name: string;
    variants_json: string;
    enabled?: boolean;
    audiences_json?: string;
    game_id?: string;
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
  gameId?: string,
): Promise<{ events: LiveEvent[] }> {
  return callRpc("admin_satori_live_events_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ events: LiveEvent[] }>(value),
  );
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
    game_id?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_live_event_schedule", event, opts);
}

export function listAudiences(opts: RpcOptions, gameId?: string): Promise<any> {
  return callRpc("admin_satori_audiences_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ audiences?: Audience[] }>(value),
  );
}

export function listMessages(opts: RpcOptions, gameId?: string): Promise<{ messages?: SatoriMessage[] }> {
  return callRpc("admin_satori_messages_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ messages?: SatoriMessage[] }>(value),
  );
}

export function broadcastMessage(
  message: {
    title: string;
    body?: string;
    audience_id?: string;
    schedule_at?: number;
    rewards_json?: string;
    game_id?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("admin_satori_message_broadcast", message, opts);
}

/* ── Experiment results (conversions + significance) ──────────────── */

export interface ExperimentVariantResult {
  id: string;
  name: string;
  isControl: boolean;
  exposures: number;
  conversions: number;
  rate: number;
}

export interface ExperimentComparison {
  variantId: string;
  controlId: string;
  lift: number;
  zScore: number | null;
  pValue: number | null;
  significant: boolean;
  confidence: number | null;
}

export interface ExperimentResults {
  experimentId: string;
  name: string;
  status: string;
  goalEvent: string;
  winnerVariantId: string | null;
  variants: ExperimentVariantResult[];
  comparisons: ExperimentComparison[];
  suggestedWinner: string | null;
  recommendation: string;
  scan: {
    assignmentObjectsScanned: number;
    assignmentsTruncated: boolean;
    eventRecordsScanned: number;
    eventsTruncated: boolean;
    totalGoalEvents: number;
  };
}

export function getExperimentResults(
  params: { experimentId: string; goal_event?: string; game_id?: string },
  opts: RpcOptions,
): Promise<ExperimentResults> {
  return callRpc("satori_experiments_results", params, opts).then((value) =>
    unwrapData<ExperimentResults>(value),
  );
}

export function declareExperimentWinner(
  params: { experimentId: string; variantId: string; game_id?: string },
  opts: RpcOptions,
) {
  return callRpc("satori_experiments_declare_winner", params, opts);
}

/* ── Event debugger (live tail + search) ──────────────────────────── */

export interface DebuggerEvent {
  name: string;
  userId: string;
  timestampMs: number;
  metadata: Record<string, unknown>;
  external: boolean;
}

export interface DebuggerNameStat {
  name: string;
  count: number;
  hasSchema: boolean;
}

export interface EventTailResponse {
  events: DebuggerEvent[];
  names: DebuggerNameStat[];
  bufferSize: number;
  bufferMax: number;
}

export interface EventSearchResponse {
  events: DebuggerEvent[];
  names: DebuggerNameStat[];
  scannedPages: number;
  scannedRecords: number;
  truncated: boolean;
  nextCursor: string | null;
}

export interface EventDebuggerFilters {
  limit?: number;
  name?: string;
  name_contains?: string;
  user_id?: string;
  since_ms?: number;
  until_ms?: number;
  external_only?: boolean;
}

export function tailEvents(
  filters: EventDebuggerFilters,
  opts: RpcOptions,
): Promise<EventTailResponse> {
  return callRpc("satori_events_tail", filters, opts).then((value) =>
    unwrapData<EventTailResponse>(value),
  );
}

export function searchEvents(
  filters: EventDebuggerFilters & { max_pages?: number; cursor?: string },
  opts: RpcOptions,
): Promise<EventSearchResponse> {
  return callRpc("satori_events_search", filters, opts).then((value) =>
    unwrapData<EventSearchResponse>(value),
  );
}

export function upsertTaxonomySchema(
  schema: {
    name: string;
    description?: string;
    category?: string;
    requiredMetadata?: string[];
    optionalMetadata?: string[];
  },
  opts: RpcOptions,
) {
  return callRpc("satori_taxonomy_upsert", schema, opts);
}

/* ── Audience size estimate ───────────────────────────────────────── */

export interface AudienceEstimate {
  audienceId: string;
  name: string;
  estimatedSize: number;
  scannedIdentities: number;
  matchRate: number;
  sampleUserIds: string[];
  truncated: boolean;
}

export function estimateAudience(
  params: { audienceId: string; game_id?: string; max_pages?: number },
  opts: RpcOptions,
): Promise<AudienceEstimate> {
  return callRpc("satori_audiences_estimate", params, opts).then((value) =>
    unwrapData<AudienceEstimate>(value),
  );
}

/* ── Identity inspector ───────────────────────────────────────────── */

export interface IdentityTimelineEvent {
  name: string;
  timestampMs: number;
  metadata: Record<string, unknown>;
}

export interface IdentityExperimentAssignment {
  experimentId: string;
  variantId: string;
  assignedAtMs: number;
  scope: string;
}

export interface IdentityInspection {
  userId: string;
  account: {
    username: string;
    displayName: string;
    createTime: number;
    online: boolean;
  } | null;
  properties: {
    defaultProperties: Record<string, string>;
    customProperties: Record<string, string>;
    computedProperties: Record<string, string>;
  };
  timeline: IdentityTimelineEvent[];
  timelineTotal: number;
  audiences: string[];
  audiencesEvaluated: number;
  experiments: IdentityExperimentAssignment[];
}

export function inspectIdentity(
  params: { user_id: string; game_id?: string; timeline_limit?: number },
  opts: RpcOptions,
): Promise<IdentityInspection> {
  return callRpc("satori_identity_inspect", params, opts).then((value) =>
    unwrapData<IdentityInspection>(value),
  );
}

/* ── Funnels ──────────────────────────────────────────────────────── */

export interface FunnelDefinition {
  id: string;
  name: string;
  description?: string;
  steps: string[];
  windowHours?: number;
  createdAt: number;
  updatedAt: number;
}

export interface FunnelStepResult {
  name: string;
  users: number;
  conversionFromStart: number;
  conversionFromPrevious?: number;
}

export interface FunnelResult {
  steps: FunnelStepResult[];
  entered: number;
  completed: number;
  overallConversion: number;
  byVariant: Record<string, FunnelStepResult[]> | null;
  scannedRecords: number;
  truncated: boolean;
  sinceMs: number;
  untilMs: number;
  experimentId: string | null;
}

export function listFunnels(opts: RpcOptions, gameId?: string): Promise<{ funnels: FunnelDefinition[] }> {
  return callRpc("satori_funnels_list", { game_id: gameId }, opts).then((value) =>
    unwrapData<{ funnels: FunnelDefinition[] }>(value),
  );
}

export function saveFunnel(
  params: {
    id: string;
    name: string;
    description?: string;
    steps: string[];
    windowHours?: number;
    game_id?: string;
  },
  opts: RpcOptions,
) {
  return callRpc("satori_funnels_save", params, opts);
}

export function deleteFunnel(params: { id: string; game_id?: string }, opts: RpcOptions) {
  return callRpc("satori_funnels_delete", params, opts);
}

export function computeFunnel(
  params: {
    funnelId?: string;
    steps?: string[];
    since_ms?: number;
    until_ms?: number;
    window_hours?: number;
    experiment_id?: string;
    game_id?: string;
  },
  opts: RpcOptions,
): Promise<FunnelResult> {
  return callRpc("satori_funnels_compute", params, opts).then((value) =>
    unwrapData<FunnelResult>(value),
  );
}

/* ── Retention ────────────────────────────────────────────────────── */

export interface RetentionCohort {
  date: string;
  size: number;
  d1Rate: number | null;
  d3Rate: number | null;
  d7Rate: number | null;
}

export interface RetentionVariantRow {
  variantId: string;
  size: number;
  d1Rate: number | null;
  d3Rate: number | null;
  d7Rate: number | null;
}

export interface RetentionResult {
  windowDays: number;
  sinceMs: number;
  experimentId: string | null;
  cohorts: RetentionCohort[];
  byVariant: RetentionVariantRow[] | null;
  totalUsers: number;
  scannedRecords: number;
  truncated: boolean;
}

export function computeRetention(
  params: { days?: number; experiment_id?: string; game_id?: string },
  opts: RpcOptions,
): Promise<RetentionResult> {
  return callRpc("satori_retention_compute", params, opts).then((value) =>
    unwrapData<RetentionResult>(value),
  );
}

/* ── Satori Cloud mirror kill-switch ──────────────────────────────── */

export interface SatoriDirectStatus {
  enabled: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

export function getSatoriDirectStatus(opts: RpcOptions): Promise<SatoriDirectStatus> {
  return callRpc("satori_direct_status", {}, opts).then((value) =>
    unwrapData<SatoriDirectStatus>(value),
  );
}

export function toggleSatoriDirect(enabled: boolean, opts: RpcOptions) {
  return callRpc("satori_direct_toggle", { enabled }, opts);
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
