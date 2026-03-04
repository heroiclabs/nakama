# Nakama MCP Server — Implementation Report

## What Was Built

The MCP server exposes **55+ purpose-built tools** and **5 resources** across 11 modules,
giving an AI agent full operational access to the Nakama game server.

### Tool Inventory by Module

| Module | File | Tools | Purpose |
|--------|------|-------|---------|
| **Analytics** | `tools/analytics.ts` | 8 | Server status, account listing/detail, wallet ledger, notifications, friend/group lists, account export |
| **Storage** | `tools/storage.ts` | 4 | Browse collections, list/read/delete storage objects |
| **Leaderboards** | `tools/leaderboards.ts` | 4 | List boards, get details, list records, delete records |
| **Engagement** | `tools/engagement.ts` | 3 | Send notifications, call any RPC, update accounts |
| **Moderation** | `tools/moderation.ts` | 2 | Ban/unban accounts |
| **Identity** | `tools/identity.ts` | 8 | Auth, player profile, portfolio, session tracking, agent memory read/write, onboarding, retention data |
| **Economy** | `tools/economy.ts` | 10 | Wallet get/update/transfer, inventory grant/remove/list, catalog, currency grants, batch wallet ops |
| **Matchmaking** | `tools/matchmaking.ts` | 10 | Find match, cancel, status, parties, tournament CRUD, leaderboard scoring |
| **Social** | `tools/social.ts` | 10 | Friends list/add/remove/challenge, group create/XP/wallet, chat send (group/DM/room), chat history |
| **Trust & Safety** | `tools/trust_safety.ts` | 7 | User flagging, audit logging, rate limits, cache ops, account deletion, API endpoint listing |
| **Operator** | `tools/operator.ts` | 2 | Unified policy-enforced operator (70+ whitelisted actions), action listing |

### MCP Resources

| URI | Description |
|-----|-------------|
| `nakama://status` | Live server status |
| `nakama://collections` | All storage collection names |
| `nakama://rpc-catalog` | Full 175+ RPC catalog |
| `nakama://operator-actions` | Operator allowlist by category with caps |
| `nakama://tool-guide` | AI agent playbook for which tools to use when |

### Key Design Pattern: The Operator

The `operator` tool implements the "Agent = privileged operator with policies" pattern:

- **Allowlist**: Only 70+ pre-approved RPCs can be called
- **Categories**: `read` (no restrictions), `write` (audited + capped), `admin` (highest scrutiny)
- **Amount caps**: Value-moving operations have per-call limits (e.g. wallet updates capped at 10,000)
- **Mandatory reasons**: Write/admin actions require an audit reason
- **Automatic audit**: Every mutation is logged to `analytics_log_event` with actor, action, params, timestamp
- **Idempotency**: Optional idempotency keys forwarded to underlying RPCs

---

## What More Could Be Built (Ranked by Impact)

### Tier 1: Highest Impact — Build Next

#### 1. Cohort Analytics Engine
**What**: A tool that cross-references storage collections to answer cohort questions:
"What % of users who completed onboarding in the last 7 days are still active?"
"What's the median wallet balance of users who played 5+ days this month?"

**Why**: The raw tools (list_accounts, list_storage) return individual records. A cohort tool would
do server-side aggregation across multiple collections, returning actionable metrics instead of raw data.

**Implementation**: New RPC `analytics_cohort_query` that runs parameterized SQL via Nakama's
`nk.sql_exec()` (available but unused in the current codebase). This is the single highest-ROI
addition because it turns the agent from a data browser into an analytics engine.

#### 2. Engagement Automation / Campaign Runner
**What**: Tools to define, schedule, and track engagement campaigns:
- `campaign_create({ name, target_cohort, action, schedule })` — e.g. "send notification to all users inactive 3+ days"
- `campaign_status(id)` — track delivery, open rates
- `campaign_pause/resume/cancel(id)`

**Why**: Right now the agent can send one notification at a time. A campaign system lets it
target thousands of users with a single tool call, with built-in scheduling and tracking.

**Implementation**: Extend the retention module's `retention_schedule_notification` pattern into a
proper campaign system with a `campaigns` storage collection.

#### 3. A/B Testing Framework
**What**: Tools to manage experiments:
- `experiment_create({ name, variants, traffic_split, target_cohort })`
- `experiment_assign(user_id)` — returns variant
- `experiment_report(id)` — variant performance metrics

**Why**: The agent can analyze data and propose changes, but has no way to safely test hypotheses.
An A/B framework lets it propose "let's test 20% higher daily rewards" and measure the impact.

**Implementation**: Storage collection `experiments` with variant assignments. Hook into existing
reward/mission RPCs to check experiment assignments before returning values.

### Tier 2: High Impact — Build Soon

#### 4. Real-time Event Stream (SSE/WebSocket Resource)
**What**: An MCP resource that streams real-time events:
- Player logins/logouts
- Score submissions
- Chat messages
- Purchases

**Why**: Currently the agent can only poll. A real-time stream would let it react immediately
to events ("player just hit a new high score — send a congratulation notification").

**Implementation**: Connect to Nakama's event system or notification hooks. The MCP SDK supports
server-sent events which could carry the stream.

#### 5. Content Moderation Pipeline
**What**: Automated content review tools:
- `moderate_text(text)` — score text for toxicity, spam, PII
- `moderate_chat_channel(channel_id, window)` — scan recent messages
- `auto_moderate_enable(rules)` — set up automated filters

**Why**: The user_flag tool is reactive. A proactive moderation pipeline would scan chat
messages and flag problematic content before it affects the community.

**Implementation**: Integrate a text classification model (could be a simple rule engine
or an external API). Scan chat storage collections periodically.

#### 6. Player Segmentation Tool
**What**: Define and query player segments:
- `segment_define({ name, criteria })` — e.g. "whales" = wallet > 10,000 AND games > 50
- `segment_list_members(name)`
- `segment_stats(name)` — aggregate metrics for a segment

**Why**: Most engagement actions need targeting. Segments are reusable building blocks
that make the agent dramatically more effective at targeted operations.

**Implementation**: Store segment definitions in `player_segments` collection. Query
accounts + storage to evaluate membership.

#### 7. Predictive Churn Scoring
**What**: Tools that compute churn risk for individual users or cohorts:
- `churn_score(user_id)` — 0-100 risk score based on session frequency, streak breaks, declining play time
- `churn_cohort(threshold)` — list users above a churn risk threshold

**Why**: The retention data tools provide raw data. A churn score would synthesize that data
into actionable intelligence, enabling proactive outreach before users leave.

**Implementation**: Compute from existing data: session gap trends, streak breaks, wallet
inactivity, leaderboard participation decline. Could be a new RPC or computed in the MCP layer.

### Tier 3: Medium Impact — Build When Needed

#### 8. Scheduled Job Runner
**What**: Cron-like job management:
- `job_schedule({ name, cron, action, params })`
- `job_list()` / `job_status(id)` / `job_cancel(id)`

**Why**: Many live ops tasks need to run on schedules (daily reward resets, weekly
tournament creation, monthly milestone evaluations). A job runner lets the agent
set up recurring operations without manual intervention.

#### 9. Economy Simulation / What-If Tool
**What**: Simulate economy changes before applying:
- `economy_simulate({ action, params, sample_size })` — "what if we increased daily rewards by 50%?"
- Returns projected impact on currency supply, spending rates, etc.

**Why**: The agent can modify the economy, but has no way to predict impact.
A simulation tool provides a safety net for economic decisions.

#### 10. Social Graph Analyzer
**What**: Higher-order social analysis:
- `social_influence_score(user_id)` — how connected/influential is this user?
- `social_clusters()` — identify friend groups and communities
- `social_viral_potential(content_id)` — estimate spread through friend networks

**Why**: The raw friends_list tool shows connections. A graph analyzer would identify
influencers, isolated users who need connection, and optimal channels for information spread.

#### 11. Dashboard Data Aggregator
**What**: Pre-computed metrics for common dashboard queries:
- `metrics_daily()` — DAU, revenue, new users, churn rate, avg session
- `metrics_game(game_id)` — per-game breakdown
- `metrics_trend(metric, period)` — trend over time

**Why**: Currently the agent must combine many tool calls to compute basic metrics.
A dashboard aggregator would return standard KPIs in a single call.

#### 12. Multi-Game Cross-Promotion
**What**: Tools to drive players between games:
- `cross_promote({ source_game, target_game, user_segment, reward })`
- `cross_game_stats(user_id)` — which games does this user play?

**Why**: The platform supports multiple games (QuizVerse, LastToLive). Cross-promotion
tools would leverage the multi-game wallet and identity system to increase total engagement.

#### 13. Webhook / External Integration Bridge
**What**: Forward events to external systems:
- `webhook_register({ event, url, secret })`
- `webhook_list()` / `webhook_test(id)`

**Why**: Enables integration with Discord bots, Slack channels, email services,
analytics platforms. The agent could set up notifications that reach users outside the game.

---

## Architecture Recommendations

### Short-term (add to current MCP server)
1. Add **cohort analytics** as server-side aggregation RPCs
2. Add **player segmentation** using storage + account cross-queries
3. Add **churn scoring** computed from existing retention data
4. Add **campaign tools** extending the retention notification system

### Medium-term (new infrastructure)
5. Add **real-time event streaming** via Nakama hooks → MCP SSE
6. Add **content moderation** pipeline with text classification
7. Add **A/B testing** framework integrated with reward/config RPCs
8. Add **economy simulation** in a sandboxed environment

### Long-term (platform capabilities)
9. Add **webhook integration** bridge
10. Add **social graph analytics** with influence scoring
11. Add **cross-game promotion** engine
12. Add **scheduled job runner** for automated live ops
