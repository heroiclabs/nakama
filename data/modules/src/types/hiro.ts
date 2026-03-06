namespace Hiro {

  // ---- Shared / Cross-system Types ----

  export interface CurrencyAmount {
    [currencyId: string]: number;
  }

  export interface ItemAmount {
    [itemId: string]: { min: number; max?: number };
  }

  export interface RewardModifier {
    id: string;
    operator: "add" | "multiply";
    value: number;
    durationSec: number;
    expiresAt?: number;
  }

  export interface RewardGrant {
    currencies?: CurrencyAmount;
    items?: ItemAmount;
    energies?: { [energyId: string]: number };
    energyModifiers?: RewardModifier[];
    rewardModifiers?: RewardModifier[];
  }

  export interface Reward {
    guaranteed?: RewardGrant;
    weighted?: WeightedReward[];
    maxRolls?: number;
    maxRepeatRolls?: number;
  }

  export interface WeightedReward extends RewardGrant {
    weight: number;
  }

  export interface ResolvedReward {
    currencies: CurrencyAmount;
    items: { [itemId: string]: number };
    energies: { [energyId: string]: number };
    modifiers: RewardModifier[];
  }

  // ---- Economy ----

  export interface EconomyConfig {
    currencies: { [id: string]: CurrencyConfig };
    donations: { [id: string]: DonationConfig };
    storeItems: { [id: string]: StoreItemConfig };
  }

  export interface CurrencyConfig {
    name: string;
    initialAmount?: number;
    maxAmount?: number;
  }

  export interface DonationConfig {
    name: string;
    description?: string;
    cost: { currencies: CurrencyAmount };
    count: number;
    durationSec: number;
    maxCount: number;
    reward: Reward;
    senderReward?: Reward;
    userContributionMaxCount?: number;
    additionalProperties?: { [key: string]: string };
  }

  export interface StoreItemConfig {
    name: string;
    description?: string;
    category?: string;
    cost: { currencies?: CurrencyAmount };
    reward: Reward;
    availableAt?: number;
    expiresAt?: number;
    maxPurchases?: number;
    additionalProperties?: { [key: string]: string };
  }

  // ---- Inventory ----

  export interface InventoryConfig {
    items: { [id: string]: InventoryItemConfig };
  }

  export interface InventoryItemConfig {
    name: string;
    description?: string;
    category?: string;
    maxCount?: number;
    stackable: boolean;
    consumable: boolean;
    durableSec?: number;
    additionalProperties?: { [key: string]: string };
  }

  export interface InventoryItem {
    id: string;
    count: number;
    properties?: { [key: string]: string };
    stringProperties?: { [key: string]: string };
    numericProperties?: { [key: string]: number };
    acquiredAt: number;
    expiresAt?: number;
  }

  export interface UserInventory {
    items: { [id: string]: InventoryItem };
  }

  // ---- Achievements ----

  export interface AchievementsConfig {
    achievements: { [id: string]: AchievementConfig };
  }

  export interface AchievementConfig {
    name: string;
    description?: string;
    category?: string;
    count: number;
    maxCount?: number;
    resetSchedule?: string;
    autoClaimReward: boolean;
    preconditionIds?: string[];
    reward?: Reward;
    subAchievements?: { [id: string]: SubAchievementConfig };
    additionalProperties?: { [key: string]: string };
  }

  export interface SubAchievementConfig {
    name: string;
    count: number;
    reward?: Reward;
  }

  export interface UserAchievementProgress {
    id: string;
    count: number;
    completedAt?: number;
    claimedAt?: number;
    resetAt?: number;
    subAchievements?: { [id: string]: { count: number; completedAt?: number; claimedAt?: number } };
  }

  export interface UserAchievements {
    achievements: { [id: string]: UserAchievementProgress };
  }

  // ---- Progression ----

  export interface ProgressionConfig {
    levels: ProgressionLevelConfig[];
    maxLevel: number;
    prestigeLevels?: ProgressionLevelConfig[];
  }

  export interface ProgressionLevelConfig {
    level: number;
    xpRequired: number;
    reward?: Reward;
  }

  export interface UserProgression {
    xp: number;
    level: number;
    prestigeLevel?: number;
    totalXpEarned: number;
  }

  // ---- Energy ----

  export interface EnergyConfig {
    energies: { [id: string]: EnergyTypeConfig };
  }

  export interface EnergyTypeConfig {
    name: string;
    maxEnergy: number;
    startCount: number;
    regenTimeSec: number;
    maxOverfill?: number;
  }

  export interface EnergyState {
    current: number;
    maxEnergy: number;
    regenTimeSec: number;
    lastRegenAt: number;
    modifiers?: RewardModifier[];
  }

  export interface UserEnergy {
    energies: { [id: string]: EnergyState };
  }

  // ---- Stats ----

  export interface StatsConfig {
    stats: { [id: string]: StatConfig };
  }

  export interface StatConfig {
    name: string;
    isPublic: boolean;
    defaultValue?: number;
    maxValue?: number;
    aggregation?: "sum" | "max" | "min" | "latest";
  }

  export interface UserStats {
    stats: { [id: string]: number };
  }

  // ---- Streaks ----

  export interface StreaksConfig {
    streaks: { [id: string]: StreakConfig };
  }

  export interface StreakConfig {
    name: string;
    resetIntervalSec: number;
    gracePeriodSec?: number;
    milestones: { [count: string]: Reward };
  }

  export interface UserStreakState {
    count: number;
    lastUpdateAt: number;
    claimedMilestones: string[];
  }

  export interface UserStreaks {
    streaks: { [id: string]: UserStreakState };
  }

  // ---- Event Leaderboards ----

  export interface EventLeaderboardConfig {
    events: { [id: string]: EventLeaderboardEventConfig };
  }

  export interface EventLeaderboardEventConfig {
    name: string;
    description?: string;
    durationSec: number;
    schedule?: string;
    cohortSize?: number;
    operator: "best" | "set" | "incr" | "decr";
    sortOrder: "asc" | "desc";
    tiers: EventLeaderboardTier[];
  }

  export interface EventLeaderboardTier {
    name: string;
    rankMin: number;
    rankMax: number;
    reward: Reward;
  }

  // ---- Store ----

  export interface StoreConfig {
    sections: { [id: string]: StoreSectionConfig };
  }

  export interface StoreSectionConfig {
    name: string;
    items: { [id: string]: StoreOfferConfig };
  }

  export interface StoreOfferConfig {
    name: string;
    description?: string;
    cost: { currencies?: CurrencyAmount; iapProductId?: string };
    reward: Reward;
    availableAt?: number;
    expiresAt?: number;
    maxPurchases?: number;
    personalizer?: string;
    additionalProperties?: { [key: string]: string };
  }

  // ---- Challenges ----

  export interface ChallengesConfig {
    challenges: { [id: string]: ChallengeConfig };
  }

  export interface ChallengeConfig {
    name: string;
    description?: string;
    maxParticipants: number;
    durationSec: number;
    entryCost?: { currencies: CurrencyAmount };
    reward: Reward;
    scoreOperator: "best" | "set" | "incr";
    sortOrder: "asc" | "desc";
  }

  // ---- Teams ----

  export interface TeamsConfig {
    maxMembers: number;
    achievements?: AchievementsConfig;
    stats?: StatsConfig;
  }

  // ---- Tutorials ----

  export interface TutorialsConfig {
    tutorials: { [id: string]: TutorialConfig };
  }

  export interface TutorialConfig {
    name: string;
    steps: TutorialStepConfig[];
    reward?: Reward;
  }

  export interface TutorialStepConfig {
    id: string;
    name: string;
    reward?: Reward;
  }

  export interface UserTutorials {
    tutorials: { [id: string]: { step: number; completedAt?: number } };
  }

  // ---- Unlockables ----

  export interface UnlockablesConfig {
    unlockables: { [id: string]: UnlockableConfig };
  }

  export interface UnlockableConfig {
    name: string;
    description?: string;
    waitTimeSec: number;
    maxSlots: number;
    slotCost?: { currencies: CurrencyAmount };
    reward?: Reward;
  }

  // ---- Auctions ----

  export interface AuctionsConfig {
    categories: string[];
    listingFeePct: number;
    durationSec: number;
    maxActiveListings: number;
  }

  // ---- Incentives ----

  export interface IncentivesConfig {
    referralReward?: Reward;
    referrerReward?: Reward;
    returnBonusDays?: number;
    returnBonus?: Reward;
  }

  // ---- Mailbox ----

  export interface MailboxMessage {
    id: string;
    subject: string;
    body?: string;
    reward?: Reward;
    createdAt: number;
    expiresAt?: number;
    claimedAt?: number;
    readAt?: number;
  }

  export interface UserMailbox {
    messages: MailboxMessage[];
  }

  // ---- Combined config ----

  export interface SystemConfigs {
    economy?: EconomyConfig;
    inventory?: InventoryConfig;
    achievements?: AchievementsConfig;
    progression?: ProgressionConfig;
    energy?: EnergyConfig;
    stats?: StatsConfig;
    streaks?: StreaksConfig;
    eventLeaderboards?: EventLeaderboardConfig;
    store?: StoreConfig;
    challenges?: ChallengesConfig;
    teams?: TeamsConfig;
    tutorials?: TutorialsConfig;
    unlockables?: UnlockablesConfig;
    auctions?: AuctionsConfig;
    incentives?: IncentivesConfig;
  }
}
