export interface NakamaUser {
  id?: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  lang_tag: string;
  location: string;
  timezone: string;
  metadata: Record<string, unknown>;
  create_time: string;
  update_time: string;
  online: boolean;
}

export interface NakamaSession {
  token: string;
  refresh_token: string;
  created: boolean;
}

export interface WalletBalance {
  coins?: number;
  gems?: number;
  [key: string]: number | undefined;
}

export interface LeaderboardRecord {
  leaderboard_id: string;
  owner_id: string;
  username: string;
  score: number;
  subscore: number;
  num_score: number;
  metadata: Record<string, unknown>;
  rank: number;
  create_time: string;
  update_time: string;
}

export interface StorageObject {
  collection: string;
  key: string;
  user_id: string;
  value: Record<string, unknown>;
  version: string;
  permission_read: number;
  permission_write: number;
  create_time: string;
  update_time: string;
}

export interface Notification {
  id: string;
  subject: string;
  content: Record<string, unknown>;
  code: number;
  sender_id: string;
  create_time: string;
  persistent: boolean;
}

export interface NotificationList {
  notifications?: Notification[];
  cacheable_cursor?: string;
}

export interface HealthStatus {
  node: string;
  session_count: number;
  goroutine_count: number;
  status: string;
}

export interface ConsoleAccount {
  user: NakamaUser;
  wallet: string;
  email: string;
  devices: Array<{ id: string }>;
  custom_id: string;
  verify_time: string;
  disable_time: string;
}

/* ---- Hiro Streaks ---- */

export interface StreakReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
}

export interface StreakTier {
  tier: number;
  rewards?: StreakReward;
}

export interface Streak {
  id: string;
  name?: string;
  description?: string;
  count: number;
  count_current_reset: number;
  max_count: number;
  max_count_current_reset: number;
  claim_time_sec: number;
  reset_time_sec: number;
  can_claim: boolean;
  can_reset: boolean;
  rewards?: StreakTier[];
  current_tier?: StreakTier;
  next_tier?: StreakTier;
}

export interface StreakListResponse {
  streaks: Record<string, Streak>;
}

/* ---- Hiro Store ---- */

export interface StoreCost {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
}

export interface StoreReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
}

export interface StoreItem {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  cost?: StoreCost;
  reward?: StoreReward;
  available?: boolean;
  disabled?: boolean;
  unavailable_reason?: string;
  metadata?: Record<string, unknown>;
  start_time_sec?: number;
  end_time_sec?: number;
  purchase_limit?: number;
  purchase_count?: number;
  refresh_time_sec?: number;
}

export interface StoreSection {
  section: string;
  items: StoreItem[];
}

export interface StoreListResponse {
  store?: {
    sections?: Record<string, StoreSection>;
    items?: StoreItem[];
  };
  sections?: Record<string, StoreSection>;
  items?: StoreItem[];
}

/* ---- Hiro Challenges (Quests / Missions) ---- */

export interface ChallengeReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

export interface Challenge {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  current_count: number;
  max_count: number;
  can_claim: boolean;
  claim_time_sec: number;
  start_time_sec?: number;
  end_time_sec?: number;
  reset_time_sec?: number;
  rewards?: ChallengeReward[];
  reward?: ChallengeReward;
  state?: number;
  precondition_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ChallengeListResponse {
  challenges: Record<string, Challenge>;
}

/* ---- Hiro Incentives (Battle Pass) ---- */

export interface IncentiveReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

export interface IncentiveTier {
  tier: number;
  points_required: number;
  free_reward?: IncentiveReward;
  premium_reward?: IncentiveReward;
  free_claimed: boolean;
  premium_claimed: boolean;
}

export interface Incentive {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  current_points: number;
  max_points?: number;
  start_time_sec?: number;
  end_time_sec?: number;
  claim_time_sec?: number;
  can_claim?: boolean;
  is_premium: boolean;
  current_tier: number;
  max_tier?: number;
  tiers: IncentiveTier[];
  metadata?: Record<string, unknown>;
}

export interface IncentiveListResponse {
  incentives: Record<string, Incentive>;
}

/* ---- Hiro Inventory ---- */

export interface InventoryItem {
  id: string;
  instance_id?: string;
  name?: string;
  description?: string;
  category?: string;
  count: number;
  max_count?: number;
  stackable?: boolean;
  consumable?: boolean;
  string_properties?: Record<string, string>;
  numeric_properties?: Record<string, number>;
  properties?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  create_time?: string;
  update_time?: string;
}

export interface InventoryListResponse {
  items: Record<string, InventoryItem>;
}

/* ---- Nakama Leaderboards ---- */

export interface Leaderboard {
  id: string;
  title?: string;
  description?: string;
  category?: number;
  sort_order: number;
  size?: number;
  max_size?: number;
  max_num_score?: number;
  operator?: string;
  metadata?: Record<string, unknown>;
  create_time?: string;
  start_time?: string;
  end_time?: string;
  reset_schedule?: string;
  authoritative?: boolean;
  prev_reset?: string;
  next_reset?: string;
}

export interface LeaderboardRecordList {
  records?: LeaderboardRecord[];
  owner_records?: LeaderboardRecord[];
  next_cursor?: string;
  prev_cursor?: string;
  rank_count?: number;
}

/* ---- Nakama Tournaments ---- */

export interface Tournament {
  id: string;
  title?: string;
  description?: string;
  category?: number;
  sort_order?: number;
  size?: number;
  max_size?: number;
  max_num_score?: number;
  can_enter?: boolean;
  end_active?: number;
  next_reset?: number;
  metadata?: Record<string, unknown>;
  create_time?: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  start_active?: number;
  operator?: string;
  prev_reset?: number;
  authoritative?: boolean;
}

export interface TournamentList {
  tournaments?: Tournament[];
  cursor?: string;
}

export interface TournamentRecordList {
  records?: LeaderboardRecord[];
  owner_records?: LeaderboardRecord[];
  next_cursor?: string;
  prev_cursor?: string;
  rank_count?: number;
}

/* ---- Nakama Friends ---- */

export interface Friend {
  user: NakamaUser;
  state: number;
  update_time?: string;
}

export interface FriendList {
  friends?: Friend[];
  cursor?: string;
}

/* ---- Satori Experiments ---- */

export interface ExperimentVariant {
  name: string;
  weight: number;
  data?: Record<string, unknown>;
}

export interface Experiment {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  audiences?: string[];
  variants: ExperimentVariant[];
  created_at?: string;
  updated_at?: string;
}

/* ---- Satori Audiences ---- */

export interface Audience {
  id: string;
  name?: string;
  description?: string;
  member_count?: number;
  rules?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/* ---- Satori Messages ---- */

export interface SatoriMessage {
  id: string;
  title: string;
  body?: string;
  audience_id?: string;
  schedule_at?: number;
  rewards_json?: string;
  status?: "draft" | "scheduled" | "sent" | "failed";
  created_at?: string;
  updated_at?: string;
}

/* ---- Nakama Groups ---- */

export interface NakamaGroup {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  lang_tag: string;
  metadata: Record<string, unknown>;
  avatar_url: string;
  open: boolean;
  edge_count: number;
  max_count: number;
  create_time: string;
  update_time: string;
}

export interface UserGroup {
  group: NakamaGroup;
  state: number;
}

export interface UserGroupList {
  user_groups: UserGroup[];
  cursor?: string;
}

export interface GroupUser {
  user: NakamaUser;
  state: number;
}

export interface GroupUserList {
  group_users: GroupUser[];
  cursor?: string;
}

export interface GroupList {
  groups: NakamaGroup[];
  cursor?: string;
}

/* ---- Nakama Chat / Channels ---- */

export interface ChannelMessage {
  channel_id: string;
  message_id: string;
  code: number;
  sender_id: string;
  username: string;
  content: string;
  create_time: string;
  update_time: string;
  persistent: boolean;
  room_name?: string;
  group_id?: string;
  user_id_one?: string;
  user_id_two?: string;
}

export interface ChannelMessageList {
  messages: ChannelMessage[];
  next_cursor?: string;
  prev_cursor?: string;
  cacheable_cursor?: string;
}

export interface ChannelPresence {
  user_id: string;
  session_id: string;
  username: string;
  persistence: boolean;
  status?: string;
}

export interface Channel {
  id: string;
  presences: ChannelPresence[];
  self: ChannelPresence;
  room_name?: string;
  group_id?: string;
  user_id_one?: string;
  user_id_two?: string;
}

export interface ChannelPresenceEvent {
  channel_id: string;
  joins: ChannelPresence[];
  leaves: ChannelPresence[];
}

export interface ChannelMessageAck {
  channel_id: string;
  message_id: string;
  code: number;
  username: string;
  create_time: string;
  update_time: string;
  persistent: boolean;
}
