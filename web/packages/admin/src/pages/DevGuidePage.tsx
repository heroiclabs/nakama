import { useState, useRef, useEffect } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ArrowRight,
  Wallet,
  Package,
  Medal,
  TrendingUp,
  Zap,
  BarChart3,
  Flame,
  Trophy,
  ShoppingBag,
  Swords,
  GraduationCap,
  Lock,
  Gavel,
  Gift,
  UsersRound,
  Flag,
  FlaskConical,
  CalendarClock,
  MessageSquare,
  Activity,
  Puzzle,
  Sparkles,
  Server,
  Monitor,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RpcEndpoint {
  id: string;
  method: string;
  description: string;
  payload?: string;
  response?: string;
}

interface FlowStep {
  label: string;
  detail: string;
  color: string;
}

interface SystemGuide {
  id: string;
  name: string;
  icon: React.ElementType;
  category: "hiro" | "satori";
  tagline: string;
  overview: string;
  configSteps: string[];
  clientCode: string;
  rpcs: RpcEndpoint[];
  flow: FlowStep[];
}

/* ------------------------------------------------------------------ */
/*  Hiro System Guides                                                 */
/* ------------------------------------------------------------------ */

const HIRO_GUIDES: SystemGuide[] = [
  {
    id: "economy",
    name: "Economy",
    icon: Wallet,
    category: "hiro",
    tagline: "Currencies, wallets, and reward distribution",
    overview:
      "The Economy system manages all in-game currencies (coins, gems, premium tokens). It handles wallet balances, currency grants, spending, and cross-currency conversions. Every transaction is atomic and server-authoritative, preventing exploits.",
    configSteps: [
      "Define currency types in the Hiro Config editor (Admin > Hiro Config > economy).",
      "Set initial wallet balances for new players in the 'initialize' section.",
      "Configure donation rules, max balances, and exchange rates.",
      "Link economy rewards to other systems (achievements, quests, battle pass tiers).",
      "Test by granting currencies to a test player via the admin Players page.",
    ],
    clientCode: `import { hiro, useAuthStore } from "@nakama/shared";

// Fetch wallet / economy state
const token = useAuthStore.getState().token!;
const opts = { auth: { type: "bearer" as const, token } };

// Read economy config (admin only, uses server key)
const config = await hiro.getHiroConfig("economy", {
  auth: { type: "server-key" },
});

// Player: grant currency after match
await hiro.hiroRpc("economy", "grant", {
  currencies: { coins: 500, gems: 10 },
}, opts);

// Player: spend currency
await hiro.hiroRpc("economy", "spend", {
  currencies: { coins: 200 },
}, opts);`,
    rpcs: [
      { id: "hiro_economy_grant", method: "POST", description: "Grant currencies to a player's wallet", payload: '{ "currencies": { "coins": 100 } }', response: '{ "wallet": { "coins": 600 } }' },
      { id: "hiro_economy_spend", method: "POST", description: "Deduct currencies from wallet (fails if insufficient)", payload: '{ "currencies": { "coins": 50 } }', response: '{ "wallet": { "coins": 550 } }' },
      { id: "hiro_economy_list", method: "POST", description: "List all currency definitions and current balances" },
    ],
    flow: [
      { label: "Define Currencies", detail: "Admin sets up coin/gem types in Hiro Config", color: "bg-blue-500" },
      { label: "Player Action", detail: "Win match, complete quest, or purchase", color: "bg-amber-500" },
      { label: "Server Validates", detail: "Hiro checks rules, max limits, anti-cheat", color: "bg-purple-500" },
      { label: "Wallet Updates", detail: "Atomic balance change, transaction logged", color: "bg-green-500" },
    ],
  },
  {
    id: "inventory",
    name: "Inventory",
    icon: Package,
    category: "hiro",
    tagline: "Items, consumables, and equipment management",
    overview:
      "The Inventory system manages player-owned items — weapons, consumables, cosmetics, materials. Items can be stackable or unique instances with custom properties. Supports granting, consuming, updating properties, and listing all owned items.",
    configSteps: [
      "Define your item catalog in Admin > Hiro Config > inventory.",
      "Set item properties: stackable, max_count, category, rarity, custom metadata.",
      "Configure how items are granted (quest rewards, store purchases, loot drops).",
      "Items can reference economy currencies for purchase prices.",
      "Test by granting items via the admin Players page or the inventory_grant RPC.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List all items in player's inventory
const items = await hiro.listInventory(opts);

// Grant an item (e.g., after loot drop)
await hiro.grantInventoryItem("sword_legendary", 1, opts);

// Consume a consumable item
await hiro.consumeInventoryItem(
  "health_potion",
  "instance_abc123",
  1,
  opts,
);

// Update item properties (e.g., enchantment level)
await hiro.updateInventoryItem(
  "sword_legendary",
  "instance_xyz789",
  { enchant_level: 5, element: "fire" },
  opts,
);`,
    rpcs: [
      { id: "hiro_inventory_list", method: "POST", description: "List all items the player owns" },
      { id: "hiro_inventory_grant", method: "POST", description: "Grant item(s) to a player", payload: '{ "id": "sword_01", "count": 1 }' },
      { id: "hiro_inventory_consume", method: "POST", description: "Consume/use an item instance", payload: '{ "id": "potion", "instance_id": "abc", "count": 1 }' },
      { id: "hiro_inventory_update", method: "POST", description: "Update custom properties on an item instance", payload: '{ "id": "sword_01", "instance_id": "xyz", "properties": {} }' },
    ],
    flow: [
      { label: "Define Catalog", detail: "Admin configures items, rarity, and properties", color: "bg-blue-500" },
      { label: "Grant Item", detail: "Quest reward, store purchase, or loot drop", color: "bg-amber-500" },
      { label: "Player Uses", detail: "Equip, consume, or upgrade in-game", color: "bg-purple-500" },
      { label: "State Synced", detail: "Server-side inventory always authoritative", color: "bg-green-500" },
    ],
  },
  {
    id: "achievements",
    name: "Achievements",
    icon: Medal,
    category: "hiro",
    tagline: "Milestone tracking and badge rewards",
    overview:
      "Achievements track player milestones — first win, 100 kills, level 50, etc. Each achievement has criteria, reward payloads, and visibility rules. Progress updates automatically based on game events; players claim rewards once criteria are met.",
    configSteps: [
      "Define achievements in Admin > Hiro Config > achievements.",
      "Set criteria: count-based (kill 100 enemies), trigger-based (first purchase).",
      "Configure rewards per achievement (currencies, items, XP).",
      "Set visibility: visible, hidden until close, or secret.",
      "Link to Satori audiences for segment-specific achievements.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List all achievements with current progress
const achievements = await hiro.listAchievements(opts);
// Returns: { achievements: [{ id, name, count, max_count, claim_time, ... }] }

// Claim a completed achievement
await hiro.claimAchievement("first_blood", opts);

// Progress is updated server-side when events fire.
// Example: after a match, the server increments "kills" counter
// and the achievement auto-completes when threshold is reached.`,
    rpcs: [
      { id: "hiro_achievements_list", method: "POST", description: "List all achievements and their progress" },
      { id: "hiro_achievements_claim", method: "POST", description: "Claim rewards for a completed achievement", payload: '{ "id": "first_blood" }' },
    ],
    flow: [
      { label: "Configure", detail: "Define criteria, rewards, and visibility in admin", color: "bg-blue-500" },
      { label: "Track Progress", detail: "Game events auto-increment achievement counters", color: "bg-amber-500" },
      { label: "Criteria Met", detail: "Server marks achievement as claimable", color: "bg-purple-500" },
      { label: "Claim Reward", detail: "Player claims and receives reward payload", color: "bg-green-500" },
    ],
  },
  {
    id: "progression",
    name: "Progression",
    icon: TrendingUp,
    category: "hiro",
    tagline: "Levels, XP, and skill tree advancement",
    overview:
      "The Progression system handles player leveling, XP accumulation, and unlock trees. Define XP curves, level thresholds, and what unlocks at each level. Supports multiple progression tracks (player level, battle rank, mastery).",
    configSteps: [
      "Define progression tracks in Admin > Hiro Config > progression.",
      "Set XP curve: linear, exponential, or custom per-level thresholds.",
      "Configure per-level rewards and unlocks.",
      "Optionally link progression to Satori audiences (e.g., 'high_level_players').",
      "Use the Personalizer to create per-segment progression variants.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// Get current progression state
const progression = await hiro.getProgression(opts);
// Returns: { progressions: { "player_level": { count, ... } } }

// XP is granted server-side through the event pipeline.
// When a player completes a match or quest, Hiro's
// progression handler automatically grants XP and
// handles level-ups.`,
    rpcs: [
      { id: "hiro_progression_get", method: "POST", description: "Get all progression tracks and current state" },
      { id: "hiro_progression_update", method: "POST", description: "Advance progression (server-initiated)" },
    ],
    flow: [
      { label: "Define XP Curve", detail: "Set level thresholds and rewards per level", color: "bg-blue-500" },
      { label: "Player Earns XP", detail: "Match results, quests, achievements feed XP", color: "bg-amber-500" },
      { label: "Level Up", detail: "Hiro auto-calculates level from total XP", color: "bg-purple-500" },
      { label: "Unlock Rewards", detail: "New items, modes, or features become available", color: "bg-green-500" },
    ],
  },
  {
    id: "energy",
    name: "Energy",
    icon: Zap,
    category: "hiro",
    tagline: "Action limits, recharge timers, and stamina",
    overview:
      "Energy gates player actions (play a match, open a chest) and recharges over time. Configurable max energy, recharge rate, and overflow rules. Supports multiple energy types and refill via currency or ads.",
    configSteps: [
      "Define energy types in Admin > Hiro Config > energy.",
      "Set max energy, recharge interval (seconds), and starting energy.",
      "Configure refill costs (e.g., 50 gems = full refill).",
      "Set overflow rules: can players exceed max via rewards?",
      "Test energy depletion and recharge in the Player app.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// Get current energy state
const energy = await hiro.getEnergy(opts);
// Returns: { energies: { "stamina": { count, max, refill_sec, ... } } }

// Spend energy before starting a match
await hiro.spendEnergy(1, opts);

// The server handles recharge timers automatically.
// Each time you call getEnergy, it calculates the
// current amount based on elapsed time.`,
    rpcs: [
      { id: "hiro_energy_get", method: "POST", description: "Get current energy levels for all energy types" },
      { id: "hiro_energy_spend", method: "POST", description: "Consume energy units", payload: '{ "count": 1 }' },
    ],
    flow: [
      { label: "Configure", detail: "Set max, recharge rate, and refill costs", color: "bg-blue-500" },
      { label: "Player Spends", detail: "Starting a match consumes 1 energy", color: "bg-amber-500" },
      { label: "Timer Runs", detail: "Server tracks recharge countdown", color: "bg-purple-500" },
      { label: "Energy Refills", detail: "Automatically regenerates over time", color: "bg-green-500" },
    ],
  },
  {
    id: "stats",
    name: "Stats",
    icon: BarChart3,
    category: "hiro",
    tagline: "Player statistics and performance tracking",
    overview:
      "Stats tracks arbitrary numeric values per player — total kills, highest score, matches played, win rate. Stats are server-authoritative, updated via game events, and can be public (visible to other players) or private.",
    configSteps: [
      "Define stat keys in Admin > Hiro Config > stats.",
      "Set stat types: sum, max, min, replace, or set.",
      "Configure visibility: public or private.",
      "Stats update automatically when game events are processed.",
      "View player stats in the admin Players page.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// Get all stats for the current player
const stats = await hiro.getStats(opts);
// Returns: { stats: { "total_kills": { value, ... }, ... } }

// Stats are updated server-side through hooks.
// Example server-side (TypeScript on Nakama):
// afterMatch hook → hiro.statsUpdate(userId, {
//   "total_kills": kills,
//   "matches_played": 1,
//   "highest_score": { operator: "max", value: score }
// });`,
    rpcs: [
      { id: "hiro_stats_get", method: "POST", description: "Get all stat values for the player" },
      { id: "hiro_stats_update", method: "POST", description: "Update stat values (usually server-to-server)" },
    ],
    flow: [
      { label: "Define Stats", detail: "Name stats, set types (sum/max/min)", color: "bg-blue-500" },
      { label: "Game Event", detail: "Match ends, quest completes, purchase made", color: "bg-amber-500" },
      { label: "Server Updates", detail: "Hiro atomically updates stat values", color: "bg-purple-500" },
      { label: "Read Anywhere", detail: "Leaderboards, profiles, achievements reference stats", color: "bg-green-500" },
    ],
  },
  {
    id: "streaks",
    name: "Streaks",
    icon: Flame,
    category: "hiro",
    tagline: "Consecutive play rewards and daily login bonuses",
    overview:
      "Streaks reward players for consecutive daily engagement. Configurable streak windows, reset rules, and escalating reward ladders. Supports multiple streak tracks (daily login, daily win, daily quest).",
    configSteps: [
      "Define streak tracks in Admin > Hiro Config > streaks.",
      "Set the streak window (e.g., 24 hours) and grace period.",
      "Configure escalating rewards per streak day (day 1: 100 coins, day 7: rare item).",
      "Set reset behavior: full reset or partial (e.g., lose 1 day).",
      "Optionally add a 'streak shield' purchasable with premium currency.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List all streak tracks with current state
const streaks = await hiro.listStreaks(opts);
// Returns: { streaks: [{ id, count, claim_time, ... }] }

// Update streak (mark today's engagement)
await hiro.updateStreak("daily_login", opts);

// Claim streak reward
await hiro.claimStreak("daily_login", opts);`,
    rpcs: [
      { id: "hiro_streaks_list", method: "POST", description: "List all streak tracks and current state" },
      { id: "hiro_streaks_update", method: "POST", description: "Mark today's engagement on a streak", payload: '{ "id": "daily_login" }' },
      { id: "hiro_streaks_claim", method: "POST", description: "Claim the current streak reward", payload: '{ "id": "daily_login" }' },
    ],
    flow: [
      { label: "Player Logs In", detail: "Daily visit triggers streak update", color: "bg-blue-500" },
      { label: "Streak Increments", detail: "Day count goes up if within window", color: "bg-amber-500" },
      { label: "Claim Reward", detail: "Player claims escalating daily reward", color: "bg-purple-500" },
      { label: "Miss = Reset", detail: "Missing a day resets (unless shielded)", color: "bg-red-500" },
    ],
  },
  {
    id: "event_leaderboards",
    name: "Event Leaderboards",
    icon: Trophy,
    category: "hiro",
    tagline: "Time-limited competitive rankings",
    overview:
      "Event Leaderboards are temporary leaderboards tied to live events or seasons. They auto-create, run for a fixed duration, and distribute rewards to top players when they expire. Distinct from Nakama's persistent leaderboards.",
    configSteps: [
      "Define event leaderboards in Admin > Hiro Config > event_leaderboards.",
      "Set duration (start/end times), sort order, and score operator (best/set/incr).",
      "Configure tier-based rewards (top 10 get X, top 100 get Y).",
      "Link to a live event in Satori for synchronized scheduling.",
      "Leaderboards auto-reset and distribute rewards when the event ends.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List active event leaderboards
const boards = await hiro.listEventLeaderboards(opts);

// Submit a score
await hiro.submitEventLeaderboardScore(
  "weekend_tournament",
  4500,
  opts,
);`,
    rpcs: [
      { id: "hiro_event_leaderboards_list", method: "POST", description: "List all active event leaderboards" },
      { id: "hiro_event_leaderboards_submit", method: "POST", description: "Submit a score to an event leaderboard", payload: '{ "id": "event_01", "score": 4500 }' },
    ],
    flow: [
      { label: "Event Starts", detail: "Leaderboard goes live with the event", color: "bg-blue-500" },
      { label: "Players Compete", detail: "Scores submitted and ranked in real-time", color: "bg-amber-500" },
      { label: "Event Ends", detail: "Final rankings calculated", color: "bg-purple-500" },
      { label: "Rewards Sent", detail: "Tier-based prizes granted to top players", color: "bg-green-500" },
    ],
  },
  {
    id: "store",
    name: "Store",
    icon: ShoppingBag,
    category: "hiro",
    tagline: "In-app purchases, bundles, and dynamic offers",
    overview:
      "The Store system manages purchasable items — bundles, currency packs, cosmetics, battle passes. Supports multiple payment types (soft currency, premium currency, IAP). Store contents can be personalized per-player via Satori.",
    configSteps: [
      "Define store sections and items in Admin > Hiro Config > store.",
      "Set prices in different currencies (coins, gems, or IAP product IDs).",
      "Configure purchase limits (one-time, daily, weekly).",
      "Add time-limited offers with start/end timestamps.",
      "Use Satori audiences to show different offers to different segments.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List all store items visible to this player
const store = await hiro.listStore(opts);
// Returns: { store: { sections: [...], items: [...] } }

// Purchase an item
await hiro.purchaseStoreItem("starter_bundle", opts);
// Server validates currency, deducts, grants items atomically.`,
    rpcs: [
      { id: "hiro_store_list", method: "POST", description: "List all store sections and purchasable items" },
      { id: "hiro_store_purchase", method: "POST", description: "Purchase a store item", payload: '{ "id": "starter_bundle" }' },
    ],
    flow: [
      { label: "Configure Store", detail: "Define items, prices, limits, and timing", color: "bg-blue-500" },
      { label: "Personalize", detail: "Satori targets offers to player segments", color: "bg-amber-500" },
      { label: "Player Browses", detail: "Store shows personalized, time-limited items", color: "bg-purple-500" },
      { label: "Purchase", detail: "Atomic: deduct currency → grant items → log", color: "bg-green-500" },
    ],
  },
  {
    id: "challenges",
    name: "Challenges",
    icon: Swords,
    category: "hiro",
    tagline: "Timed competitions and tournament brackets",
    overview:
      "Challenges are timed competitive events where players compete on specific objectives. Supports single-player challenges (beat a score) and multiplayer brackets. Challenges have entry requirements, scoring rules, and reward tiers.",
    configSteps: [
      "Define challenges in Admin > Hiro Config > challenges.",
      "Set duration, entry requirements (level, currency cost), and objectives.",
      "Configure scoring: highest score wins, most kills, fastest time.",
      "Set reward tiers for different completion levels.",
      "Schedule challenges to align with Satori live events.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List available challenges
const challenges = await hiro.listChallenges(opts);

// Claim challenge reward after completion
await hiro.claimChallenge("speed_run_weekly", opts);`,
    rpcs: [
      { id: "hiro_challenges_list", method: "POST", description: "List all active and upcoming challenges" },
      { id: "hiro_challenges_claim", method: "POST", description: "Claim reward for a completed challenge", payload: '{ "id": "speed_run_weekly" }' },
    ],
    flow: [
      { label: "Schedule", detail: "Define challenge timing and objectives", color: "bg-blue-500" },
      { label: "Players Enter", detail: "Meet requirements and join the challenge", color: "bg-amber-500" },
      { label: "Compete", detail: "Scores tracked over the challenge duration", color: "bg-purple-500" },
      { label: "Claim Rewards", detail: "Winners receive tier-based prizes", color: "bg-green-500" },
    ],
  },
  {
    id: "tutorials",
    name: "Tutorials",
    icon: GraduationCap,
    category: "hiro",
    tagline: "Guided onboarding and interactive walkthroughs",
    overview:
      "Tutorials guide new players through game mechanics step-by-step. Track completion state per-player so tutorials only show once. Supports branching paths and can gate features until tutorials are completed.",
    configSteps: [
      "Define tutorial sequences in Admin > Hiro Config > tutorials.",
      "Set steps with triggers (tap here, play a match, open inventory).",
      "Configure completion rewards for each tutorial.",
      "Set prerequisite rules (tutorial B requires tutorial A).",
      "Use Satori experiments to A/B test tutorial flows.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// Get tutorial state for the player
const tutorials = await hiro.getTutorials(opts);
// Returns: { tutorials: { "onboarding": { state, step, ... } } }

// Tutorials advance server-side when trigger conditions are met.
// The client reads state and renders the appropriate UI overlay.`,
    rpcs: [
      { id: "hiro_tutorials_get", method: "POST", description: "Get all tutorial states and progress" },
      { id: "hiro_tutorials_update", method: "POST", description: "Advance a tutorial step (usually server-driven)" },
    ],
    flow: [
      { label: "New Player", detail: "First login triggers onboarding tutorial", color: "bg-blue-500" },
      { label: "Step by Step", detail: "UI highlights actions, player follows along", color: "bg-amber-500" },
      { label: "Complete", detail: "Tutorial marked done, never shown again", color: "bg-purple-500" },
      { label: "Reward", detail: "Completion grants starter items or currency", color: "bg-green-500" },
    ],
  },
  {
    id: "unlockables",
    name: "Unlockables",
    icon: Lock,
    category: "hiro",
    tagline: "Gated content, loot boxes, and timed reveals",
    overview:
      "Unlockables represent content that reveals over time or through actions — loot boxes, timed chests, mystery rewards. Players start an unlock, wait for a timer (or pay to skip), then claim the revealed contents.",
    configSteps: [
      "Define unlockable types in Admin > Hiro Config > unlockables.",
      "Set unlock duration (e.g., 4 hours for common chest, 24h for rare).",
      "Configure slot limits (max 4 chests unlocking simultaneously).",
      "Define reward tables with weighted random outcomes.",
      "Set skip costs in premium currency.",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List all unlockables and their state
const unlockables = await hiro.hiroRpc(
  "unlockables", "list", {}, opts,
);

// Start unlocking a chest
await hiro.hiroRpc(
  "unlockables", "start", { id: "rare_chest_01" }, opts,
);

// Claim after timer expires (or after paying to skip)
await hiro.hiroRpc(
  "unlockables", "claim", { id: "rare_chest_01" }, opts,
);`,
    rpcs: [
      { id: "hiro_unlockables_list", method: "POST", description: "List all unlockable slots and their state" },
      { id: "hiro_unlockables_start", method: "POST", description: "Begin unlocking an item (starts timer)", payload: '{ "id": "rare_chest" }' },
      { id: "hiro_unlockables_claim", method: "POST", description: "Claim a fully unlocked item", payload: '{ "id": "rare_chest" }' },
    ],
    flow: [
      { label: "Earn Chest", detail: "Player receives locked chest from match/quest", color: "bg-blue-500" },
      { label: "Start Unlock", detail: "Timer begins (4h common, 24h rare)", color: "bg-amber-500" },
      { label: "Wait or Skip", detail: "Timer counts down; gems can speed it up", color: "bg-purple-500" },
      { label: "Claim Loot", detail: "Chest opens, random rewards revealed", color: "bg-green-500" },
    ],
  },
  {
    id: "auctions",
    name: "Auctions",
    icon: Gavel,
    category: "hiro",
    tagline: "Real-time bidding and player-to-player trading",
    overview:
      "The Auction system enables player-driven marketplaces. Players list items for sale, set starting prices, and others bid. Supports buy-it-now, timed auctions, and reserve prices. All transactions are server-authoritative.",
    configSteps: [
      "Enable auctions in Admin > Hiro Config > auctions.",
      "Configure listing fees, bid increments, and auction durations.",
      "Set which item categories are tradeable.",
      "Configure currency type for bids (coins, gems, or custom).",
      "Set anti-sniping rules (extend auction if bid in last 30 seconds).",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List active auctions
const auctions = await hiro.hiroRpc(
  "auctions", "list", { category: "weapons" }, opts,
);

// Place a bid
await hiro.hiroRpc("auctions", "bid", {
  auction_id: "auction_123",
  amount: 500,
}, opts);

// Create a listing
await hiro.hiroRpc("auctions", "create", {
  item_id: "sword_01",
  instance_id: "inst_abc",
  starting_price: 100,
  duration_hours: 24,
}, opts);`,
    rpcs: [
      { id: "hiro_auctions_list", method: "POST", description: "List active auction listings" },
      { id: "hiro_auctions_bid", method: "POST", description: "Place a bid on an auction", payload: '{ "auction_id": "abc", "amount": 500 }' },
      { id: "hiro_auctions_create", method: "POST", description: "Create a new auction listing" },
    ],
    flow: [
      { label: "List Item", detail: "Player creates auction with starting price", color: "bg-blue-500" },
      { label: "Bidding", detail: "Other players place incrementing bids", color: "bg-amber-500" },
      { label: "Timer Ends", detail: "Highest bidder wins (anti-snipe extends)", color: "bg-purple-500" },
      { label: "Settlement", detail: "Item transferred, currency exchanged atomically", color: "bg-green-500" },
    ],
  },
  {
    id: "incentives",
    name: "Incentives",
    icon: Gift,
    category: "hiro",
    tagline: "Daily goals, bonus rewards, and engagement hooks",
    overview:
      "Incentives are lightweight reward hooks — daily bonuses, ad-reward multipliers, comeback gifts. They're simpler than quests and designed for quick engagement bursts. Players claim them with minimal effort.",
    configSteps: [
      "Define incentives in Admin > Hiro Config > incentives.",
      "Set trigger conditions: daily login, first match, return after absence.",
      "Configure reward payloads (currencies, items, energy refills).",
      "Set cooldown periods between claims.",
      "Use Satori audiences for segment-specific incentives (e.g., VIP bonuses).",
    ],
    clientCode: `import { hiro } from "@nakama/shared";

// List available incentives
const incentives = await hiro.listIncentives(opts);
// Returns: { incentives: [{ id, type, available, ... }] }

// Claim an available incentive
await hiro.claimIncentive("daily_bonus", opts);`,
    rpcs: [
      { id: "hiro_incentives_list", method: "POST", description: "List all incentives and their availability" },
      { id: "hiro_incentives_claim", method: "POST", description: "Claim an available incentive", payload: '{ "id": "daily_bonus" }' },
    ],
    flow: [
      { label: "Trigger", detail: "Player logs in, finishes match, or returns", color: "bg-blue-500" },
      { label: "Available", detail: "Incentive becomes claimable in UI", color: "bg-amber-500" },
      { label: "Claim", detail: "One-tap claim grants the reward", color: "bg-purple-500" },
      { label: "Cooldown", detail: "Timer resets for next availability", color: "bg-green-500" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Satori System Guides                                               */
/* ------------------------------------------------------------------ */

const SATORI_GUIDES: SystemGuide[] = [
  {
    id: "audiences",
    name: "Audiences",
    icon: UsersRound,
    category: "satori",
    tagline: "Player segmentation and targeting rules",
    overview:
      "Audiences define player segments based on properties, behavior, and metadata. Use audiences to target specific groups with personalized content, offers, events, and experiments. Audience evaluation happens server-side — the client just receives personalized results.",
    configSteps: [
      "Create audiences in Admin > Audiences with rule definitions.",
      "Rules can match on: player properties, level, spend amount, country, platform.",
      "Combine rules with AND/OR logic for complex segments.",
      "Audiences are evaluated in real-time as player properties change.",
      "Reference audiences in flags, experiments, live events, and messages.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: List all defined audiences
const audiences = await satori.listAudiences({
  auth: { type: "server-key" },
});

// Audiences are NOT queried by the game client directly.
// Instead, the client calls other systems (flags, store, events)
// and Satori automatically filters results based on which
// audiences the player belongs to.

// Example: A "vip_players" audience controls which store
// offers appear. The client just calls hiro.listStore()
// and gets pre-filtered, personalized results.`,
    rpcs: [
      { id: "satori_audiences_list", method: "POST", description: "List all audience definitions (admin)" },
    ],
    flow: [
      { label: "Define Rules", detail: "Admin creates segment: 'level > 10 AND country = US'", color: "bg-blue-500" },
      { label: "Player Matches", detail: "Satori evaluates player properties in real-time", color: "bg-amber-500" },
      { label: "Content Filtered", detail: "Flags, offers, events show audience-specific content", color: "bg-purple-500" },
      { label: "Auto-Updates", detail: "Player moves between audiences as properties change", color: "bg-green-500" },
    ],
  },
  {
    id: "flags",
    name: "Feature Flags",
    icon: Flag,
    category: "satori",
    tagline: "Remote configuration and feature rollout",
    overview:
      "Feature Flags let you toggle features on/off remotely without deploying code. Each flag has a name, value, and optional audience targeting. Use flags for gradual rollouts, kill switches, remote config values, and A/B-style feature gates.",
    configSteps: [
      "Create flags in Admin > Feature Flags.",
      "Set the flag name, value (any JSON-serializable string), and enabled state.",
      "Optionally target specific audiences (e.g., 'new_ui' only for 'beta_testers').",
      "The game client reads all flags on launch and caches them.",
      "Toggle flags instantly from admin — no app update needed.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: Get all flags
const { flags } = await satori.getAllFlags({
  auth: { type: "server-key" },
});

// Admin: Toggle a flag
await satori.toggleFlag({
  name: "new_matchmaker_v2",
  enabled: true,
  value: '{"timeout":30}',
  audiences_json: '["beta_testers"]',
}, { auth: { type: "server-key" } });

// Game client: Read flags on session start
// const flags = await satori.getAllFlags(playerOpts);
// if (flags.find(f => f.name === "double_xp")?.enabled) {
//   showDoubleXpBanner();
// }`,
    rpcs: [
      { id: "satori_flags_get_all", method: "POST", description: "Get all feature flags and their values" },
      { id: "satori_flags_toggle", method: "POST", description: "Create/update/toggle a feature flag", payload: '{ "name": "flag_name", "enabled": true, "value": "..." }' },
    ],
    flow: [
      { label: "Create Flag", detail: "Admin defines flag with name and default value", color: "bg-blue-500" },
      { label: "Target Audience", detail: "Optionally restrict to specific player segments", color: "bg-amber-500" },
      { label: "Client Reads", detail: "Game fetches flags on launch, caches locally", color: "bg-purple-500" },
      { label: "Instant Toggle", detail: "Admin flips flag — all clients update on next fetch", color: "bg-green-500" },
    ],
  },
  {
    id: "experiments",
    name: "A/B Experiments",
    icon: FlaskConical,
    category: "satori",
    tagline: "Split testing and variant assignment",
    overview:
      "Experiments run A/B tests by splitting players into variant groups. Each variant can have different config values, and Satori tracks metrics per variant to determine winners. Use experiments to test pricing, UI layouts, difficulty curves, and reward values.",
    configSteps: [
      "Create experiments in Admin > Experiments.",
      "Define variants with names, weights (traffic split %), and data payloads.",
      "Target specific audiences or run on all players.",
      "Hiro's Personalizer can override config values per-variant automatically.",
      "Monitor results in the Analytics page and pick the winning variant.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: List all experiments
const experiments = await satori.getAllExperiments({
  auth: { type: "server-key" },
});

// Admin: Create/update an experiment
await satori.setupExperiment({
  id: "pricing_test_v2",
  name: "Store Pricing Test",
  variants_json: JSON.stringify([
    { name: "control", weight: 50, data: { price: 100 } },
    { name: "discounted", weight: 50, data: { price: 79 } },
  ]),
  enabled: true,
  audiences_json: '["paying_users"]',
}, { auth: { type: "server-key" } });

// Game client: variant assignment is automatic.
// When the client reads store config, Hiro's Personalizer
// applies the experiment variant's data overlay.`,
    rpcs: [
      { id: "satori_experiments_get_all", method: "POST", description: "List all experiments and variants" },
      { id: "satori_experiment_setup", method: "POST", description: "Create or update an experiment" },
    ],
    flow: [
      { label: "Define Variants", detail: "Control (50%) vs Variant A (50%)", color: "bg-blue-500" },
      { label: "Assign Players", detail: "Satori deterministically assigns each player", color: "bg-amber-500" },
      { label: "Personalize", detail: "Each variant gets different config values", color: "bg-purple-500" },
      { label: "Measure", detail: "Compare metrics between variants to pick winner", color: "bg-green-500" },
    ],
  },
  {
    id: "live_events",
    name: "Live Events",
    icon: CalendarClock,
    category: "satori",
    tagline: "Scheduled events, seasonal content, and time-gating",
    overview:
      "Live Events are time-bound content windows — holiday events, weekend tournaments, flash sales. They have start/end times, reward payloads, and audience targeting. Hiro systems (leaderboards, challenges, store) can reference live events for synchronized scheduling.",
    configSteps: [
      "Create live events in Admin > Live Events.",
      "Set start time, end time, name, description, and rewards.",
      "Target specific audiences (e.g., 'holiday_event' only for US players).",
      "Link to Hiro systems: event leaderboards, special store sections, challenges.",
      "Events auto-activate and deactivate based on the schedule.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: List all live events
const { events } = await satori.listLiveEvents({
  auth: { type: "server-key" },
});

// Admin: Schedule a new event
await satori.scheduleLiveEvent({
  id: "summer_splash_2025",
  name: "Summer Splash Event",
  description: "Double rewards all weekend!",
  start_time_sec: Math.floor(Date.now() / 1000),
  end_time_sec: Math.floor(Date.now() / 1000) + 172800,
  rewards_json: JSON.stringify([
    { type: "currency", id: "coins", amount: 1000 },
  ]),
  audiences_json: '["all_players"]',
  enabled: true,
}, { auth: { type: "server-key" } });

// Game client: query active events
// const events = await satori.listLiveEvents(playerOpts);
// Render event banners, countdowns, and CTAs`,
    rpcs: [
      { id: "satori_live_events_list", method: "POST", description: "List all live events (active, upcoming, past)" },
      { id: "satori_live_event_schedule", method: "POST", description: "Create or update a live event" },
    ],
    flow: [
      { label: "Schedule", detail: "Admin sets start/end times and rewards", color: "bg-blue-500" },
      { label: "Auto-Activate", detail: "Event goes live at the scheduled time", color: "bg-amber-500" },
      { label: "Players Engage", detail: "Event content, challenges, and offers appear", color: "bg-purple-500" },
      { label: "Auto-End", detail: "Event closes, rewards distributed, metrics logged", color: "bg-green-500" },
    ],
  },
  {
    id: "messages",
    name: "Messages",
    icon: MessageSquare,
    category: "satori",
    tagline: "Targeted push notifications and in-app messaging",
    overview:
      "Messages are targeted communications — push notifications, in-app modals, inbox messages. They can carry reward payloads and deep-link to specific game screens. Target by audience for precise re-engagement campaigns.",
    configSteps: [
      "Compose messages in Admin > Messages.",
      "Set title, body, optional reward payload, and CTA deep-link.",
      "Target a specific audience or broadcast to all players.",
      "Schedule for immediate or future delivery.",
      "Messages appear in the player's Inbox and optionally as push notifications.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: List sent messages
const messages = await satori.listMessages({
  auth: { type: "server-key" },
});

// Admin: Broadcast a message
await satori.broadcastMessage({
  title: "🎉 Weekend Bonus!",
  body: "Log in this weekend for 2x rewards!",
  audience_id: "weekend_players",
  rewards_json: JSON.stringify([
    { type: "currency", id: "gems", amount: 50 },
  ]),
}, { auth: { type: "server-key" } });

// Game client: messages appear in the Inbox page
// via Nakama notifications + Satori messages combined.`,
    rpcs: [
      { id: "satori_messages_list", method: "POST", description: "List all sent/scheduled messages" },
      { id: "satori_message_broadcast", method: "POST", description: "Send a targeted or broadcast message" },
    ],
    flow: [
      { label: "Compose", detail: "Write title, body, rewards, and deep-link", color: "bg-blue-500" },
      { label: "Target", detail: "Select audience or broadcast to everyone", color: "bg-amber-500" },
      { label: "Deliver", detail: "Push notification + inbox message sent", color: "bg-purple-500" },
      { label: "Engage", detail: "Player taps CTA → deep-links to game screen", color: "bg-green-500" },
    ],
  },
  {
    id: "metrics",
    name: "Metrics & Analytics",
    icon: Activity,
    category: "satori",
    tagline: "Event tracking, alerts, and data export",
    overview:
      "Metrics captures player events and aggregates them into actionable data. Set up alerts on KPIs (DAU drops, revenue spikes), export to data lakes (BigQuery, Snowflake), and feed dashboards. Events follow a validated taxonomy for consistency.",
    configSteps: [
      "Events are captured automatically by Hiro/Satori when players take actions.",
      "Define custom events with the taxonomy schema (Admin > Analytics).",
      "Set up metric alerts with thresholds (e.g., alert if DAU < 1000).",
      "Configure data lake exports to BigQuery, Snowflake, or S3.",
      "View aggregated metrics in the admin Analytics dashboard.",
    ],
    clientCode: `import { satori } from "@nakama/shared";

// Admin: Get aggregated metrics
const metrics = await satori.getMetrics({
  auth: { type: "server-key" },
});

// Admin: Set up an alert
await satori.setMetricAlert({
  metric_id: "dau",
  name: "DAU Drop Alert",
  threshold: 1000,
  operator: "lt",
}, { auth: { type: "server-key" } });

// Admin: View player's event timeline
const timeline = await satori.getEventsTimeline(
  "user-uuid-here",
  { auth: { type: "server-key" }, limit: 50 },
);`,
    rpcs: [
      { id: "satori_metrics_get", method: "POST", description: "Get aggregated metric values" },
      { id: "satori_metrics_set_alert", method: "POST", description: "Create a metric alert threshold" },
      { id: "satori_events_timeline", method: "POST", description: "View a player's event history" },
    ],
    flow: [
      { label: "Player Acts", detail: "Match, purchase, login — events fire automatically", color: "bg-blue-500" },
      { label: "Capture", detail: "Satori validates and stores the event", color: "bg-amber-500" },
      { label: "Aggregate", detail: "Metrics computed: DAU, revenue, retention", color: "bg-purple-500" },
      { label: "Alert / Export", detail: "Thresholds trigger alerts; data exports to lake", color: "bg-green-500" },
    ],
  },
];

const ALL_GUIDES = [...HIRO_GUIDES, ...SATORI_GUIDES];

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="Copy code"
    >
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  const trimmed = code.trim();
  return (
    <div className="relative rounded-lg border border-border bg-muted/50">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{language}</span>
        <CopyButton text={trimmed} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code>{trimmed}</code>
      </pre>
    </div>
  );
}

function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white", step.color)}>
              {i + 1}
            </div>
            <div className="mt-2 w-36 text-center">
              <p className="text-sm font-semibold">{step.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </div>
          {i < steps.length - 1 && (
            <ArrowRight size={20} className="mt-0 shrink-0 text-muted-foreground/50" />
          )}
        </div>
      ))}
    </div>
  );
}

function RpcTable({ rpcs }: { rpcs: RpcEndpoint[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2.5 text-left font-semibold">RPC ID</th>
            <th className="px-4 py-2.5 text-left font-semibold">Description</th>
            <th className="px-4 py-2.5 text-left font-semibold">Example Payload</th>
          </tr>
        </thead>
        <tbody>
          {rpcs.map((rpc) => (
            <tr key={rpc.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{rpc.id}</code>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{rpc.description}</td>
              <td className="px-4 py-2.5">
                {rpc.payload ? (
                  <code className="text-xs font-mono text-muted-foreground">{rpc.payload}</code>
                ) : (
                  <span className="text-xs text-muted-foreground/50">{"{}"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemDetail({ guide, isOpen, onToggle }: { guide: SystemGuide; isOpen: boolean; onToggle: () => void }) {
  const Icon = guide.icon;
  const [tab, setTab] = useState<"overview" | "config" | "code" | "rpcs" | "flow">("overview");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isOpen]);

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "config" as const, label: "Configuration" },
    { key: "code" as const, label: "Client Code" },
    { key: "rpcs" as const, label: "RPC Endpoints" },
    { key: "flow" as const, label: "Integration Flow" },
  ];

  return (
    <div ref={ref} className="rounded-lg border border-border" id={`system-${guide.id}`}>
      <button
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 px-5 py-4 text-left transition-colors",
          isOpen ? "bg-primary/5" : "hover:bg-muted/50",
        )}
      >
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          guide.category === "hiro" ? "bg-blue-500/10 text-blue-500" : "bg-purple-500/10 text-purple-500",
        )}>
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{guide.name}</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              guide.category === "hiro"
                ? "bg-blue-500/10 text-blue-600"
                : "bg-purple-500/10 text-purple-600",
            )}>
              {guide.category}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{guide.tagline}</p>
        </div>
        {isOpen ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="border-t border-border">
          <div className="flex gap-1 border-b border-border px-5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "overview" && (
              <p className="max-w-3xl leading-relaxed text-muted-foreground">{guide.overview}</p>
            )}
            {tab === "config" && (
              <ol className="max-w-3xl space-y-3">
                {guide.configSteps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {tab === "code" && <CodeBlock code={guide.clientCode} />}
            {tab === "rpcs" && <RpcTable rpcs={guide.rpcs} />}
            {tab === "flow" && <FlowDiagram steps={guide.flow} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Architecture Diagram                                               */
/* ------------------------------------------------------------------ */

function ArchitectureDiagram() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-6">
      <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-4">
        {/* Game Client */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-20 w-44 items-center justify-center rounded-xl border-2 border-amber-500/30 bg-amber-500/5">
            <div className="text-center">
              <Monitor size={22} className="mx-auto text-amber-500" />
              <p className="mt-1 text-xs font-bold">Game Client</p>
              <p className="text-[10px] text-muted-foreground">Unity / Unreal / Web</p>
            </div>
          </div>
        </div>

        <ArrowRight size={24} className="shrink-0 rotate-90 text-muted-foreground/40 md:rotate-0" />

        {/* Nakama */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-20 w-44 items-center justify-center rounded-xl border-2 border-green-500/30 bg-green-500/5">
            <div className="text-center">
              <Server size={22} className="mx-auto text-green-500" />
              <p className="mt-1 text-xs font-bold">Nakama Server</p>
              <p className="text-[10px] text-muted-foreground">Port 7350 — Single API</p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex h-16 w-20 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/5">
              <div className="text-center">
                <Puzzle size={14} className="mx-auto text-blue-500" />
                <p className="mt-0.5 text-[10px] font-bold text-blue-600">Hiro</p>
                <p className="text-[9px] text-muted-foreground">14 systems</p>
              </div>
            </div>
            <div className="flex h-16 w-20 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/5">
              <div className="text-center">
                <Sparkles size={14} className="mx-auto text-purple-500" />
                <p className="mt-0.5 text-[10px] font-bold text-purple-600">Satori</p>
                <p className="text-[9px] text-muted-foreground">6 systems</p>
              </div>
            </div>
          </div>
        </div>

        <ArrowRight size={24} className="shrink-0 rotate-90 text-muted-foreground/40 md:rotate-0" />

        {/* Admin Panel */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-20 w-44 items-center justify-center rounded-xl border-2 border-primary/30 bg-primary/5">
            <div className="text-center">
              <Shield size={22} className="mx-auto text-primary" />
              <p className="mt-1 text-xs font-bold">Admin Panel</p>
              <p className="text-[10px] text-muted-foreground">This Dashboard</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 text-center">
        <p className="text-xs text-muted-foreground">
          All communication goes through <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">POST /v2/rpc/&#123;rpc_id&#125;</code> on Nakama's single API port.
          Hiro RPCs use <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">hiro_&#123;system&#125;_&#123;action&#125;</code>, Satori uses <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">satori_&#123;system&#125;_&#123;action&#125;</code>.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth Pattern Guide                                                 */
/* ------------------------------------------------------------------ */

function AuthPatternSection() {
  return (
    <div className="space-y-4 rounded-lg border border-border p-5">
      <h3 className="text-lg font-semibold">Authentication Pattern</h3>
      <p className="text-sm text-muted-foreground">
        Every RPC call requires an <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">Authorization</code> header. Two modes are supported:
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-amber-500" />
            <span className="font-semibold text-sm">Server Key (Admin)</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Used by admin tools and server-to-server calls. Full access to all RPCs.
          </p>
          <CodeBlock language="http" code={`Authorization: Basic base64("serverkey:")\n\n// In TypeScript:\nconst opts = { auth: { type: "server-key" } };`} />
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-green-500" />
            <span className="font-semibold text-sm">Bearer Token (Player)</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Used by game clients. Scoped to the authenticated player's data only.
          </p>
          <CodeBlock language="http" code={`Authorization: Bearer <session_token>\n\n// In TypeScript:\nconst opts = {\n  auth: { type: "bearer", token: session.token },\n};`} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function DevGuidePage() {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "hiro" | "satori">("all");

  const filtered = ALL_GUIDES.filter((g) => {
    if (filter !== "all" && g.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        g.name.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.id.includes(q)
      );
    }
    return true;
  });

  const hiroCount = filtered.filter((g) => g.category === "hiro").length;
  const satoriCount = filtered.filter((g) => g.category === "satori").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Game Developer Guide</h2>
        <p className="text-muted-foreground">
          Step-by-step integration instructions for all Hiro meta-game and Satori LiveOps systems.
        </p>
      </div>

      {/* Architecture Overview */}
      <ArchitectureDiagram />

      {/* Auth Pattern */}
      <AuthPatternSection />

      {/* Universal RPC Pattern */}
      <div className="rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold">Universal RPC Call Pattern</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Hiro and Satori system is accessed through the same HTTP endpoint. The <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">rpc_id</code> determines which system handles the request.
        </p>
        <div className="mt-4">
          <CodeBlock code={`// Raw HTTP call (any language/platform)
POST https://your-nakama-host:7350/v2/rpc/hiro_economy_grant
Content-Type: application/json
Authorization: Bearer <session_token>

{
  "payload": "{\\"currencies\\":{\\"coins\\":500}}"
}

// Note: the payload is JSON-stringified inside a JSON wrapper.
// Nakama unwraps it server-side before passing to Hiro/Satori.

// Using the @nakama/shared TypeScript package:
import { hiro, satori } from "@nakama/shared";

// Hiro systems → hiro.hiroRpc(system, action, payload, opts)
await hiro.hiroRpc("economy", "grant", { currencies: { coins: 500 } }, opts);

// Satori systems → satori.satoriRpc(system, action, payload, opts)
await satori.satoriRpc("flags", "get_all", {}, opts);

// The shared package handles:
// 1. URL construction from env vars (VITE_NAKAMA_HOST/PORT)
// 2. RPC ID formatting (hiro_{system}_{action})
// 3. Payload double-JSON encoding
// 4. Response unwrapping and error handling`} />
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search systems..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex gap-1 rounded-md border border-input p-1">
          {([
            { key: "all" as const, label: `All (${ALL_GUIDES.length})` },
            { key: "hiro" as const, label: `Hiro (${HIRO_GUIDES.length})` },
            { key: "satori" as const, label: `Satori (${SATORI_GUIDES.length})` },
          ]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* System Count */}
      {search && (
        <p className="text-sm text-muted-foreground">
          {filtered.length} system{filtered.length !== 1 ? "s" : ""} found
          {hiroCount > 0 && satoriCount > 0 && ` (${hiroCount} Hiro, ${satoriCount} Satori)`}
        </p>
      )}

      {/* Hiro Section */}
      {(filter === "all" || filter === "hiro") && hiroCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-blue-500" />
            <h3 className="text-lg font-semibold">Hiro — Meta-Game Systems</h3>
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-bold text-blue-600">{hiroCount}</span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Hiro provides battle-tested metagame features that integrate in hours, not weeks.
            Configure once in the admin panel, then call RPCs from your game client.
          </p>
          <div className="space-y-2">
            {filtered
              .filter((g) => g.category === "hiro")
              .map((g) => (
                <SystemDetail
                  key={g.id}
                  guide={g}
                  isOpen={openId === g.id}
                  onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                />
              ))}
          </div>
        </div>
      )}

      {/* Satori Section */}
      {(filter === "all" || filter === "satori") && satoriCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            <h3 className="text-lg font-semibold">Satori — LiveOps & Personalization</h3>
            <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-bold text-purple-600">{satoriCount}</span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Satori powers LiveOps: feature flags, A/B testing, audiences, events, and messaging.
            Keep players engaged, retained, and coming back.
          </p>
          <div className="space-y-2">
            {filtered
              .filter((g) => g.category === "satori")
              .map((g) => (
                <SystemDetail
                  key={g.id}
                  guide={g}
                  isOpen={openId === g.id}
                  onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                />
              ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search size={40} className="text-muted-foreground/30" />
          <p className="mt-4 font-medium">No systems match your search</p>
          <p className="text-sm text-muted-foreground">Try a different keyword or clear the filter.</p>
        </div>
      )}
    </div>
  );
}

export default DevGuidePage;
