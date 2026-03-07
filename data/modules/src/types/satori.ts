namespace Satori {

  // ---- Event Capture ----

  export interface CapturedEvent {
    name: string;
    timestamp: number;
    metadata?: { [key: string]: string };
  }

  // ---- Identities ----

  export interface IdentityProperties {
    defaultProperties: { [key: string]: string };
    customProperties: { [key: string]: string };
    computedProperties: { [key: string]: string };
  }

  // ---- Audiences ----

  export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains" | "exists" | "not_exists" | "in" | "not_in" | "matches";
  export type FilterCombinator = "and" | "or";

  export interface AudienceFilter {
    property: string;
    operator: FilterOperator;
    value: string;
  }

  export interface AudienceRule {
    combinator: FilterCombinator;
    filters: AudienceFilter[];
    rules?: AudienceRule[];
  }

  export interface AudienceDefinition {
    id: string;
    name: string;
    description?: string;
    rule: AudienceRule;
    includeIds?: string[];
    excludeIds?: string[];
    samplePct?: number;
    createdAt: number;
    updatedAt: number;
  }

  // ---- Feature Flags ----

  export interface FlagDefinition {
    name: string;
    value: string;
    description?: string;
    conditionsByAudience?: { [audienceId: string]: string };
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
  }

  export interface FlagsConfig {
    flags: { [id: string]: FlagDefinition };
  }

  export interface Flag {
    name: string;
    value: string;
  }

  // ---- Experiments ----

  export type ExperimentStatus = "draft" | "running" | "completed" | "archived";

  export interface ExperimentVariant {
    id: string;
    name: string;
    config: { [key: string]: string };
    weight: number;
  }

  export interface ExperimentDefinition {
    id: string;
    name: string;
    description?: string;
    status: ExperimentStatus;
    audienceId?: string;
    variants: ExperimentVariant[];
    goalMetric?: string;
    startAt?: number;
    endAt?: number;
    createdAt: number;
    updatedAt: number;
  }

  export interface ExperimentAssignment {
    experimentId: string;
    variantId: string;
    assignedAt: number;
    locked?: boolean;
  }

  export interface UserExperiments {
    assignments: { [experimentId: string]: ExperimentAssignment };
  }

  // ---- Live Events ----

  export type LiveEventStatus = "upcoming" | "active" | "ended";

  export interface LiveEventDefinition {
    id: string;
    name: string;
    description?: string;
    audienceId?: string;
    startAt: number;
    endAt: number;
    recurrenceCron?: string;
    reward?: Hiro.Reward;
    config?: { [key: string]: string };
    createdAt: number;
    updatedAt: number;
  }

  export interface LiveEventRun {
    eventId: string;
    runId: string;
    startAt: number;
    endAt: number;
    status: LiveEventStatus;
  }

  export interface UserLiveEventState {
    eventId: string;
    joinedAt?: number;
    claimedAt?: number;
  }

  // ---- Messages ----

  export interface MessageDefinition {
    id: string;
    title: string;
    body?: string;
    imageUrl?: string;
    metadata?: { [key: string]: string };
    reward?: Hiro.Reward;
    audienceId?: string;
    scheduleAt?: number;
    expiresAt?: number;
    createdAt: number;
  }

  export interface UserMessage {
    id: string;
    messageDefId: string;
    title: string;
    body?: string;
    imageUrl?: string;
    metadata?: { [key: string]: string };
    reward?: Hiro.Reward;
    createdAt: number;
    expiresAt?: number;
    readAt?: number;
    consumedAt?: number;
  }

  export interface UserMessages {
    messages: UserMessage[];
  }

  // ---- Metrics ----

  export type MetricAggregation = "count" | "sum" | "avg" | "min" | "max" | "unique";

  export interface MetricDefinition {
    id: string;
    name: string;
    eventName: string;
    metadataField?: string;
    aggregation: MetricAggregation;
    windowSec?: number;
  }

  export interface MetricResult {
    metricId: string;
    value: number;
    computedAt: number;
  }

  // ---- Combined config ----

  export interface SystemConfigs {
    audiences?: { [id: string]: AudienceDefinition };
    flags?: FlagsConfig;
    experiments?: { [id: string]: ExperimentDefinition };
    liveEvents?: { [id: string]: LiveEventDefinition };
    messages?: { [id: string]: MessageDefinition };
    metrics?: { [id: string]: MetricDefinition };
  }
}
