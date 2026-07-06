# World-Class Social Layer Architecture — Friends & Groups (Per Game-ID)

> **Status:** Research & Planning Only — No code changes in this document  
> **Date:** 2026-06-29  
> **Scope:** IntelliVerseX / QuizVerse social zone — Friends, Groups, Presence, Challenges, Chat  
> **Inspired by:** Supercell ID, Duolingo, Gizmo App, Discord, Clash of Clans

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit — Bugs & Pain Points](#2-current-state-audit--bugs--pain-points)
3. [Industry Research — What World-Class Looks Like](#3-industry-research--what-world-class-looks-like)
4. [Architecture Vision — The New Design](#4-architecture-vision--the-new-design)
5. [Game-ID Isolation Model](#5-game-id-isolation-model)
6. [Unified Friend Graph Design](#6-unified-friend-graph-design)
7. [Groups / Guilds Architecture](#7-groups--guilds-architecture)
8. [Presence & Online Status System](#8-presence--online-status-system)
9. [Notification & Event Bus Design](#9-notification--event-bus-design)
10. [Rate Limiting & Anti-Abuse Layer](#10-rate-limiting--anti-abuse-layer)
11. [Storage Schema Blueprint](#11-storage-schema-blueprint)
12. [RPC Consolidation Plan](#12-rpc-consolidation-plan)
13. [Unity Client Contract Changes](#13-unity-client-contract-changes)
14. [Dry-Run: Critical User Flows](#14-dry-run-critical-user-flows)
14A. [Friends Activity Feed — Gizmo-Style](#14a-friends-activity-feed--gizmo-style)
15. [Migration Phases](#15-migration-phases)
16. [Non-Goals & Out of Scope](#16-non-goals--out-of-scope)
17. [Live Codebase Validation & New Opportunities — 2026-07-04 Update](#17-live-codebase-validation--new-opportunities--2026-07-04-update)
18. [Cross-Reference With Related Planning Documents — 2026-07-04 Update](#18-cross-reference-with-related-planning-documents--2026-07-04-update)
19. [Production Readiness Review — 2026-07-06 Principal Architecture Pass](#19-production-readiness-review--2026-07-06-principal-architecture-pass)

---

## 1. Executive Summary

### The Problem

The current QuizVerse Friends & Groups system works, but has accumulated compounding debt:

- **Split-brain graph** — fixed in `friend_invites.js` but the root cause (dual storage + Nakama graph out of sync) still surfaces in edge cases
- **No game-ID isolation** — all social data is global; a player's friend list in QuizVerse is the same as in any future IntelliVerseX game
- **Dual envelope formats** — TypeScript modules return `{success, data: {...}}` while JS modules return `{success, ...flat}` — Unity must branch on both
- **Presence inconsistency** — `player_presence/status` (storage) and socket `.online` field both exist; different RPCs read different sources
- **Fragile fallback chains** — the Unity accept-invite path has a 3-tier fallback (`accept_friend_invite` → `list_pending` → `client.AddFriendsAsync`) that masks real failures
- **Legacy dual-registration** — `create_game_group`, `get_user_groups` registered from both `groups.js` (JS) and `src/legacy/groups.ts` (TS); winner depends on merge order
- **No group invite links** — users cannot share a deep-link to join a group
- **O(N²) relation scan** — `_fiNakamaRelation` is now fixed to use `_fiBuildRelationMap`, but historical calls scattered across friend_challenges.js still do per-pair scans

### The Goal

Design a **server-authoritative, game-ID-scoped, event-driven social layer** where:

- The Nakama friend graph is the **single source of truth** for relationships
- All social entities carry a `gameId` and can be safely scoped per-game without cross-contamination
- Every mutation is **idempotent** at the server level
- The Unity client gets a **single flat response envelope** for every social RPC
- Presence, challenges, groups, and invites are all **per-game** without breaking the cross-game friend graph
- The system scales to 10M+ users using patterns proven at Supercell (500M+ MAU), Duolingo (500M+ accounts), and Discord

---

## 2. Current State Audit — Bugs & Pain Points

### 2.1 Known Bugs (from code analysis)

| # | File | Bug Description | Severity |
|---|------|-----------------|----------|
| B-001 | `friend_invites.js` | **Historical split-brain** — pre-existing rows in `friend_invites` from the old implementation never called `nk.friendsAdd` on send, so those rows can never be accepted cleanly | High |
| B-002 | `friend_challenges.js` | Still uses `_fiNakamaRelation` (O(N) per call) inside challenge acceptance flow — 3 separate DB reads instead of one batch | Medium |
| B-003 | `groups.js` + `src/legacy/groups.ts` | Dual registration of `create_game_group` and `get_user_groups` — the "winning" handler is determined by postbuild merge order, not intent | High |
| B-004 | `friends_list.ts` + `find_friends.ts` + `find_nearby_players.ts` | `loadOnlineMap` is copy-pasted across **three** files (verified 2026-07-06: `find_friends.ts:193`, `find_nearby_players.ts:105`, `friends_list.ts:112`) — one future update will diverge | Medium |
| B-005 | `player_presence.ts` | No TTL on `player_presence/status` rows — a player who uninstalls still appears as "last seen 6 months ago, offline" rather than being cleanly absent | Low |
| B-006 | `notification_codes.js` | Push notification delivery (`sendFriendsPushBridge`) is inside the same try/catch as the Nakama notification — a push module crash silently drops the in-app notification too | Medium |
| B-007 | Unity client | `FriendInviteActionHelper.AcceptAsync` has a 3-tier fallback; tier 3 (`client.AddFriendsAsync`) bypasses the `friend_invites` storage, leaving the row permanently `pending` | High |
| B-008 | All group RPCs | `metadata.gameId` filtering is done in JS after fetching **all** groups from DB — a user in 50 groups causes 50-row fetch just to return 1 QuizVerse group | Medium |
| B-009 | `send_friend_invite` | Rate limit key `rl_fr_invite_send_{userId}` is **per-user**, not **per-pair** — user can spam a single target by sending different invites | Medium |
| B-010 | `friend_challenges.js` | `friends_challenge_user` is an alias for `send_friend_challenge` — both are registered; Unity sometimes calls both from different paths, creating duplicate challenge records | High |

### 2.2 Architectural Gaps

| Gap | Impact |
|-----|--------|
| No `gameId` on friend invites / challenges | Can't tell if a challenge belongs to QuizVerse or LastToLive |
| No group search RPC (uses raw Nakama `ListGroupsAsync`) | Cannot filter groups by `gameId` server-side before returning to client |
| Presence heartbeat is a single write — no reconnect handling | If client crashes mid-session, `online: true` stays for 5 minutes with no way to clean up |
| No invite link / share code for groups | Growing a group requires in-app search, no viral loop |
| No friend activity feed | "What did my friends do today?" requires polling multiple RPCs |
| Cross-game friend graph exposes all games to all players | QuizVerse friends see LastToLive activity by default |
| No challenge expiry cleanup job | Expired challenges accumulate forever in storage |

---

## 3. Industry Research — What World-Class Looks Like

### 3.1 Supercell (Clash of Clans / Clash Royale / Brawl Stars)

**Source:** ScyllaDB Engineering Blog — "How Supercell Handles Real-Time Persisted Events" (Jan 2025)

Supercell built **Supercell ID** — a cross-game social layer managing **hundreds of millions of players** with just 2 engineers. Key lessons:

#### Core Architecture Pattern: Hierarchical KV Store + CDC

```
topic_id → map(string → map(string → string_with_timestamp))

Example — Presence:
  <player_id> → "presence" → { weapon: "sword", level: "29", status: "in_battle" }

Example — Chat:
  <room_id> → <timestamp_uuid> → { message: "hi", reactions: {...} }
```

**Why it works:**
- One abstraction handles presence, chat, friend state, cross-game promo
- Every update is timestamped at source — clients drop older timestamps (idempotent)
- All events persisted in ScyllaDB **before** broadcasting to subscribers

#### Connection Model
```
Client → Proxy Server (handles subscription)
              → Event Routing Servers (sharded by topic, primary+backup)
                    → ScyllaDB (persistence)
```

- On connect: proxy subscribes client to all friend topics and all joined group topics
- Router reboot → proxy re-subscribes automatically
- Protocol Buffers for bandwidth; HTTP/2 persistent connections

#### Key Design Principles
1. **Single abstraction** covers all social use cases (no separate chat system, presence system, etc.)
2. **Events are idempotent** — applying the same event twice is harmless
3. **Client holds the timestamp** — server doesn't need to track "last seen" per client
4. **Cross-game by default** — friend graph is game-agnostic; presence is namespaced per game

### 3.2 Duolingo

**Source:** Engineering blog, product research (500M+ accounts)

Duolingo's social layer is specifically designed for **education + competition psychology**:

#### Friend Leaderboard System
- **Weekly leagues** — fresh competition every 7 days
- Friends see each other's **XP this week** — not total lifetime
- Social nudges: "Anna just passed you! You're 50 XP behind"
- **Opt-out** at user level — some users want private progress

#### Streak Social Features
- Friend streaks visible on friend cards
- "Streak at risk" nudge — notifies friends when a streak is about to break
- **Streak Repair** — friends can "save" each other's streaks (engagement mechanic)
- Friend streak leaderboard — "who has the longest shared streak?"

#### Key Design Principles
1. **Emotion-first** — social features are designed around competitive jealousy + achievement sharing
2. **Segmented notifications** — casual players get 1 push/day max; power users get up to 3
3. **A/B test everything** — friend features are the most A/B tested area in the app
4. **Privacy layers** — follower/following vs. mutual friend vs. course-only visibility

### 3.3 Gizmo App (Social Learning + Trivia)

**Research:** Product analysis

Gizmo's social design (relevant to QuizVerse as a direct competitor):

#### Friend Features
- **"Play with friends"** as primary CTA — not buried in a social tab
- Friend challenges send a push with a **score to beat** (not just "challenge sent")
- Friend leaderboard shows last 7 days, not all-time (reduces intimidation for new players)
- **Social proof** on quiz cards: "3 of your friends completed this quiz"

#### Group Features  
- Groups called **"Study Groups"** — framing is collaborative, not competitive
- Group members see each other's quiz scores per topic
- Group "goals" — weekly target of quizzes completed together
- **Group streaks** — the group has a streak, not individuals

#### Key Design Principles
1. **Contextual social** — social features appear inline with content (not just in a social tab)
2. **Low-friction invites** — "Add via phone contact" reduces cold-start problem
3. **Group goals > Group leaderboards** — collaborative beats competitive for retention in edu-games

### 3.4 Discord (for Chat & Notifications reference)

#### Notification Architecture
- **Push gateway** is separate from the realtime socket layer
- In-app notifications (notification bell) ≠ push notifications (OS banner) ≠ emails
- Users can configure per-channel notification settings
- **Mention ping** always delivers, regardless of user settings
- Delivery receipts tracked per notification per user

---

## 4. Architecture Vision — The New Design

### 4.1 Core Principles

| Principle | Detail |
|-----------|--------|
| **Server is always authoritative** | No client-side friend graph state that can contradict the server |
| **Game-ID isolation at the data layer** | Every social entity carries `gameId`; queries filter at DB level, not in JS |
| **Nakama native graph = single source of truth** | `nk.friendsList` is the only valid relationship source; `friend_invites` storage is UI metadata only |
| **One response envelope** | All social RPCs return `{ success, data: {...}, meta: { requestId, gameId, timestamp } }` |
| **Event-driven, not polling** | All state changes push a typed event; clients never poll for deltas |
| **Idempotent mutations** | Sending the same invite twice, joining the same group twice — always safe |
| **Pagination by default** | Every list endpoint supports cursor-based pagination |

### 4.2 High-Level System Map

```
┌─────────────────────────────────────────────────────────────┐
│                    UNITY CLIENT                              │
│  SocialZoneV2Controller (UI)                                 │
│       ↕ FriendsNakamaService + GroupsNakamaService           │
│       ↕ IVXFriendsManager (realtime socket bridge)           │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP RPC / WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                 NAKAMA SERVER (7350)                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           SOCIAL LAYER V2 RPCs                        │   │
│  │                                                        │   │
│  │  Friends Domain:                                       │   │
│  │    ivx_social_friends_list          (replaces friends_list) │
│  │    ivx_social_friend_search         (replaces intelliverse_find_friends) │
│  │    ivx_social_friend_nearby         (replaces intelliverse_find_nearby_players) │
│  │    ivx_social_invite_send           (replaces send_friend_invite) │
│  │    ivx_social_invite_accept         (replaces accept_friend_invite) │
│  │    ivx_social_invite_decline        (replaces decline_friend_invite) │
│  │    ivx_social_invite_cancel         (replaces cancel_friend_invite) │
│  │    ivx_social_invites_pending       (replaces list_pending_friend_invites) │
│  │    ivx_social_friend_remove         (replaces friends_remove) │
│  │    ivx_social_friend_block          (replaces friends_block) │
│  │    ivx_social_friend_unblock        (replaces friends_unblock) │
│  │                                                        │   │
│  │  Presence Domain:                                      │   │
│  │    ivx_social_presence_set          (heartbeat, per-gameId) │
│  │    ivx_social_presence_bulk_get     (fetch N players) │   │
│  │                                                        │   │
│  │  Groups Domain:                                        │   │
│  │    ivx_social_group_create          (replaces create_quizverse_group) │
│  │    ivx_social_group_list_mine       (replaces get_user_groups, filtered) │
│  │    ivx_social_group_search          (server-side gameId filter) │
│  │    ivx_social_group_detail          (replaces get_group_details) │
│  │    ivx_social_group_join            (wraps JoinGroupAsync with gameId validation) │
│  │    ivx_social_group_leave           (wraps LeaveGroupAsync) │
│  │    ivx_social_group_invite_link     (NEW — shareable join code) │
│  │    ivx_social_group_join_by_code    (NEW — deep link join) │
│  │                                                        │   │
│  │  Challenge Domain:                                     │   │
│  │    ivx_social_challenge_send        (replaces send_friend_challenge) │
│  │    ivx_social_challenge_accept      (replaces accept_friend_challenge) │
│  │    ivx_social_challenge_decline     (replaces decline_friend_challenge) │
│  │    ivx_social_challenge_cancel      (replaces cancel_friend_challenge) │
│  │    ivx_social_challenges_pending    (replaces list_pending_friend_challenges) │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────┐  ┌───────────────────────────────┐   │
│  │  Nakama Friend   │  │    CockroachDB                 │   │
│  │  Graph (native)  │  │  ivx_social_* collections      │   │
│  │  user_friends    │  │  ivx_presence_*                │   │
│  │  groups          │  │  ivx_groups_*                  │   │
│  └──────────────────┘  └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Game-ID Isolation Model

### 5.1 The Problem

Currently, the friend graph is **global** — Nakama's `user_friends` table has no `gameId` column. This means:
- A QuizVerse friend invite goes into the same global graph as a LastToLive friend
- Group `metadata.gameId` is filtered in JS after a full DB scan
- Presence data is written to `player_presence/status` with a `gameId` field, but the key is the same regardless of game

### 5.2 The Solution: Two-Layer Model

```
Layer 1: Global Identity Layer (unchanged — Nakama native)
─────────────────────────────────────────────────────────
  Nakama user_friends table        ← RELATIONSHIP STATUS ONLY
  Nakama groups table              ← GROUP MEMBERSHIP ONLY
  (No game-specific data here)

Layer 2: Game-Scoped Activity Layer (new collections)
─────────────────────────────────────────────────────────
  ivx_game_presence/{gameId}_{userId}     ← per-game presence
  ivx_game_challenges/{gameId}/{chgId}    ← per-game challenges
  ivx_game_streaks/{gameId}/{pair_key}    ← per-game friend streaks
  ivx_game_group_meta/{groupId}           ← group → gameId mapping with rich meta
```

### 5.3 Game-ID Resolution

Every client call passes `gameId` in the request payload. The server:

1. **Validates** `gameId` against the known game registry (`quizverse`, `lasttolive`, etc.)
2. **Scopes** all storage reads/writes to `ivx_{gameId}_*` collections
3. **Returns** `gameId` in every response envelope so the client always knows the context

```typescript
// gameId registry (server-side constant)
const GAME_REGISTRY: Record<string, string> = {
  "quizverse":    "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "lasttolive":   "<lasttolive-uuid>",
  "quizverse_v2": "126bf539-dae2-4bcf-964d-316c0fa1f92b"  // alias
};

function resolveGameId(raw: string): string | null {
  return GAME_REGISTRY[raw?.toLowerCase()] ?? null;
}
```

> **Multi-app upgrade (2026-07-06):** a hardcoded constant means every new game requires a server build + rollout — the opposite of the platform goal. §19.3 replaces this with a storage-backed, cached app registry (`ivx_app_registry`) so onboarding a new app is a Console write, exactly like the proven `qv_config/global` remote-config pattern.

### 5.4 Cross-Game Friend Graph

The global friend graph stays global — this is correct. A friendship is a **global relationship between two people**, not a game-specific one. What changes:

| Feature | Scope | Why |
|---------|-------|-----|
| Friend relationship (added/removed/blocked) | Global | Supercell design: friendship transcends a single game |
| Friend presence (online/offline, what game) | Per-game | "Is my friend in QuizVerse right now?" |
| Friend challenges | Per-game | A QuizVerse challenge is only visible in QuizVerse |
| Friend streaks | Per-game | Streaks are tied to quiz activity |
| Group membership | Per-game | A QuizVerse group is not visible in LastToLive |
| Group leaderboards | Per-game | Scores are game-specific |

---

## 6. Unified Friend Graph Design

### 6.1 Response Envelope (New Standard)

**ALL** social RPCs will return this shape:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_<uuid>",
    "gameId": "quizverse",
    "gameUuid": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "timestamp": "2026-06-29T13:00:00Z",
    "nextCursor": null
  }
}
```

Error shape:
```json
{
  "success": false,
  "error": "Human readable message",
  "errorCode": "machine_stable_code",
  "meta": { "requestId": "req_...", "gameId": "quizverse", "timestamp": "..." }
}
```

**No more dual-envelope format.** All JS modules will be migrated to use a shared `socialEnvelope.ok()` / `socialEnvelope.fail()` helper.

### 6.2 Friend List RPC — `ivx_social_friends_list`

**Request:**
```json
{
  "gameId": "quizverse",
  "limit": 100,
  "cursor": "",
  "state": null,
  "includePresence": true,
  "includeActivity": true
}
```

**Response `data`:**
```json
{
  "friends": [
    {
      "userId": "<uuid>",
      "username": "player1",
      "displayName": "Player One",
      "avatarUrl": "https://...",
      "country": "US",
      "relationshipStatus": "friend",
      "state": 0,
      "presence": {
        "online": true,
        "gameId": "quizverse",
        "gameName": "QuizVerse",
        "lastSeenMs": 1751202000000,
        "status": "in_game"
      },
      "gameActivity": {
        "xpThisWeek": 1200,
        "quizzesThisWeek": 7,
        "lastPlayedAt": "2026-06-29T10:00:00Z"
      }
    }
  ],
  "count": 12,
  "myCountry": "IN"
}
```

**Server logic:**
1. Fetch friends from Nakama graph (one `nk.friendsList` call)
2. Build `userIds` array
3. Batch-read `ivx_game_presence/{gameId}_{userId}` for all friends in **one** `storageRead` call
4. Batch-read game activity from `ivx_game_player_stats/{gameId}_{userId}` in **one** SQL query
5. Flatten and return

**Performance target:** < 200ms for 100 friends

### 6.3 Friend Invite Flow (Fixed)

```
ivx_social_invite_send(gameId, targetUserId)
  │
  ├─ 1. Validate input (gameId, UUID, self-check)
  ├─ 2. Check rate limit: {userId}_{targetUserId} per 30s (PER-PAIR, not per-user)
  ├─ 3. Verify target exists
  ├─ 4. Read Nakama relation (single nk.friendsList with state filter)
  │    ├─ state=0 (FRIEND)        → return {alreadyFriends: true}
  │    ├─ state=1 (INVITE_SENT)   → return {alreadySent: true, inviteId}
  │    └─ state=2 (INVITE_RECV)   → auto-accept (nk.friendsAdd + notification)
  ├─ 5. nk.friendsAdd(senderId, [targetId])          ← THE SPLIT-BRAIN FIX (keep)
  ├─ 6. Write invite to ivx_social_invites collection (target as owner)
  └─ 7. Push notification (in-app + FCM/APNS, non-fatal)
```

**Key fix for B-009:** Rate limit key is `rl_invite_{min(senderId, targetId)}_{max(senderId, targetId)}` — normalized pair so both directions share the same bucket.

### 6.4 Accept Invite Flow (Single Path)

The current 3-tier Unity fallback is a symptom of server-side unreliability. The new design makes the server reliable so the client has ONE path:

```
ivx_social_invite_accept(gameId, fromUserId)
  │
  ├─ 1. Look up invite: ivx_social_invites/inv_{fromUserId}_{sessionUserId}
  │    OR derive from Nakama graph state=2 (INVITE_RECEIVED from fromUserId)
  ├─ 2. nk.friendsAdd(acceptorId, [fromUserId]) → transitions both to FRIEND
  ├─ 3. Mark invite row accepted (version-checked write)
  └─ 4. Notify sender (notification + FCM/APNS, non-fatal)
```

**No fallback needed.** If the storage row is missing (migrated user), the Nakama graph state=2 proves the invite exists — accept anyway, create or update the storage row.

---

## 7. Groups / Guilds Architecture

### 7.1 Group Storage Schema (New)

```
Collection: ivx_groups_meta
  Key: {groupId}
  Owner: system (00000000-...)
  Value:
    {
      "groupId":        "<uuid>",
      "gameId":         "quizverse",
      "gameUuid":       "126bf539-...",
      "name":           "Quiz Masters",
      "creatorId":      "<uuid>",
      "joinPolicy":     "open|private|invite_only",
      "badge":          "badge_id",
      "avatarUrl":      "https://...",
      "maxCount":       50,
      "inviteCode":     "QM-XK94",        ← NEW: 6-char shareable code
      "inviteCodeExp":  null,              ← null = never expires
      "langTag":        "en",
      "createdAt":      "2026-06-29T00:00:00Z",
      "updatedAt":      "2026-06-29T00:00:00Z"
    }

Collection: ivx_groups_progress
  Key: {groupId}
  Owner: system
  Value:
    {
      "level": 3, "xp": 250, "totalXpEarned": 2500,
      "weeklyXp": 120, "weeklyReset": "2026-06-30T00:00:00Z",
      "score": 4500, "trophies": 12
    }

Collection: ivx_groups_wallet
  Key: {groupId}                           ← renamed from group_wallet_{groupId}
  Owner: system
  Value: { "tokens": 0, "gems": 0 }

Collection: ivx_groups_invite_codes
  Key: {inviteCode}
  Owner: system
  Value:
    {
      "groupId": "<uuid>",
      "gameId": "quizverse",
      "createdBy": "<uuid>",
      "createdAt": "...",
      "expiresAt": null,
      "maxUses": null,
      "useCount": 0
    }
```

### 7.2 Group List RPC — `ivx_social_group_list_mine`

**The core fix for B-008:** Filtering by `gameId` happens at the query level.

```
ivx_social_group_list_mine(gameId, limit, cursor)
  │
  ├─ 1. nk.userGroupsList(userId) → all groups
  ├─ 2. Extract groupIds from result
  ├─ 3. Batch-read ivx_groups_meta for all groupIds (single storageRead call)
  ├─ 4. Filter by meta.gameId === resolvedGameUuid
  └─ 5. Merge Nakama group shape + ivx_groups_meta + ivx_groups_progress
```

**Alternative (more efficient):** Add a CockroachDB index on `ivx_groups_meta` by `(gameId, groupId)` and do a single SQL JOIN.

```sql
SELECT gm.value->>'groupId', gm.value->>'name', ug.state
FROM user_groups ug
JOIN storage gm ON gm.key = ug.group_id AND gm.collection = 'ivx_groups_meta'
WHERE ug.user_id = $1
  AND gm.value->>'gameId' = $2
ORDER BY gm.value->>'createdAt' DESC
LIMIT $3
```

### 7.3 Group Invite Links (NEW Feature)

Inspired by Supercell's Clash of Clans "Share Link" and Discord's server invite links.

```
ivx_social_group_invite_link(groupId, expiresInHours?, maxUses?)
  │
  ├─ 1. Auth check — must be group Owner or Admin
  ├─ 2. Generate 6-char alphanumeric code: "QM-XK94"
  ├─ 3. Store in ivx_groups_invite_codes/{code}
  ├─ 4. Update ivx_groups_meta/{groupId} with inviteCode
  └─ 5. Return { inviteCode, deepLinkUrl: "quizverse://group/join/QM-XK94" }

ivx_social_group_join_by_code(gameId, inviteCode)
  │
  ├─ 1. Look up ivx_groups_invite_codes/{inviteCode}
  ├─ 2. Validate expiry + maxUses
  ├─ 3. Validate gameId matches
  ├─ 4. nk.groupUserJoin(groupId, userId, username)
  ├─ 5. Increment useCount on invite code row
  └─ 6. Return group details
```

### 7.4 Group Search RPC — `ivx_social_group_search`

Replaces Unity's direct `client.ListGroupsAsync` which cannot filter by `gameId`.

```
ivx_social_group_search(gameId, query?, sort?, limit, cursor)
  │
  ├─ SQL: SELECT g.id, g.name, sm.value as meta
  │        FROM groups g
  │        JOIN storage sm ON sm.key = g.id AND sm.collection = 'ivx_groups_meta'
  │        WHERE sm.value->>'gameId' = $1
  │          AND (query IS NULL OR g.name ILIKE '%' || $2 || '%')
  │        ORDER BY g.edge_count DESC
  │        LIMIT $3
  └─ Return flat group cards with meta + member count
```

---

## 8. Presence & Online Status System

### 8.1 Current Problems

- Single `player_presence/status` key — no per-game isolation
- 5-minute online threshold hardcoded — not configurable  
- No reconnect/disconnect events — stale `online: true` on crash
- `loadOnlineMap` duplicated in two TS files

### 8.2 New Presence Model

**Inspired by Supercell's presence system**: player state is a hierarchical map, namespaced by game.

```
Collection: ivx_presence_v2
  Key: {gameId}_{userId}
  Owner: userId
  Value:
    {
      "userId":       "<uuid>",
      "gameId":       "quizverse",
      "gameUuid":     "126bf539-...",
      "online":       true,
      "status":       "browsing|in_quiz|idle|in_group_chat",
      "lastSeenMs":   1751202000000,
      "sessionId":    "<uuid>",       ← NEW: tracks if client refreshed
      "deviceType":   "mobile|tablet|webgl",
      "updatedAt":    1751202000000
    }
```

**Heartbeat contract:**
- Client calls `ivx_social_presence_set` every **60 seconds** (was implicit, now explicit contract)
- Client calls `ivx_social_presence_set` with `{ online: false }` on `OnApplicationQuit`
- Server considers a player "online" if `lastSeenMs` is within **150 seconds** (⚠️ ADJUSTED 2026-07-06: 90s tolerates only ONE missed heartbeat on a 60s cadence — on flaky mobile networks that produces visible online/offline flapping. 150s = two missed beats + jitter; still 2× fresher than the old 5-minute window.)
- Server considers a player "recent" if `lastSeenMs` is within **24 hours** (for activity feeds)

**Use the platform first (added 2026-07-06):** Nakama ships a **native status system** — `socket.updateStatus(status)` publishes presence, and `socket.followUsers(...)` / status events push online/offline changes to subscribed clients in realtime with zero polling and zero storage writes. The world-class design is a **hybrid**:

| Concern | Mechanism |
|---|---|
| "Is my friend online RIGHT NOW?" (live UI dot) | Nakama native status follow — realtime socket events, free with the connection |
| "When was my friend last seen?" (durable, offline-safe) | `ivx_presence_v2` storage row via the heartbeat above |
| "What is my friend doing?" (rich presence: in_quiz, browsing) | Status string payload on `updateStatus` mirrored into the storage row |

The storage-only design in this section remains the durable source of truth (AP-003 still applies — socket state alone is NOT presence), but every RPC round-trip spent polling `online` for users the client could follow natively is wasted capacity. Unity's `IVXFriendsManager` socket bridge (§18.1) is the natural home for the follow subscription.

**Bulk presence read (new RPC):**
```
ivx_social_presence_bulk_get(gameId, userIds[])
  │
  ├─ Single storageRead for all {gameId}_{userId} keys
  └─ Return map: { userId → { online, status, lastSeenMs } }
```

This replaces the duplicated `loadOnlineMap` helper. All friend RPCs call this single shared RPC helper internally.

---

## 9. Notification & Event Bus Design

### 9.1 Notification Architecture (Inspired by Discord + Supercell)

Three distinct notification channels, each with different guarantees:

```
┌──────────────────────────────────────────────────────────────┐
│              NOTIFICATION TIERS                               │
│                                                              │
│  Tier 1: Realtime Socket (ephemeral)                         │
│    → Nakama WebSocket notification codes                     │
│    → For: online users only                                  │
│    → Guarantee: best-effort (lost if socket drops)           │
│                                                              │
│  Tier 2: Notification Inbox (durable)                        │
│    → ivx_notification_inbox/{userId}/{notifId}               │
│    → For: all users (online + offline)                       │
│    → Guarantee: persisted, survives reconnect                │
│    → Client polls on reconnect (not on active session)       │
│                                                              │
│  Tier 3: Device Push (FCM / APNS)                            │
│    → For: offline users                                      │
│    → Guarantee: best-effort OS delivery                      │
│    → Separate try/catch from Tier 1+2 (B-006 fix)           │
└──────────────────────────────────────────────────────────────┘
```

### 9.2 Notification Payload Contract (New Standard)

All notifications carry:
```json
{
  "notifId":    "ntf_<uuid>",
  "type":       "friend_invite|challenge|group_join|...",
  "gameId":     "quizverse",
  "code":       1,
  "subject":    "friend_request",
  "senderId":   "<uuid>",
  "senderName": "Player One",
  "data":       { ... type-specific payload ... },
  "createdAt":  "2026-06-29T13:00:00Z",
  "expiresAt":  "2026-07-06T13:00:00Z"
}
```

### 9.3 Notification Code Registry (Expanded)

| Code | Type | Subject | Delivery |
|------|------|---------|---------|
| 1 | `friend_invite` | `friend_request` | T1 + T2 + T3 |
| 2 | `friend_invite_accepted` | `friend_request_accepted` | T1 + T2 + T3 |
| 3 | `friend_invite_declined` | `friend_request_declined` | T1 + T2 |
| 4 | `friend_invite_cancelled` | `friend_request_cancelled` | T1 + T2 |
| 5 | `friend_removed` | `friend_removed` | T1 |
| 10 | `challenge_sent` | `friend_challenge` | T1 + T2 + T3 |
| 11 | `challenge_accepted` | `friend_challenge_accepted` | T1 + T2 + T3 |
| 12 | `challenge_declined` | `friend_challenge_declined` | T1 + T2 |
| 13 | `challenge_cancelled` | `friend_challenge_cancelled` | T1 + T2 |
| 14 | `challenge_expired` | `friend_challenge_expired` | T2 |
| 20 | `group_invite` | `group_invite` | T1 + T2 + T3 |
| 21 | `group_joined_approved` | `group_join_approved` | T1 + T2 + T3 |
| 22 | `group_member_joined` | `group_member_joined` | T1 + T2 |
| 23 | `group_member_left` | `group_member_left` | T1 |
| 30 | `social_nudge` | `friend_streak_at_risk` | T2 + T3 |
| 31 | `social_nudge` | `friend_passed_you` | T2 + T3 |
| 500 | `group_sync` | `group_joined` | T1 (cross-device) |
| 501 | `group_sync` | `group_left` | T1 (cross-device) |

### 9.4 Push Notification Isolation (B-006 Fix)

Currently, push delivery failure can mask in-app notification delivery failure. New design:

```typescript
async function deliverNotification(
  nk: Nakama, userId: string, notif: SocialNotification
): Promise<void> {
  // Tier 2 — persisted inbox (MUST succeed)
  await writeToInbox(nk, userId, notif);  // throws on failure → caller handles

  // Tier 1 — realtime socket (independent try/catch)
  try { await nk.notificationsSend([toNakamaNotif(notif)]); }
  catch (e) { logger.warn("T1 socket delivery failed (non-fatal)"); }

  // Tier 3 — device push (independent try/catch)
  try { await sendDevicePush(nk, userId, notif); }
  catch (e) { logger.warn("T3 push delivery failed (non-fatal)"); }
}
```

---

## 10. Rate Limiting & Anti-Abuse Layer

### 10.1 Rate Limit Matrix

| Action | Limit | Key |
|--------|-------|-----|
| Send friend invite | 1 per **pair** per 30s | `rl_invite_{pairKey}` |
| Send friend invite (global) | 20 per user per hour | `rl_invite_global_{userId}` |
| Send challenge | 1 per pair per 30s | `rl_challenge_{pairKey}` |
| Accept/decline invite | 1 per inviteId (intrinsic via status check) | — |
| Create group | 3 per user per 24h | `rl_group_create_{userId}` |
| Send group chat | 30 per user per minute | `rl_gchat_{userId}` |
| Search players | 5 per user per second | `rl_search_{userId}` |
| Set presence | 1 per user per 30s (client enforces 60s) | — |

### 10.2 Rate Limit Storage (Optimized)

Current implementation stores rate limit rows in `rate_limits` collection — one row per action. New approach uses a **sliding window counter** stored in a single row per user to reduce storage reads:

```json
Collection: ivx_rate_limits
  Key: {userId}
  Value: {
    "invite_send_global": { "count": 3, "windowStart": 1751202000000 },
    "group_create":       { "count": 1, "windowStart": 1751202000000 },
    "search":             { "count": 2, "windowStart": 1751202000000 }
  }
```

This reduces the rate-limit storage read from N reads (one per action type) to **1 read per request**.

---

## 11. Storage Schema Blueprint

### 11.1 Complete Collection Map (New)

| Collection | Key Pattern | Owner | Purpose |
|------------|-------------|-------|---------|
| `ivx_social_invites` | `inv_{sender}_{target}` | target | Friend invite lifecycle (unchanged key) |
| `ivx_presence_v2` | `{gameId}_{userId}` | userId | Per-game presence (replaces `player_presence`) |
| `ivx_game_challenges` | `{gameId}/chg_{id}` | recipient | Per-game challenge inbox |
| `ivx_game_challenges_out` | `{gameId}/chg_{id}` | sender | Per-game challenge outbox |
| `ivx_groups_meta` | `{groupId}` | system | Group metadata + gameId + invite code |
| `ivx_groups_progress` | `{groupId}` | system | XP, level, trophies |
| `ivx_groups_wallet` | `{groupId}` | system | Shared group tokens |
| `ivx_groups_activity` | `{groupId}_{actId}` | system | Activity feed |
| `ivx_groups_invite_codes` | `{code}` | system | Shareable group invite codes |
| `ivx_notification_inbox` | `{notifId}` | userId | Durable notification inbox |
| `ivx_rate_limits` | `{userId}` | userId | Consolidated rate limit counters |
| `ivx_game_player_stats` | `{gameId}_{userId}` | userId | Weekly XP, quiz count (for friend activity) |
| `ivx_user_blocks` | `blk_{blocker}_{blocked}` | blocker | Block list (unchanged semantics) |
| `ivx_friend_streaks` | `{gameId}_{pairKey}` | system | Per-game friend streaks |
| `geo_tier` | `resolved` | userId | Country cache (unchanged) |

### 11.2 Legacy Collection Deprecation Plan

| Old Collection | Replace With | Migration |
|---------------|-------------|-----------|
| `player_presence` → | `ivx_presence_v2` | Dual-write during transition |
| `friend_invites` → | `ivx_social_invites` | New key prefix (no data migration needed for new invites) |
| `friend_challenges` → | `ivx_game_challenges` | New collection with gameId in key |
| `group_wallets` → | `ivx_groups_wallet` | Rename with data migration job |
| `group_activity_{groupId}` → | `ivx_groups_activity` | Consolidate per-group pattern |
| `notification_inbox` → | `ivx_notification_inbox` | New collection, old inbox read-only |
| `rate_limits` → | `ivx_rate_limits` | Consolidated per-user schema |

---

## 12. RPC Consolidation Plan

### 12.1 Current RPC Count (Social Layer)

Total social RPCs currently: **34 active** + **3 legacy aliases** + **7 hiro aliases** = **44**

### 12.2 New Consolidated RPC Set

| New RPC | Replaces | Notes |
|---------|---------|-------|
| `ivx_social_friends_list` | `friends_list` | Add game activity, unified envelope |
| `ivx_social_friend_search` | `intelliverse_find_friends` | Keep search logic, new envelope |
| `ivx_social_friend_nearby` | `intelliverse_find_nearby_players` | Keep geo logic, new envelope |
| `ivx_social_invite_send` | `send_friend_invite` | Fix B-009 pair rate limit |
| `ivx_social_invite_accept` | `accept_friend_invite` | Remove 3-tier fallback |
| `ivx_social_invite_decline` | `decline_friend_invite` | Unchanged logic |
| `ivx_social_invite_cancel` | `cancel_friend_invite` | Unchanged logic |
| `ivx_social_invites_pending` | `list_pending_friend_invites` | Unchanged logic |
| `ivx_social_friend_remove` | `friends_remove` | Unchanged |
| `ivx_social_friend_block` | `friends_block` | Unchanged |
| `ivx_social_friend_unblock` | `friends_unblock` | Unchanged |
| `ivx_social_presence_set` | `ivx_set_player_presence` | 90s online threshold |
| `ivx_social_presence_bulk` | `loadOnlineMap` helper | Public RPC |
| `ivx_social_group_create` | `create_quizverse_group` | + invite code generation |
| `ivx_social_group_list_mine` | `get_user_groups` | Server-side gameId filter |
| `ivx_social_group_search` | `client.ListGroupsAsync` | New — server-side |
| `ivx_social_group_detail` | `get_group_details` | Unified meta source |
| `ivx_social_group_join` | `JoinGroupAsync` (SDK) | Wrapped for gameId validation |
| `ivx_social_group_leave` | `LeaveGroupAsync` (SDK) | Wrapped |
| `ivx_social_group_invite_link` | *(new)* | Shareable group codes |
| `ivx_social_group_join_by_code` | *(new)* | Deep link join |
| `ivx_social_challenge_send` | `send_friend_challenge` | Fix B-010 alias |
| `ivx_social_challenge_accept` | `accept_friend_challenge` | Unchanged |
| `ivx_social_challenge_decline` | `decline_friend_challenge` | Unchanged |
| `ivx_social_challenge_cancel` | `cancel_friend_challenge` | Unchanged |
| `ivx_social_challenges_pending` | `list_pending_friend_challenges` | Add gameId filter |

**Total: 26 RPCs** (down from 44, including aliases)

### 12.3 Old RPCs — Deprecation Strategy

Old RPCs remain registered and functional during the transition period. They become **thin wrappers** that call the new `ivx_social_*` handlers internally with `gameId: "quizverse"` hardcoded. This allows:
- Zero breaking changes to the Unity client until it's ready to migrate
- Gradual rollout to new RPC names

---

## 13. Unity Client Contract Changes

> **Note:** These are the client-side changes that pair with the new server design. Implement after server is stable.

### 13.1 Single Response Model

Unity's `FriendsNakamaModels.cs` should have one generic wrapper:

```csharp
[Serializable]
public class SocialResponse<T>
{
    public bool success;
    public T data;
    public SocialMeta meta;
    public string error;
    public string errorCode;
}

[Serializable]
public class SocialMeta
{
    public string requestId;
    public string gameId;
    public string timestamp;
    public string nextCursor;
}
```

### 13.2 Remove 3-Tier Fallback (B-007 Fix)

```csharp
// OLD — 3 tier fallback
public async Task<AcceptResult> AcceptAsync(...)
{
    // Tier 1: try with canonical inviteId
    // Tier 2: if failed, list pending and retry
    // Tier 3: if still failed, call client.AddFriendsAsync
}

// NEW — single reliable call
public async Task<SocialResponse<FriendData>> AcceptAsync(string fromUserId)
{
    var payload = JsonUtility.ToJson(new { gameId = _gameId, fromUserId = fromUserId });
    var result = await _client.RpcAsync(_session, "ivx_social_invite_accept", payload);
    return JsonUtility.FromJson<SocialResponse<FriendData>>(result.Payload);
}
```

### 13.3 Presence Heartbeat Contract

```csharp
// Client must call this every 60 seconds while in the Social Zone or any active game
// AND on app pause/quit
public async Task SetPresenceAsync(bool online = true, string status = "browsing")
{
    // ... RPC ivx_social_presence_set
}

// On app quit:
void OnApplicationQuit() => SetPresenceAsync(online: false).FireAndForget();
```

---

## 14. Dry-Run: Critical User Flows

### 14.1 Flow: New Player Sends First Friend Request

```
Player A (userId: A) wants to add Player B (userId: B) in QuizVerse

CLIENT (A):
  1. SearchPlayersAsync("playerB_name")
     → RPC ivx_social_friend_search { gameId: "quizverse", query: "playerB_name" }
     → Returns player B with relationshipStatus: "none"
  2. Tap "+" on Player B row
     → RPC ivx_social_invite_send { gameId: "quizverse", targetUserId: B }

SERVER:
  1. Validate: gameId=quizverse ✓, B is valid UUID ✓, A≠B ✓
  2. Rate limit: "rl_invite_{min(A,B)}_{max(A,B)}" - first call → allowed
  3. B exists: nk.usersGetId([B]) ✓
  4. Read Nakama relation (A→B): nk.friendsList(A, 1, null, null) filtered for B
     → state = -1 (no relation)
  5. Block check: storageRead ivx_user_blocks/blk_{A}_{B} and blk_{B}_{A} → none
  6. nk.friendsAdd(A, ctx.username, [B], null, {})
     → Nakama marks A→B as INVITE_SENT, B→A as INVITE_RECEIVED
  7. Write ivx_social_invites/inv_{A}_{B} under B (owner=B)
  8. deliverNotification(B, { type: "friend_invite", code: 1, senderId: A, ... })
     → Tier 2: inbox write ✓
     → Tier 1: nk.notificationsSend([{ userId: B, code: 1, ... }]) ✓ (if online)
     → Tier 3: FCM push ✓
  9. Return { success: true, data: { inviteId: "inv_A_B", status: "pending" } }

CLIENT (A):
  3. Optimistic UI: change "+" to "Cancel" (no refresh needed)
  4. Subscribe to notification stream: code 2 means "accepted"
```

### 14.2 Flow: Player B Accepts the Friend Request

```
Player B receives push notification / opens app

CLIENT (B):
  1. App opens → LoadFriendsData()
     → RPC ivx_social_friends_list { gameId: "quizverse", state: 2 }
     → Returns A in list with relationshipStatus: "pending_received"
  2. B taps "Accept"
     → RPC ivx_social_invite_accept { gameId: "quizverse", fromUserId: A }

SERVER:
  1. Read ivx_social_invites/inv_{A}_{B} (owner=B)
     → invite found, status=pending, targetUserId=B=ctx.userId ✓
  2. nk.friendsAdd(B, ctx.username, [A], [], {})
     → Both A and B now have state=0 (FRIEND) in Nakama graph
  3. Version-checked write: invite.status = "accepted"
  4. deliverNotification(A, { type: "friend_invite_accepted", code: 2, ... })
  5. Return { success: true, data: { friendUserId: A, friendDisplayName: "Player A" } }

CLIENT (B):
  3. Refresh friends list → A appears as confirmed friend
  4. No fallback needed — single success path
```

### 14.3 Flow: Create Group + Generate Invite Link

```
CLIENT (Owner):
  1. Create group form submitted
     → RPC ivx_social_group_create {
         gameId: "quizverse", name: "Quiz Masters",
         privacy: "private", badge: "badge_2", maxCount: 50
       }

SERVER:
  1. Check coin balance: ≥ 500 coins ✓
  2. Deduct coins atomically
  3. nk.groupCreate(userId, "Quiz Masters", ..., metadata, 50)
  4. Write ivx_groups_meta/{groupId}: { gameId: "quizverse", joinPolicy: "private", inviteCode: null }
  5. Write ivx_groups_progress/{groupId}: { level: 1, xp: 0 }
  6. Write ivx_groups_wallet/{groupId}: { tokens: 0 }
  7. Return { success: true, data: { group: { id, name, ... }, coinsSpent: 500 } }

CLIENT (Owner):
  2. Tap "Share Group"
     → RPC ivx_social_group_invite_link { groupId, expiresInHours: 48 }

SERVER:
  1. Verify caller is Owner (role=0 from nk.userGroupsList)
  2. Generate code: "QM-XK94" (6 chars, alphanumeric, unique)
  3. Write ivx_groups_invite_codes/QM-XK94: { groupId, gameId, expiresAt: +48h }
  4. Update ivx_groups_meta/{groupId}: { inviteCode: "QM-XK94" }
  5. Return { inviteCode: "QM-XK94", deepLink: "quizverse://group/join/QM-XK94" }

CLIENT (Owner):
  3. Shares deep link to WhatsApp / copy to clipboard
```

### 14.4 Flow: Friend Joins Group via Invite Link

```
Friend (Player C) taps the deep link: quizverse://group/join/QM-XK94

CLIENT (C):
  1. App handles deep link → SocialZone opens → RPC ivx_social_group_join_by_code {
       gameId: "quizverse", inviteCode: "QM-XK94"
     }

SERVER:
  1. Read ivx_groups_invite_codes/QM-XK94
     → Found, not expired, useCount < maxUses (or maxUses=null)
  2. Validate gameId matches
  3. nk.groupUserJoin(userId=C, groupId, username)
  4. Increment useCount on invite code
  5. Notification: deliverNotification(Owner, { type: "group_member_joined", code: 22 })
  6. Return { success: true, data: { group: { id, name, ... } } }

CLIENT (C):
  2. Group detail screen opens automatically
  3. Cross-device sync: Owner gets notification code 22 → refreshes "My Groups"
```

---

## 14A. Friends Activity Feed — Gizmo-Style

> **Numbering note (2026-07-06):** this section was originally numbered "15", colliding with Migration Phases below. Renumbered to 14A; all cross-references updated.

### 14A.1 What It Is

A **chronological event stream** showing what your friends have been doing in the game. Like Gizmo's home feed — not just "Maria is online" but **"Maria scored 1,450 in Science Quiz 10 minutes ago."** This is the single highest-retention social feature in edu-games because it creates FOMO and a natural challenge prompt at the same moment.

Without this, the Social Zone answers: *"Who are my friends?"*
With this, it answers: *"What did my friends DO today — and can I beat them?"*

---

### 14A.2 Feed Event Types

| Event Type | Trigger | Display Text |
|-----------|---------|-------------|
| `quiz_completed` | Player finishes a quiz | *"Ana scored 1,450 in Science → Hard"* |
| `challenge_sent` | Player sends a challenge to someone | *"Mike challenged you! Beat his score of 980"* |
| `challenge_won` | Player wins a completed challenge | *"Carlos beat Maria's challenge 1,200 vs 950"* |
| `streak_milestone` | Friend hits 7 / 30 / 100 day streak | *"Priya hit a 7-day streak 🔥"* |
| `group_joined` | Friend joins a group | *"Rahul joined Quiz Masters"* |
| `group_level_up` | A shared group levels up | *"Your group Quiz Masters reached Level 5! 🎉"* |
| `badge_earned` | Friend earns a badge | *"Ana earned the Science Master badge 🏅"* |
| `friend_joined` | A mutual friend joins the game | *"Your contact James just joined QuizVerse"* |

---

### 14A.3 Architecture — Push Fan-Out vs Pull Model

Two approaches. Both have trade-offs:

```
PUSH (Fan-out on write)                   PULL (Compute on read)
──────────────────────────────────────    ──────────────────────────────────────
When Ana completes a quiz:                When Player opens feed:
  → write event to Ana's outbox             → fetch Ana's recent events
  → fan-out to all Ana's friends'           → fetch Mike's recent events
    inboxes                                 → merge and sort all
  Pros: O(1) read per user               Pros: no fan-out writes
  Cons: O(N) writes per action           Cons: O(N) reads per page load
        (N = Ana's friend count)
```

**Recommended: Hybrid model** (same as Facebook/Instagram/Gizmo)

- **Low fan-out users** (< 500 friends): Push model — write to each friend's feed
- **High fan-out users** (> 500 friends): Pull model — compute on read from the author's event log
- Switch threshold configurable server-side

---

### 14A.4 Storage Schema

```
Collection: ivx_friends_feed_events
  Key: {gameId}_{authorUserId}_{eventId}
  Owner: authorUserId
  Retention: 7 days via `expiresAt` field + scheduled cleanup job (§19.7).
             ⚠️ CORRECTED 2026-07-06: Nakama storage has NO native TTL/auto-expiry.
             Every "TTL" in this document means (a) an expiresAt field in the value
             plus (b) a cleanup CronJob deleting expired rows via SQL. Relying on
             read-time filtering alone is exactly the AP-002 anti-pattern.
  Value:
    {
      "eventId":      "evt_<uuid>",
      "eventType":    "quiz_completed",
      "gameId":       "quizverse",
      "authorId":     "<uuid>",
      "authorName":   "Ana",
      "authorAvatar": "https://...",
      "occurredAt":   "2026-06-29T18:00:00Z",
      "data": {
        "quizId":    "sci_hard_001",
        "quizTitle": "Science → Hard",
        "score":     1450,
        "maxScore":  2000,
        "topicTag":  "science"
      },
      "ctaType":     "challenge",
      "ctaLabel":    "Beat this score",
      "ctaPayload":  { "challengeFriendId": "<authorId>", "quizId": "sci_hard_001", "targetScore": 1450 }
    }

Collection: ivx_friends_feed_inbox
  Key: {gameId}_{recipientUserId}_{occurredAt}_{eventId}
  Owner: recipientUserId
  Retention: 7 days (expiresAt field + cleanup job — see TTL correction above)
  Value: { "eventId": "...", "authorId": "..." }   ← thin pointer only, full data in feed_events
```

**Why two collections?**
- `feed_events` — the author owns their own events (readable by friends via server)
- `feed_inbox` — pre-computed per-user inbox for O(1) reads (push model only)

---

### 14A.5 New RPC — `ivx_social_friends_feed`

```
ivx_social_friends_feed(gameId, limit, cursor, eventTypes[]?)
```

**Request:**
```json
{
  "gameId":     "quizverse",
  "limit":      20,
  "cursor":     "",
  "eventTypes": ["quiz_completed", "challenge_won", "streak_milestone"]
}
```

**Response `data`:**
```json
{
  "events": [
    {
      "eventId":     "evt_abc123",
      "eventType":   "quiz_completed",
      "authorId":    "<uuid>",
      "authorName":  "Ana",
      "authorAvatar":"https://...",
      "occurredAt":  "2026-06-29T18:00:00Z",
      "timeAgo":     "10 minutes ago",
      "displayText": "Ana scored 1,450 in Science → Hard",
      "cta": {
        "type":    "challenge",
        "label":   "Beat this score",
        "payload": { "friendId": "<uuid>", "quizId": "sci_hard_001", "targetScore": 1450 }
      }
    }
  ],
  "count": 20,
  "nextCursor": "..."
}
```

**Server logic:**
```
1. Get caller's confirmed friends (nk.friendsList state=0)
2. Fetch friends' events in ONE SQL query against the storage table
   (⚠️ CORRECTED 2026-07-06: `nk.storageRead` requires exact keys, and a
   key-prefix scan per friend means 50 sequential `nk.storageList` calls —
   O(F) round-trips that blow the 300ms budget. Use the same raw-SQL-over-
   storage precedent as §7.2/§7.4):

   SELECT value FROM storage
   WHERE collection = 'ivx_friends_feed_events'
     AND user_id = ANY($1)                        -- friend userIds array
     AND (value->>'gameId') = $2
     AND (value->>'occurredAt') > $3              -- 7-day window
   ORDER BY value->>'occurredAt' DESC
   LIMIT $4
   -- supporting index: see §19.7 (partial index on collection)

3. Apply eventTypes filter (optional) + author privacy settings (§14A.7)
4. Cursor-paginate (cursor = occurredAt of last returned row)
5. Return with pre-computed timeAgo and displayText (server renders text, not client)
```

**Performance target:** < 300ms for 20 events from 50 friends (single SQL read)

---

### 14A.6 Feed Writer — How Events Get Into the Feed

Events are written to `ivx_friends_feed_events` by the **quiz completion flow**, not by the social layer. This is a deliberate separation of concerns:

```
Quiz completion RPC (existing)
  → saves score to leaderboard
  → updates player stats
  → [NEW] calls writeFeedEvent(userId, gameId, "quiz_completed", { score, quizId, ... })
                                    ↓
                         ivx_friends_feed_events/{gameId}_{userId}_{eventId}

ivx_social_friends_feed
  → reads those events for all friends
  → merges + returns feed
```

Feed writer helper (internal, not a public RPC):
```typescript
function writeFeedEvent(nk, userId, gameId, eventType, data, ctaType?, ctaLabel?, ctaPayload?) {
  const eventId = "evt_" + generateId();
  nk.storageWrite([{
    collection: "ivx_friends_feed_events",
    key:        `${gameId}_${userId}_${eventId}`,
    userId:     userId,
    value:      { eventId, eventType, gameId, authorId: userId, occurredAt: now(), data, ctaType, ctaLabel, ctaPayload },
    permissionRead:  1,   // ⚠️ CORRECTED 2026-07-06: owner-read only.
                          // permissionRead: 2 (public) would let ANY authenticated
                          // client read another user's feed events directly via the
                          // storage API — bypassing both the friend check AND the
                          // §14A.7 privacy settings, which are only enforced inside
                          // the RPC. The server RPC reads with system privileges,
                          // so owner-read is sufficient and leak-proof.
    permissionWrite: 0
  }]);
}
```

---

### 14A.7 Privacy Control

Not everyone wants their quiz scores visible to friends. Add to user settings:

```
ivx_social_feed_privacy_set(gameId, settings)
  → Writes to ivx_user_settings/{userId}
  settings: {
    "shareFeedEvents":    true,         ← global toggle
    "shareQuizScores":    true,
    "shareStreakMilestones": true,
    "shareBadges":        false
  }
```

`ivx_social_friends_feed` respects this — if `shareFeedEvents: false`, the friend's events are excluded from the merge.

---

### 14A.8 Feed vs Friends List — What Each Does

| | `ivx_social_friends_list` | `ivx_social_friends_feed` |
|---|---|---|
| **Purpose** | Who are my friends + online status | What did my friends DO today |
| **Update frequency** | Changes when friends add/remove | Changes every time anyone plays |
| **Data shape** | Friend roster (static) | Event stream (time-sorted) |
| **Cache TTL** | 30 seconds | 60 seconds |
| **When to call** | Social Zone opens | Feed tab opens / home widget |
| **Main action** | Send invite / Challenge | Tap CTA on an event (challenge, quiz, group) |

---

## 15. Migration Phases

### Phase 1 — Foundation (No Breaking Changes)

**Goal:** Fix all known bugs, no new features yet

| Task | Target File | Fixes |
|------|-------------|-------|
| Fix B-003: resolve dual `create_game_group` registration | `groups.js` | Remove from `legacy/groups.ts` |
| Fix B-006: isolate push try/catch from inbox | `friend_invites.js` | Push is tier-3, inbox is tier-2 |
| Fix B-008: DB-level gameId filter in `get_user_groups` | `groups.js` | SQL join on ivx_groups_meta |
| Fix B-009: per-pair rate limit in `send_friend_invite` | `friend_invites.js` | New key pattern |
| Fix B-010: remove `friends_challenge_user` alias | `friend_challenges.js` | Single RPC ID |
| Fix B-004: extract `loadOnlineMap` into shared util | `src/social/presence.ts` | DRY |

### Phase 2 — Game-ID Isolation

**Goal:** New per-game presence and challenge storage

| Task | What Changes |
|------|-------------|
| Create `ivx_presence_v2` collection | New presence heartbeat RPC |
| Migrate `player_presence` → `ivx_presence_v2` (dual-write) | Old key still works |
| Add gameId to challenge storage key | `ivx_game_challenges/{gameId}/chg_*` |
| Create `ivx_groups_meta` collection | Backfill from existing groups |
| Add `ivx_social_group_list_mine` RPC with SQL filter | New RPC, old still works |

### Phase 3 — New Feature Layer

**Goal:** Invite links, group search, consolidated RPCs

| Task | What Adds |
|------|-----------|
| `ivx_social_group_invite_link` RPC | Deep link share |
| `ivx_social_group_join_by_code` RPC | Deep link join |
| `ivx_social_group_search` RPC | Server-side filtered browse |
| Unified response envelope on all new RPCs | New standard |
| `ivx_social_friends_feed` RPC | Gizmo-style chronological friend activity stream (see Section 14A) |
| `ivx_social_feed_privacy_set` RPC | Per-user feed privacy settings |

### Phase 4 — Client Migration

**Goal:** Unity migrates to new RPC names, remove old fallbacks

| Task | What Changes |
|------|-------------|
| Unity: use `ivx_social_friends_list` | Remove old fallback to `client.ListFriendsAsync` |
| Unity: remove 3-tier accept fallback | Single `ivx_social_invite_accept` call |
| Unity: use `ivx_social_group_list_mine` | Remove client-side gameId filter |
| Unity: single response envelope model | New DTOs in `FriendsNakamaModels.cs` |
| Server: mark old RPCs as deprecated | Log warning on each old RPC call |

### Phase 5 — Old RPC Removal (v-next)

After Unity release stabilizes (2+ weeks), remove:
- `friends_list`, `list_blocked_users` (→ `ivx_social_friends_list`)
- `intelliverse_find_friends` (→ `ivx_social_friend_search`)
- `send_friend_invite` / `accept_friend_invite` / etc. (→ `ivx_social_invite_*`)
- `create_quizverse_group` (→ `ivx_social_group_create`)
- `get_user_groups` (→ `ivx_social_group_list_mine`)
- Legacy aliases: `friends_challenge_user`, `hiro_*`

---

## 16. Non-Goals & Out of Scope

| Item | Why Out of Scope |
|------|-----------------|
| Voice chat | Requires WebRTC infrastructure — separate initiative |
| Real-time match spectating | Multiplayer server concern, not social layer |
| Social media auth (Facebook/Google) | Handled by `IVXNManager` OAuth layer |
| Cross-game group membership | Each group belongs to one game by design |
| Migrating historical `friend_invites` rows | Product decision: old pending rows expire naturally |
| Clan Wars / competitive group events | Feature not yet designed at product level |
| Adding new game modes | Out of scope (per AGENTS.md) |
| Changing singleton patterns | Out of scope (per AGENTS.md) |

---

## 17. Live Codebase Validation & New Opportunities — 2026-07-04 Update

> **Method:** Re-read this document against the live Unity client (`Assets/_QuizVerse/Scripts/`) and the live Nakama server (`data/modules/src/` + deployed `data/modules/*.js` + compiled `data/modules/index.js`), plus fresh 2026 research on Duolingo Leagues/Friends Quests and the Gizmo Study Group flow. This section validates the original audit against ground truth and adds new, smaller, high-leverage findings that weren't visible from code analysis alone on 2026-06-29.

### 17.1 Bug Audit — Validated Against Code

| # | Original Claim | Verdict | Evidence |
|---|----------------|---------|----------|
| B-001 | Historical split-brain in `friend_invites.js` | ✅ **Confirmed, fix present** | `friend_invites.js:448-454` now calls `nk.friendsAdd()` on send — the "SPLIT-BRAIN FIX" comment is in the live file |
| B-003 | Dual registration of `create_game_group` / `get_user_groups` | ✅ **Confirmed — worse than described** | THREE independent implementations exist in source: `data/modules/legacy_runtime.js` (`rpcCreateGameGroup`), `data/modules/src/legacy/groups.ts` (compiled in), and the deployed `groups.js` registers the differently-named `create_quizverse_group`. The compiled `index.js` only shows **one** winning `registerRpc("create_game_group", …)` because postbuild's `__rpc_create_game_group = fn` variable-assignment pattern silently overwrites — confirming the "winner determined by merge order, not intent" risk is real and currently live, not hypothetical |
| B-007 | Unity 3-tier accept fallback | ✅ **Confirmed** | `FriendInviteActionHelper.cs` still has the fallback chain including a bypass to `client.AddFriendsAsync` (Nakama SDK direct call) |
| B-009 | Invite rate limit is per-user not per-pair | ✅ **Confirmed** | `friend_invites.js:65-66`: `FRIEND_INV_RATELIMIT_KEY = 'fr_invite_send'` keyed only by `fromUserId` — a user can invite-spam N different targets at 1-per-5s with zero per-pair cap |
| B-010 | `friends_challenge_user` duplicate alias | ✅ **Confirmed** | Unity's own RPC constant table calls out `send_friend_challenge (+ legacy alias friends_challenge_user)` as a known duplicate-call risk from different code paths |

**Everything audited in Section 2 checks out.** No original findings were invalidated by live code — this plan's diagnosis is sound.

### 17.2 Major New Finding — A Second Social Layer Already Exists, Unregistered

The single biggest opportunity this document missed: **`data/modules/social_v2/social_v2.js` contains 12 fully-written RPC handlers that are never wired to `registerRpc` and are therefore 100% dead/unreachable code**, plus `data/modules/copilot/social_features.js` which is explicitly headed "THIS FILE IS DEAD CODE — DO NOT EDIT."

The unregistered handlers in `social_v2.js` map almost exactly onto the Duolingo/Gizmo mechanics this plan is trying to design from scratch:

| Dead handler | Duolingo/Gizmo equivalent | Plan section it would satisfy |
|---|---|---|
| `rpcDailyDuoCreate` / `rpcDailyDuoStatus` | **Duolingo Friends Quests** — weekly random-paired co-op challenge | Not currently in this plan at all — see 17.5 |
| `rpcTeamQuizCreate` / `rpcTeamQuizJoin` | **Gizmo Study Group live quiz** — synchronized group quiz session | Related to §14A activity feed but this is the missing real-time piece |
| `rpcGroupQuestCreate` / `rpcGroupQuestProgress` | **Gizmo "group goals"** — collaborative weekly target | §7 Groups (partially — this is more specific than `ivx_groups_progress`) |
| `rpcGroupActivityFeed` | Friends activity feed | Overlaps with the new §14A `ivx_social_friends_feed` — likely a first draft of it |
| `rpcGetRivalry` / `rpcFriendScoreAlert` | **Duolingo "Maria just passed you"** loss-aversion nudge | Directly overlaps with §E.6 "friendsAheadOfMe" — this may already be a working implementation |
| `rpcChallengeAccept` / `rpcChallengeDecline` / `rpcChallengeList` | Generic challenge lifecycle | Overlaps with `friend_challenges.js` (the live system) — likely superseded, but worth diffing before deleting |

**Recommendation:** Before building any new RPC in Phase 3, **read and diff `social_v2.js` against the equivalent new RPC design**. Some of this may be salvageable — reducing net-new engineering for `rivalry`/`friendScoreAlert` (§E.6) and `dailyDuo` (a genuinely new idea, see 17.5) to a *revival + hardening* task instead of a from-scratch build. This is the single cheapest way to close several "High priority" gaps from Appendix E's action list (G-020 especially).

### 17.3 Unity Client — Redundant Systems & Shipped-But-Invisible Backend Work

The Unity-side audit surfaced structural debt that has direct product impact and isn't in the original plan (which focused on the server):

1. **Three parallel group/clan systems ship in the client, only one is live.** `SocialZoneV2Controller` + `GroupsNakamaService` (→ `create_quizverse_group`) is the production path. `ClanManager` (`Trivia.Clan`) is a **complete, working backend manager with zero UI** — `HomeScreen.OnClanClicked()` shows a "Coming Soon" popup because `UIClanScreen` was never built. `GuildManager` is `[Obsolete]` but **`D7D30RetentionBootstrap` still calls it** for XP/contribution flows. This means there is already a working Clans backend (challenges, leaderboard, contributions, gem-based creation) sitting idle behind a placeholder popup — directly relevant to closing the "Groups" gap this plan spends Section 7 designing, since a Clan-style system with challenges/leaderboards is arguably *more* Duolingo-League-like than the current cooperative QuizVerse group.
2. **Two chat stacks coexist**: `UnifiedChatController` (UIToolkit, Social Zone-native) and `UIChatMainController` (legacy uGUI, still owns `gift_send`). Any new social feature that touches chat needs to pick one, or gift-sending silently breaks.
3. **Misleading diagnostics**: Social Zone code logs `"Calling RPC 'intelliverse_friends_list'"` but the actual call is to `FriendsNakamaService.GetFriendsListAsync` → RPC `friends_list`. Harmless today, but will actively mislead whoever debugs the Phase 4 client migration to `ivx_social_friends_list`.
4. **`SocialPressureManager` (client-side retention UI) currently renders *simulated/mock* friend activity**, not real data — meaning the "social pressure" screen a player sees today is fake. This is a strong argument for prioritizing §E.6/G-020 (real `ivx_social_pressure_summary` with `friendsAheadOfMe`) — there's already a UI slot waiting for real data, which lowers the client-side lift for that item to near-zero.

### 17.4 Documentation Debt Discovered

`docs/COMPLETE_RPC_REFERENCE.md` documents roughly 18 social RPCs. The live server has **70+** registered social RPCs across friends/presence/invites/challenges/streaks/quests/groups/chat/notifications. The doc also lists `friends_add` as a real RPC — it does not exist (the actual paths are `send_friend_invite`, the Nakama SDK's `AddFriendsAsync`, or the alias `hiro_friends_add`). Any RPC consolidation work (Phase 3-5) should regenerate this reference from `index.js` rather than hand-edit it, or it will be stale again within a week.

### 17.5 Competitive Refresh (2026) — Two Mechanics Missing From the Original Research

Fresh research surfaced two specific, well-documented Duolingo mechanics that are more precise than what Section 3.2 captured, plus confirmation of the Gizmo real-time group quiz flow:

**Duolingo Leagues (tiered ladder, not just "weekly leaderboard"):**
- Every player is placed in a **30-person pool**, matched by *similar recent activity level* and *timezone* — not by friend graph. This is a distinct feature from the friend leaderboard already planned in §6/§E.6.
- **10 tiers** (Bronze → Diamond). Top finishers each week get *promoted* a tier; bottom finishers get *demoted*. This turns a 7-day mechanic into a multi-month (10-week minimum) engagement ladder.
- Sunday-night deadline deliberately targets weekend drop-off — the exact opposite of a "reset at midnight every day" design.
- **QuizVerse gap:** the existing `leaderboard_friends_*` system (friend-only) and any group leaderboard are both *relationship-scoped*. There is no *stranger-matched, skill-banded, promotion/demotion* ladder. This is a genuinely new system, not a rename of an existing one — but it reuses 90% of the plumbing already planned (weekly reset job, `ivx_groups_progress`-style storage pattern, notification tier for promotion/demotion events).

**Duolingo Friends Quests (random weekly pairing + shared 5-day goal):**
- Every Tuesday, mutual followers are randomly paired (not user-chosen) into a 2-person team with a randomly-assigned joint goal ("earn X XP together" / "complete Y perfect lessons"), with 5 days to finish. Pre-written "nudge" messages let players prod their partner with zero typing.
- This is **exactly what the dead `rpcDailyDuoCreate`/`rpcDailyDuoStatus` handlers in `social_v2.js` appear to implement** (see 17.2) — strong signal this was already scoped once and abandoned mid-build.
- Cold-start value: unlike friend challenges (require an existing relationship), Duolingo explicitly pairs "someone you only know from the leaderboard" — i.e., this mechanic can be a **cold-start tool** (feeds directly into §E.4's Stage 1/2 ladder) rather than only a retention tool for existing friends.

**Gizmo Study Group live quiz (confirmed, adds detail to §3.3):**
- Members joining a group quiz see **each other's live answers, time-per-question, and mistakes** during the same session — not just a post-hoc leaderboard. The group owner can see who's struggling in real time.
- "Nudge anyone who hasn't taken today's quiz" is a per-member, per-day action — narrower and more actionable than a generic streak reminder.
- QuizVerse already has the underlying primitives for this (`multiplayer-kernel/templates/persistent-party-match.ts`, `TeamBattleManager`) — the gap is wiring "Study Group quiz" as a named, discoverable entry point from the Group Detail screen rather than a generic Team Battle mode.

### 17.6 Prioritized Quick-Win Backlog (New, Small-Effort Items)

These are deliberately **small** additions — scoped to be doable inside the existing Phase 1-3 plan, ranked by estimated effort vs. player-segment impact. "Segment" uses the Cold-Start Ladder from §E.4.

| # | Quick Win | Effort | Segment(s) Helped | Why It's Cheap |
|---|-----------|--------|--------------------|-----------------|
| Q-01 | Fix per-pair rate limit on `send_friend_invite` (B-009) | XS | All | One key-format change in `friend_invites.js`, already scoped as Phase 1 |
| Q-02 | Diff & revive `rpcGetRivalry`/`rpcFriendScoreAlert` from `social_v2.js` into the real `ivx_social_pressure_summary` (G-020) | S | Stage 2-3 (3+ friends) | Client UI slot already exists (`SocialPressureManager`) and currently shows fake data — this is a data-wiring fix, not a new feature |
| Q-03 | Wire `create_game_group` to a single source, delete the losing two (B-003) | S | All | Removes a live footgun before Phase 2 adds more group RPCs on top of an ambiguous foundation |
| Q-04 | Fix the `intelliverse_friends_list` misleading log line | XS | Engineering only | 1-line fix, prevents future debugging time loss |
| Q-05 | Ship `ivx_social_group_invite_link` + native Share Sheet (already planned in §7.3/§13, just re-flagging as highest-K-factor item) | M | Stage 0-1 (cold start) | Directly targets K-factor (G-002); infra already designed, just needs building first |
| Q-06 | Revive `rpcDailyDuoCreate`/`rpcDailyDuoStatus` as "Duo Quest" — Duolingo Friends Quests clone, randomly paired, 5-day joint goal | M | Stage 1-2 (cold start + early retention) | Backend handler logic already exists in dead code; mainly needs registration, hardening, and a small Unity card UI |
| Q-07 | Add a "Study Group Live Quiz" entry point on `GroupDetailController` reusing existing party-match/`TeamBattleManager` infra | M | Core users (existing groups) | No new backend match system needed — just a UI affordance + party-match template config |
| Q-08 | Ship Clan UI (`UIClanScreen`) as a thin wrapper around the already-complete `ClanManager` backend, OR formally deprecate/remove `ClanManager` to stop the confusion | M (build) / XS (remove) | Core/power users, or engineering cleanup | Backend already 100% built; this is either "turn on a switch" or "delete confirmed-dead code," never a from-scratch build |
| Q-09 | Cold-start `ivx_social_onboarding_state` RPC (G-014) returning a friend-count-based stage + suggested action | S | Stage 0 (brand new users) | Pure read RPC over data that already exists (friend count via `nk.friendsList`) |
| Q-10 | Regenerate `COMPLETE_RPC_REFERENCE.md` from `index.js` RPC names (script, not manual) | XS | Engineering only | Prevents the next audit from repeating this discrepancy |
| Q-11 | League ladder (Bronze→Diamond, 30-person skill/timezone-matched pool, weekly promotion/demotion) | L | Stage 3+ (power users) + also solves cold-start (no friends required to compete) | Larger than the others, but uniquely solves "engagement with zero friends" — listed here because it reuses the weekly-reset job pattern already planned for friend leagues in §3.2/§E.6, so it's additive infra, not a parallel system |

**Suggested sequencing:** Q-01, Q-03, Q-04, Q-10 cost almost nothing and remove active landmines — do these regardless of anything else. Q-02 and Q-09 turn already-half-built things into real features. Q-05/Q-06/Q-08 are the highest-leverage *new* player-facing wins because each reuses dead or half-idle code instead of net-new systems. Q-07 and Q-11 are the two items worth a dedicated design pass before building, since they touch live match infrastructure and a new storage/matchmaking system respectively.

---

## 18. Cross-Reference With Related Planning Documents — 2026-07-04 Update

> While validating Section 17, two sibling planning documents were found that materially change how this plan should be prioritized. Neither is referenced in the original Appendix B. Both are read-only cross-references — nothing here modifies those documents.

### 18.1 `quiz-verse/docs/plans/PLAN-ENGAGEMENT_SYSTEM_07_FRIENDS_SOCIAL.md` (Unity-side companion plan)

This is a **more authoritative, MCP-verified** companion to this document, covering the Unity client half of the same "Friends/Social" surface (this architecture doc is server-first; that plan is client-first). It used live Unity MCP `find_gameobjects` probes against the running `MainQuiz` scene — not just static code reads — which surfaces something Section 17.3 missed entirely:

**Critical correction to Section 17.3:** live-scene MCP probes confirm these managers have `totalCount: 0` in `MainQuiz.unity` — i.e. **they do not exist anywhere in the running scene, not even inactive**:

| Component | Live in scene? | Why it matters to *this* document |
|---|---|---|
| `IVXFriendsManager` (`_IntelliVerseXSDK/Social/Runtime/IVXFriendsManager.cs`) | ❌ **Not in scene** | This is the realtime socket dispatcher for the native Nakama friend graph. **Every notification-driven flow this document designs in §9 (Notification & Event Bus) and §14 (Dry-Run flows) assumes the client is listening on the socket.** If `IVXFriendsManager` never boots (its `[RuntimeInitializeOnLoadMethod]` auto-bootstrap is racy against Nakama auth timing), `OnFriendRequestReceived`/`OnFriendChallengeReceived`/`OnFriendListChanged` never fire, and `QVNFriendsManager`'s realtime refresh subscription (which the production friends UI depends on) silently degrades to polling-only. **This is a bigger risk to "world-class" than any server-side RPC redesign in this document** — a perfect server notification pipeline delivering into a client that isn't listening produces the same UX as no notification pipeline at all. |
| `FriendBattleManager` | ❌ **Not in scene** | UI panels (`UIFriendBattlePanel`, `FriendChallengeController`) hold null references to it today — tapping "Challenge to 1v1" is either a silent no-op or a crash risk in production right now. |
| `SocialPressureManager` | ❌ **Not in scene** (and separately confirmed mock-data-only per Section 17.3) | Consistent with this document's finding — doubly confirmed by an independent read. |
| `FriendsUIManager` (`Friends Request/` legacy folder) | ❌ **Not in scene** | Confirms Unity's own audit (17.3) that a third, unused friends UI stack exists purely as dead weight. |

**Additional finding not in this document at all — Friend Quest progress is client-side exploitable:** `FriendQuestManager.RecordProgress` increments quest progress in `PlayerPrefs` only; the server's `friend_quest_complete` RPC accepts the claimed completion at face value with no validation against a real activity log. A player can edit local prefs to fake quest completion and claim the reward. This is a live economy exploit, not a hypothetical — and it's outside this document's threat model in §E.3 (which covers challenge score integrity but not friend-quest progress integrity). **Recommend folding this into §E.3 as a sibling finding to "Async Challenge Score Integrity."**

**Practical implication for this document's sequencing:** Phase 1 of *this* plan (Section "Migration Phases") is styled as "no breaking changes, fix known bugs" at the server. The Unity companion plan's own Phase 1 ("Stabilize") is scoped at ~5 weeks and is a **prerequisite**, not a parallel track — a redesigned server-side notification/event bus (this doc's §9) has no effect on the player until `IVXFriendsManager` is actually placed in the scene and its reflection-based SDK binding (`Type.GetType("IntelliVerseX.Backend.IVXNManager, IntelliVerseX.V2")`) is replaced with a direct reference. **Recommend sequencing this doc's Phase 1 and the Unity plan's Phase 1 together, not server-first.**

### 18.2 `nakama/docs/RPC_DEDUPLICATION_PLAN.md` (approved 2026-03-14, prior consolidation effort)

This is an **already-approved** (not just proposed) server-wide RPC consolidation plan predating this document by over three months, covering all 187 registered RPCs (social is one of eight clusters). Two things worth reconciling:

1. **Cluster 5 ("Challenge Systems", 16 → 9 RPCs) explicitly named `daily_duo_create`, `get_rivalry`, `daily_duo_status`, and `friends_challenge_user` as consolidation targets**, to be redirected into a canonical `async_challenge_*` RPC family (`async_challenge_create`, `_join`, `_cancel`, `_list`, `_stats`). This is strong corroborating evidence for the Section 17.2 finding that `social_v2.js`'s dead `rpcDailyDuoCreate`/`rpcGetRivalry`/`rpcDailyDuoStatus` handlers were a real, once-live feature set that got orphaned — very likely *during* this exact consolidation effort, when the RPC names were meant to move to `async_challenge_*` (which Unity's `AsyncChallengeManager.cs` confirms exists) but the `social_v2.js` file was never cleaned up or re-registered afterward.
2. **The plan's own status is "APPROVED ✅" but Section 17.1 of this document just confirmed `create_game_group` is still triple-implemented in source** (`legacy_runtime.js`, `src/legacy/groups.ts`, plus the differently-named `create_quizverse_group` in `groups.js`) — meaning at least part of the approved deduplication work was never executed. **Before adding the 26 new `ivx_social_*` RPCs this document proposes in Section 12, it's worth running a quick audit of which of the other 7 clusters in `RPC_DEDUPLICATION_PLAN.md` were actually completed** — otherwise this document risks adding a 9th unconsolidated cluster on top of work that already has a stalled, approved plan sitting in the repo.

**Recommended addition to this document's Migration Phases:** insert a "Phase 0.5 — Verify Prior Consolidation" step that checks `RPC_DEDUPLICATION_PLAN.md`'s 8 clusters against current `index.js` registrations before Phase 1 begins, so this document's own RPC count claims (44 → 37 in Appendix C) are measured against reality, not against the pre-consolidation RPC count from March.

### 18.3 Note on Appendix B's Existing "Internal" References

This document's Appendix B cites `UNITY_SOCIAL_ZONE_FRIENDS_GROUPS_FLOW.md` and `social-zone-friends-groups-backend-flow.md` as internal references. **Neither file could be located anywhere in the Unity or Nakama repositories** — they do not exist under those names or any close variant found via search. They should be treated as either aspirational (never actually written) or superseded by `PLAN-ENGAGEMENT_SYSTEM_07_FRIENDS_SOCIAL.md` (Unity side, confirmed to exist and cover the same ground in more depth) and this document itself (backend side). Recommend updating Appendix B to point at the real files, or removing the dead references.

---

## 19. Production Readiness Review — 2026-07-06 Principal Architecture Pass

> **Method:** Full re-read of this document validated against (1) the live Nakama runtime (`data/modules/` JS + `data/modules/src/` TS), (2) the deployment reality in `intelli-verse-kube-infra/nakama/*`, (3) the QuizVerse web frontend (`Quizverse-web-frontend/web/`), and (4) the Unity client repo assets (AASA / assetlinks / auth bridge). Every correction below is grounded in a file that exists today, not in general best practice.

### 19.1 What Was Re-Verified Today

| Claim | Verdict | Evidence |
|---|---|---|
| B-009 per-user rate limit | ✅ Still live | `friends/friend_invites.js:65-66` — `FRIEND_INV_RATELIMIT_KEY = 'fr_invite_send'`, 5s, keyed by sender only |
| `social_v2.js` is dead code | ✅ Confirmed | `grep -c registerRpc social_v2/social_v2.js` → **0**; `rpcGetRivalry` (line 204) and `rpcDailyDuoCreate` (line 407) exist unregistered |
| B-004 duplication | ⚠️ **Understated** | `loadOnlineMap` exists in **three** files, not two: `find_friends.ts:193`, `find_nearby_players.ts:105`, `friends_list.ts:112` — §2.1 row updated |
| `RPC_DEDUPLICATION_PLAN.md` | ✅ Exists, APPROVED, partially executed | 187 RPCs, 8 clusters, dated 2026-03-14 — §18.2's "Phase 0.5 verify prior consolidation" stands |
| AASA / assetlinks deep-link assets | ✅ Exist, missing `/join/*` | `games/quiz-verse/apple-app-site-association` has `/invite/*`, `/challenge/*`, `/ref/*` — no `/join/*` path |
| Web fallback routes | ✅ Partially exist | `web/app/join/clan` and `web/app/join/event` exist; `join/group/[code]` does not yet |

### 19.2 Corrections Applied to This Document (2026-07-06)

All corrections are edited **in place** in their original sections and cross-referenced here so reviewers can audit the delta:

| # | Correction | Where | Why It Mattered |
|---|---|---|---|
| C-001 | Nakama storage has **no native TTL** — every "TTL: 7 days" now reads "expiresAt field + cleanup job" | §14A.4 | The feed design silently depended on a platform feature that doesn't exist; without a cleanup job it would recreate anti-pattern AP-002 at scale |
| C-002 | Feed events changed from `permissionRead: 2` (public) to `1` (owner-only, served via RPC) | §14A.6 | Public-read storage lets any authenticated client read any user's feed events directly through the storage API — bypassing both the friend check and the §14A.7 privacy settings |
| C-003 | Feed read path changed from per-friend prefix reads to one SQL query | §14A.5 | `nk.storageRead` needs exact keys; 50 friends = 50 sequential `storageList` calls, which cannot meet the 300ms target. The doc already uses raw SQL for groups (§7.2) — same precedent |
| C-004 | "Scheduled Nakama job (cron)" replaced with the two real patterns: k8s CronJob → service-token RPC, or opportunistic tick + leader lock | §E.5 | The JS runtime has no scheduler. The infra repo already runs `tournament-cron-*.yaml` CronJobs — cleanup jobs must follow the same deployment pattern or they will never run |
| C-005 | FCM batch API reference removed — discontinued June 2024; use HTTP v1 sends / `sendEach()` | §E.5 | A fan-out worker built against the batch endpoint would fail on day one |
| C-006 | Firebase Dynamic Links removed — service shut down 2025-08-25; grounded deep links in the existing AASA/assetlinks + web `/join` routes | §E.2 | The recommended dependency no longer exists; the replacement reuses already-deployed assets |
| C-007 | Presence online threshold 90s → 150s; added Nakama **native status follow** hybrid | §8.2 | 90s tolerates one missed heartbeat → flapping on mobile networks; native status gives realtime online events for free instead of polling storage |
| C-008 | Duplicate "§15" numbering fixed — Friends Activity Feed renumbered to §14A, ToC and all cross-references updated | §14A, ToC | Two sections shared the number 15; cross-references were ambiguous |
| C-009 | B-004 corrected from two files to three | §2.1 | The dedupe fix must cover `find_nearby_players.ts` too or the bug survives its own fix |

### 19.3 Multi-App Platform Architecture (App-ID Tenancy)

The document scopes *data* per game well (§5) but still treats the *platform configuration* as single-tenant. To make the social engine a reusable platform where a new app supplies only **App ID + config + flags + branding**, add one layer:

#### 19.3.1 Storage-Backed App Registry

```
Collection: ivx_app_registry          (system-owned, permRead 2, permWrite 0)
  Key: {appId}                        e.g. "quizverse", "lasttolive"
  Value:
    {
      "appId":        "quizverse",
      "appUuid":      "126bf539-dae2-4bcf-964d-316c0fa1f92b",
      "status":       "active|suspended",
      "features": {                   ← per-app kill switches / flags
        "friends": true, "groups": true, "challenges": true,
        "feed": true, "leagues": false, "duoQuests": false,
        "contactImport": false, "chat": true
      },
      "limits": {                     ← per-app quota overrides (defaults apply if absent)
        "maxFriends": 1000, "maxGroupsPerUser": 20, "maxGroupSize": 50,
        "invitesPerHour": 20, "pushPerUserPerDay": 2
      },
      "notifications": {              ← per-app channel config
        "fcmSenderId": "…", "apnsTopic": "com.intelliverse.quizverse",
        "quietHoursDefault": "22:00-08:00", "localTimezoneSend": true
      },
      "moderation": {
        "profanityListId": "default_en_ar", "reportAutoFlagThreshold": 5
      },
      "branding": { "displayName": "QuizVerse", "deepLinkHost": "…" }
    }
```

- **Cache:** read-through with a 60s in-call cache (Goja VMs are pooled and stateless — cache lives in storage version checks, not module globals, per AGENTS.md rule 4).
- **Onboarding a new app = one Console write.** No build, no deploy. This mirrors the proven `qv_config/global` remote-config pattern (`src/games/quizverse/remote_config.ts`) — the platform's most successful "server-owned config" precedent.
- `resolveGameId()` (§5.3) becomes `resolveApp(appId)` returning the full registry entry; every RPC gate-checks `status === "active"` and the relevant `features.*` flag — this is the **per-app kill switch** LiveOps requirement.

#### 19.3.2 Tenancy Invariants (enforced in code review)

1. Every storage key that holds per-app data embeds `{appId}` (already true of the §11 blueprint — keep it).
2. Every RPC response envelope carries `meta.appId` (extends the §6.1 envelope; `gameId` remains as an alias during migration).
3. Rate-limit keys embed `{appId}` (`rl_{appId}_invite_{pairKey}`), so one app's abuse never consumes another app's budget.
4. Analytics events carry `appId` as a top-level dimension (the K-factor events in §E.1/§F.5 already do this via `gameId` — rename in the schema, keep both fields during transition).
5. **No app-name string literals inside handler logic.** `"quizverse"` appearing in a social-engine file outside the registry/default-fallback is a review-blocking smell. (Today `multigame_rpcs.js` proves the cost of the alternative: every LastToLive RPC is a one-line redirect to a QuizVerse function.)
6. Cross-app features (global friend graph — §5.4) are **opt-in per app pair** via a registry field, not ambient.

### 19.4 Use-the-Platform Checklist

Before building any custom subsystem in this plan, the implementing engineer must check this table. Custom storage is justified only where the native feature genuinely can't express the requirement:

| Requirement | Nakama native | Verdict |
|---|---|---|
| Realtime online/offline push | Status system (`updateStatus` + follow) | **Use native** for live dots; storage row only for durable last-seen (§8.2 hybrid) |
| Friend graph | `nk.friendsList` / `friendsAdd` | Already the single source of truth (§4.1) — correct |
| Groups membership/roles | Native groups + `edge_count` | Keep native as membership truth; `ivx_groups_meta` is app-scoped decoration only |
| In-app notification inbox | Native persistent notifications (`persistent: true`, listable) | **Evaluate before building** `ivx_notification_inbox` — native notifications are already durable, listable and deletable; a custom inbox is justified only for read-state semantics and digest grouping. Document the decision either way |
| Chat / DMs | Native channels (type 2 = direct) | Already chosen (§D.3 DM cluster) — correct |
| Leaderboards | Native leaderboards | Keep — friend leaderboards use owner-records API |
| Match-scoped social (party, live group quiz) | Existing `multiplayer-kernel` templates (`persistent-party-v1`) | Reuse — §17.5 already concluded this |

### 19.5 API Contract Standard — Idempotency & Versioning

The document mandates "idempotent mutations" (§4.1) but gives no mechanism. The standard:

- **Client-generated `requestId`** (UUID) on every mutating RPC. Server keeps a 10-minute dedupe window (`ivx_idempotency/{userId}` rolling row, or derive natural idempotency where the design already has it — invite send is naturally idempotent via graph-state checks in §6.3; challenge send is NOT and needs the explicit key).
- **`apiVersion: 1`** field in the request envelope; server responds with `meta.apiVersion`. Changes are **additive-only** within a version; field removal or semantic change bumps the version, and the old version keeps working for one Unity release cycle (mirrors the §12.3 wrapper strategy).
- **Stable machine error codes** (§6.1 `errorCode`) drawn from a single registry file — `shared/social-errors.ts` — never inline strings. Unity switches on `errorCode`, never on message text.
- **Pagination cursors are opaque strings.** Clients must not parse them (the §14A.5 cursor is an occurredAt internally — that's an implementation detail free to change).

### 19.6 Observability — Wire Into What Already Exists

The platform already has three observability layers this plan should plug into rather than duplicate:

1. **`AnalyticsAlerts` RPC auto-instrumentation** (`src/satori/analytics-alerts.ts`) monkey-patches `registerRpc` — every `ivx_social_*` RPC mounted **after** `AnalyticsAlerts.init` in `main.ts` gets P50/P95/P99 latency + error-rate sampling and the 3h Discord digest **for free**. Mount order is therefore a correctness requirement, not a style choice.
2. **Go plugin Prometheus metrics** (`:9100`, scraped in EKS) — add counters for the social domain: `ivx_social_invites_sent_total{appId}`, `ivx_social_invite_accept_total{appId}`, `ivx_social_push_delivered_total{tier,appId}`, `ivx_social_fanout_queue_depth`.
3. **Discord ops routing** (`qv-insights-s2s` secret, per-game webhook chain in `intelli-verse-kube-infra/nakama/deployment.yaml`) — social-layer alerts (fan-out queue backlog, cleanup job failures, notification delivery failure spikes) route per-app using the existing `IVX_DISCORD_<GAME>_WEBHOOK_URL` convention.

**SLOs (initial, per §Appendix A targets):**

| RPC cluster | p95 target | Error-rate alert |
|---|---|---|
| friends_list / presence_bulk | 150ms | > 1% over 15m |
| invite / challenge mutations | 250ms | > 2% over 15m |
| friends_feed | 300ms | > 2% over 15m |
| group search | 400ms | > 2% over 15m |
| Tier-2 inbox write success | 99.9% | any sustained failure — this is the durable tier |

**K-factor is a first-class dashboard**, not an ad-hoc query: `invite_sent` / `invite_accepted` events (§E.1) feed a weekly K computation per app, alongside network-density (friends-per-DAU histogram) and social-activation cohort (§E.6) panels.

### 19.7 Data Lifecycle — One Cleanup Job Family, One Index Strategy

All retention in this plan converges on a single service-token RPC + k8s CronJob pair (pattern: `intelli-verse-kube-infra/nakama/tournament-cron-*.yaml`):

```
ivx_social_maintenance_tick   (hourly CronJob, service token, paged, max 1000 rows/collection/tick)
  ├─ expired challenges        (ivx_game_challenges, value->>'expiresAt' < now)
  ├─ feed events > 7 days      (ivx_friends_feed_events / _inbox)
  ├─ stale presence > 90 days  (ivx_presence_v2 — fixes B-005 properly)
  ├─ consumed/expired invite codes (ivx_groups_invite_codes)
  └─ orphaned idempotency rows (ivx_idempotency)
```

**Index note (CockroachDB):** the SQL paths in §7.2, §7.4, §14A.5 and the cleanup job all filter the shared `storage` table by `collection` + a JSON field. Add partial indexes per hot collection, e.g.:

```sql
CREATE INDEX IF NOT EXISTS idx_storage_feed_events
  ON storage (user_id, (value->>'occurredAt') DESC)
  WHERE collection = 'ivx_friends_feed_events';
```

Ship these as numbered migrations in `migrate/` (the repo's existing migration home), and pin them in the PR that introduces the querying RPC — an unindexed JSON scan on the storage table is invisible at 10K users and a full-table scan at 1M.

**GDPR cascade (§E.3) implementation note:** keys like `ivx_friend_streaks/{appId}_{pairKey}` where the deleted user may be either side of the pair cannot be found by exact-key delete — the cascade hook needs SQL sweeps (`WHERE key LIKE '%'||$deletedId||'%'` on the affected collections, index-supported), executed by the same maintenance-tick machinery in an offline pass after the synchronous critical deletes.

### 19.8 Capacity Model — Hot Spots at 100K DAU / 1M Registered

Back-of-envelope, sized against the current EKS envelope (2–10 pods, 250m/1500m CPU — `intelli-verse-kube-infra/nakama/hpa.yaml`):

| Load source | Math | Verdict |
|---|---|---|
| Presence heartbeats | 20K concurrent × 1 write/60s ≈ **333 writes/s** | Fine for CockroachDB, but it is the single largest write stream this plan adds. The §8.2 native-status hybrid lets the interval relax to 120s (halving writes) once live dots come from status events |
| Feed writes | ~10 quiz completions/user/day × 100K ≈ 12/s avg | Trivial (pull model); push fan-out only above the §14A.3 threshold |
| Notification fan-out | 1K groups × 50 members × 10 events/day = 500K pushes/day ≈ 6/s avg, **bursty** | Queue + worker (§E.5) mandatory; RPC-inline fan-out would hit Goja per-call limits exactly as AP-008 warns |
| Rate-limit row (§10.2) | Consolidated single row per user → every mutating RPC does read-modify-write on it | ⚠️ **Hot-row risk:** two concurrent RPCs from one user contend on version checks. Acceptable (retry once), but do NOT extend this row with anything non-rate-limit; if contention shows up in AnalyticsAlerts p99, fall back to per-action keys |
| Group progress row (ML-008) | Same optimistic-concurrency pattern | Already flagged; bounded retry (3×, jittered) then accept-and-log, never fail the player's quiz completion over a group XP write |
| Cleanup ticks | 1000 rows × 6 collections/hour | Negligible; runs on cron pods labeled `app: nakama-cron` so they never join the Service endpoints (per the 2026-07-05 selector fix in `nakama/service.yaml`) |

### 19.9 Rollout Gates (Go/No-Go per Migration Phase)

Each phase in §15 ships behind these gates:

1. **Registry flag first:** every new capability has an `ivx_app_registry.features.*` flag, default **off**. Enable per app, per environment — this is the kill switch AND the staged-rollout lever.
2. **RPC-count smoke test:** `nakama_js_health` RPC count must match the expected delta post-deploy (existing CI convention, §12.1 of the developer runbook).
3. **Wrapper parity test:** while old RPC names remain as wrappers (§12.3), CI calls old + new names with identical payloads and diffs the responses — envelope shape excepted.
4. **Client-readiness gate:** per §18.1, server phases that depend on socket delivery (notifications, presence follow) are **blocked** until `IVXFriendsManager` is verified live in `MainQuiz.unity` — a perfect server pipeline into a deaf client is indistinguishable from no pipeline.
5. **Rollback = flag off + image pin.** Storage schemas are additive-only during migration (dual-write, never destructive rename), so flag-off is always a safe rollback; the ECR tag-pinning discipline in `nakama/deployment.yaml` covers the binary side.

---

## Appendix A: Key Numbers

| Metric | Current | Target (World-Class) |
|--------|---------|---------------------|
| Friends list load time | ~500ms (N presence reads) | < 150ms (single batch read) |
| Accept invite paths | 3-tier fallback | 1 path |
| Social RPCs (total) | 44 | 26 |
| Response envelope formats | 2 (flat + nested) | 1 |
| Online threshold | 5 minutes | 150 seconds (storage) + realtime via native status follow — see §8.2/C-007 |
| Rate limit granularity | Per-user | Per-pair |
| Group search filter | Client-side JS | Server-side SQL |
| Invite code sharing | None | 6-char deep link |
| Challenge deduplication | Manual alias | Single canonical RPC |

## Appendix B: References

| Source | Key Insight |
|--------|------------|
| [Supercell ScyllaDB (2025)](https://www.scylladb.com/2025/01/14/how-supercell-handles-real-time-persisted-events-with-scylladb/) | Hierarchical KV + CDC as the single abstraction; Supercell ID social layer for 500M+ players |
| [MAF Social Features (2025)](https://maf.ad/en/blog/social-features-in-mobile-games/) | ~70% of top-grossing games have guilds; social-based events boost retention |
| [GameRefinery Social Features](https://www.gamerefinery.com/social-features-that-the-top-performing-mobile-games-have-incorporated-market-trend-analysis/) | Market trend analysis on social feature adoption |
| [Duolingo Engineering Blog](https://blog.duolingo.com) | Weekly leaderboard resets, friend streaks, social nudges, segmented push |
| [Discord How They Store Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages) | Push notification tier isolation |
| Internal: `UNITY_SOCIAL_ZONE_FRIENDS_GROUPS_FLOW.md` | Current Unity client architecture |
| Internal: `social-zone-friends-groups-backend-flow.md` | Current backend communication map |
| Internal: `friend_invites.js` | Split-brain bug analysis and fix |
| Internal: `groups.js` | Group economy and dual-registration issue |

---

## Appendix C: RPC Change Summary — Add / Remove / Rename / Keep

> Short and sweet. This is the complete RPC delta for the social layer.

---

### ✅ ADD — New RPCs (don't exist yet)

| New RPC | What it does |
|---------|-------------|
| `ivx_social_group_search` | Server-side group search filtered by `gameId` (replaces Unity calling raw `ListGroupsAsync`) |
| `ivx_social_group_invite_link` | Generate a 6-char shareable code for a group (e.g. `QM-XK94`) |
| `ivx_social_group_join_by_code` | Join a group using the shareable code / deep link |
| `ivx_social_presence_bulk_get` | Fetch presence for N users in one call (internal helper promoted to public RPC) |
| `ivx_social_friends_feed` | **Gizmo-style** chronological friend activity stream — "Ana scored 1,450 in Science 10 min ago" with CTA buttons (challenge, quiz) |
| `ivx_social_feed_privacy_set` | Per-user control over which event types appear in friends' feeds (quiz scores, streaks, badges) |

---

### ❌ REMOVE — Delete These RPCs

| RPC to Remove | Why |
|--------------|-----|
| `friends_challenge_user` | Exact duplicate alias of `send_friend_challenge` — causes duplicate challenge records (Bug B-010) |
| `hiro_friends_list` | Hiro alias layer — unnecessary indirection, remove after Unity migrates |
| `hiro_friends_remove` | Same — Hiro alias |
| `hiro_friends_block` | Same — Hiro alias |
| `hiro_friends_add` | Same — Hiro alias |
| `hiro_friend_battles_challenge` | Same — Hiro alias |
| `hiro_friend_quests_get_active` | Same — Hiro alias |
| `hiro_friend_quests_contribute` | Same — Hiro alias |

> **When to remove:** Only after Unity has migrated to `ivx_social_*` RPCs AND the Hiro SDK layer is confirmed unused. Keep old RPCs as wrappers until then.

---

### 🔄 RENAME — Old Name → New Name

| Old RPC | New RPC | What changes besides the name |
|---------|---------|-------------------------------|
| `friends_list` | `ivx_social_friends_list` | Adds game activity per friend, unified envelope |
| `list_blocked_users` | `ivx_social_friends_list` (state=3) | Merged into the same RPC via state filter |
| `intelliverse_find_friends` | `ivx_social_friend_search` | Unified envelope only |
| `intelliverse_find_nearby_players` | `ivx_social_friend_nearby` | Unified envelope only |
| `send_friend_invite` | `ivx_social_invite_send` | Rate limit changes to per-pair |
| `accept_friend_invite` | `ivx_social_invite_accept` | Drops 3-tier fallback — single reliable path |
| `decline_friend_invite` | `ivx_social_invite_decline` | Envelope only |
| `cancel_friend_invite` | `ivx_social_invite_cancel` | Envelope only |
| `list_pending_friend_invites` | `ivx_social_invites_pending` | Envelope only |
| `friends_remove` | `ivx_social_friend_remove` | Envelope only |
| `friends_block` | `ivx_social_friend_block` | Envelope only |
| `friends_unblock` | `ivx_social_friend_unblock` | Envelope only |
| `ivx_set_player_presence` | `ivx_social_presence_set` | 90s threshold, per-gameId key, session tracking |
| `create_quizverse_group` | `ivx_social_group_create` | Also generates invite code on creation |
| `get_user_groups` | `ivx_social_group_list_mine` | gameId filter moves to DB/SQL level |
| `get_group_details` | `ivx_social_group_detail` | Reads from new `ivx_groups_meta` collection |
| `send_friend_challenge` | `ivx_social_challenge_send` | Adds gameId scoping |
| `accept_friend_challenge` | `ivx_social_challenge_accept` | Envelope only |
| `decline_friend_challenge` | `ivx_social_challenge_decline` | Envelope only |
| `cancel_friend_challenge` | `ivx_social_challenge_cancel` | Envelope only |
| `list_pending_friend_challenges` | `ivx_social_challenges_pending` | Adds gameId filter |

> **Strategy:** Old names stay registered as thin wrappers calling the new handlers with `gameId: "quizverse"` hardcoded. Zero breaking changes until Unity migrates.

---

### 🔄 RENAME — Naming Protocol Only (logic unchanged)

> Same logic, zero behaviour change — just prefixed with `ivx_social_` to enforce the naming standard across the entire social layer.

| Old RPC | New RPC |
|---------|---------|
| `ivx_get_cross_game_messages` | `ivx_social_cross_game_messages_get` |
| `ivx_mark_message_read` | `ivx_social_cross_game_message_read` |
| `send_direct_message` | `ivx_social_dm_send` |
| `get_direct_message_history` | `ivx_social_dm_history` |
| `mark_direct_messages_read` | `ivx_social_dm_mark_read` |
| `get_unread_counts` | `ivx_social_dm_unread_counts` |
| `friend_streak_get_state` | `ivx_social_streak_get` |
| `friend_streak_record_contribution` | `ivx_social_streak_record` |
| `friend_streak_send_nudge` | `ivx_social_streak_nudge` |
| `friend_streak_get_broken_log` | `ivx_social_streak_broken_log` |
| `friend_streak_repair` | `ivx_social_streak_repair` |
| `log_group_activity` | `ivx_social_group_activity_log` |
| `update_group_xp` | `ivx_social_group_xp_update` |
| `get_group_wallet` | `ivx_social_group_wallet_get` |
| `update_group_wallet` | `ivx_social_group_wallet_update` |
| `social_pressure_get_today_summary` | `ivx_social_pressure_summary` |
| `friends_get_online_count` | `ivx_social_friends_online_count` |
| `friend_battle_create` | `ivx_social_battle_create` |
| `friend_invite_with_reward` | `ivx_social_invite_with_reward` |
| `friends_spectate` | `ivx_social_spectate` |

---

### One-Page Scoreboard

| Action | Count |
|--------|-------|
| ✅ ADD new RPCs | **4** |
| ❌ REMOVE RPCs | **8** |
| 🔄 RENAME (with logic changes) | **21** |
| 🔄 RENAME (naming protocol only) | **20** |
| ✔️ KEEP unchanged | **0** — every RPC gets the `ivx_social_` prefix |
| **Total current → Total new** | **44 → 37** (net −7) |

---

## Appendix D: RPC Interlinking & Data Flow Map

> Are all 37 RPCs properly connected? This section maps every read/write dependency, every notification trigger, every missing link, and the correct call sequence the Unity client must follow.

---

### D.1 Storage Write → Read Dependency Table

Every RPC either **writes** data or **reads** data (or both). This table shows the exact storage key each RPC touches so you can see which RPCs depend on which.

| Storage Collection | Written by | Read by |
|-------------------|------------|---------|
| `ivx_presence_v2/{gameId}_{userId}` | `ivx_social_presence_set` | `ivx_social_friends_list`, `ivx_social_friend_search`, `ivx_social_friend_nearby`, `ivx_social_presence_bulk_get`, `ivx_social_friends_online_count` |
| `ivx_social_invites/inv_{A}_{B}` | `ivx_social_invite_send` | `ivx_social_invites_pending`, `ivx_social_invite_accept`, `ivx_social_invite_decline`, `ivx_social_invite_cancel` |
| `Nakama user_friends graph` | `ivx_social_invite_send` (friendsAdd), `ivx_social_invite_accept` (friendsAdd), `ivx_social_invite_decline` (friendsDelete), `ivx_social_invite_cancel` (friendsDelete), `ivx_social_friend_remove`, `ivx_social_friend_block`, `ivx_social_friend_unblock` | `ivx_social_friends_list`, `ivx_social_friend_search`, `ivx_social_invites_pending`, `ivx_social_challenge_send` (mutual-friend check) |
| `ivx_groups_meta/{groupId}` | `ivx_social_group_create`, `ivx_social_group_invite_link` | `ivx_social_group_list_mine`, `ivx_social_group_detail`, `ivx_social_group_search`, `ivx_social_group_join_by_code` |
| `ivx_groups_progress/{groupId}` | `ivx_social_group_xp_update`, `ivx_social_group_activity_log` | `ivx_social_group_detail`, `ivx_social_group_list_mine` |
| `ivx_groups_wallet/{groupId}` | `ivx_social_group_create` (init), `ivx_social_group_wallet_update` | `ivx_social_group_wallet_get`, `ivx_social_group_detail` |
| `ivx_groups_activity/{groupId}_{id}` | `ivx_social_group_activity_log` | `ivx_social_group_detail` |
| `ivx_groups_invite_codes/{code}` | `ivx_social_group_invite_link` | `ivx_social_group_join_by_code` |
| `ivx_game_challenges/{gameId}/chg_*` | `ivx_social_challenge_send` | `ivx_social_challenges_pending`, `ivx_social_challenge_accept`, `ivx_social_challenge_decline`, `ivx_social_challenge_cancel` |
| `ivx_friend_streaks/{gameId}_{pair}` | `ivx_social_streak_record` | `ivx_social_streak_get`, `ivx_social_streak_broken_log`, `ivx_social_streak_repair` |
| `ivx_notification_inbox/{userId}/{id}` | Every notification-emitting RPC (invite, challenge, group join) | `ivx_social_dm_unread_counts` (badge count) |
| `ivx_rate_limits/{userId}` | Every mutating RPC (invite send, challenge send, group create) | Same RPCs (read before mutate) |
| `geo_tier/resolved` | GeoTier module (internal) | `ivx_social_friend_nearby` |
| `Nakama groups table` | `ivx_social_group_create` (nk.groupCreate), built-in join/leave | `ivx_social_group_list_mine`, `ivx_social_group_detail` |

---

### D.2 Notification Trigger → Client Refresh Chain

Every server-side mutation fires a notification. The client reacts by calling a specific RPC to sync state. This is the event-driven loop that keeps the UI live.

```
SERVER MUTATION                    NOTIFICATION              CLIENT REFRESH
──────────────────────────────────────────────────────────────────────────────
ivx_social_invite_send          → code 1  (T1+T2+T3) → ivx_social_invites_pending
ivx_social_invite_accept        → code 2  (T1+T2+T3) → ivx_social_friends_list
ivx_social_invite_decline       → code 3  (T1+T2)    → [remove row from Requests UI]
ivx_social_invite_cancel        → code 4  (T1+T2)    → [remove row from Requests UI]
ivx_social_friend_remove        → code 5  (T1)       → ivx_social_friends_list
ivx_social_challenge_send       → code 10 (T1+T2+T3) → ivx_social_challenges_pending
ivx_social_challenge_accept     → code 11 (T1+T2+T3) → [launch game / show score]
ivx_social_challenge_decline    → code 12 (T1+T2)    → [remove challenge from outbox]
ivx_social_challenge_cancel     → code 13 (T1+T2)    → [remove challenge from inbox]
group built-in join + after-hook → code 500 (T1)     → ivx_social_group_list_mine (ALL devices)
group built-in leave + after-hook → code 501 (T1)    → ivx_social_group_list_mine (ALL devices)
ivx_social_group_wallet_update  → (no notif)          → [next ivx_social_group_detail pull]
ivx_social_group_activity_log   → (no notif)          → [next ivx_social_group_detail pull]
ivx_social_streak_nudge         → code 30 (T2+T3)    → [open app / streak screen]
```

---

### D.3 RPC Cluster Diagram — How the 37 RPCs Group Together

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PRESENCE CLUSTER                                                           │
│  ivx_social_presence_set  ──writes──► ivx_presence_v2                      │
│                                              ▲                              │
│  ivx_social_presence_bulk_get ──reads────────┘                              │
│                                              ▲                              │
│  FRIENDS CLUSTER (all read presence)         │                              │
│  ivx_social_friends_list ────────────────────┤                              │
│  ivx_social_friend_search ───────────────────┤                              │
│  ivx_social_friend_nearby ───────────────────┘                              │
│  ivx_social_friends_online_count                                            │
└─────────────────────────────────────────────────────────────────────────────┘
         │ all read Nakama friend graph
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  INVITE CLUSTER                                                             │
│  ivx_social_invite_send                                                     │
│    │ writes ivx_social_invites + nk.friendsAdd                              │
│    │ fires code 1 ──────────────────────────────► ivx_social_invites_pending│
│  ivx_social_invite_accept                                                   │
│    │ reads ivx_social_invites + nk.friendsAdd                               │
│    │ fires code 2 ──────────────────────────────► ivx_social_friends_list   │
│  ivx_social_invite_decline / cancel                                         │
│    │ reads + updates ivx_social_invites + nk.friendsDelete                  │
│    │ fires code 3/4                                                         │
│  ivx_social_invites_pending (reads ivx_social_invites + nk graph)           │
│  ivx_social_friend_remove / block / unblock (nk graph only)                 │
│  ivx_social_invite_with_reward (extends invite_send + reward metadata)      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  CHALLENGE CLUSTER                                                          │
│  ivx_social_challenge_send                                                  │
│    │ checks nk friend graph (mutual friend REQUIRED)                        │
│    │ writes ivx_game_challenges/{gameId}/chg_*                              │
│    │ fires code 10 ─────────────────────────────► ivx_social_challenges_pending│
│  ivx_social_challenge_accept / decline / cancel                             │
│    │ reads + updates ivx_game_challenges                                    │
│    │ fires code 11/12/13                                                    │
│  ivx_social_challenges_pending (reads ivx_game_challenges filtered by gameId)│
│  ivx_social_spectate (reads ivx_game_challenges for active match)           │
│  ivx_social_battle_create (extends challenge to multi-friend battle)        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GROUP CLUSTER                                                              │
│  ivx_social_group_create                                                    │
│    │ writes ivx_groups_meta + progress + wallet                             │
│    │ fires code 500 (self, cross-device) ───────► ivx_social_group_list_mine│
│  ivx_social_group_list_mine (reads ivx_groups_meta SQL join)                │
│  ivx_social_group_search   (reads ivx_groups_meta SQL join)                 │
│  ivx_social_group_detail   (reads meta + progress + wallet + activity)      │
│    ▲ ─── fed by ─────────────────────────────────────────────────────────  │
│    │    ivx_social_group_activity_log (writes ivx_groups_activity)          │
│    │    ivx_social_group_xp_update    (writes ivx_groups_progress)          │
│    │    ivx_social_group_wallet_get / update (reads/writes ivx_groups_wallet)│
│  ivx_social_group_invite_link (writes ivx_groups_invite_codes)              │
│  ivx_social_group_join_by_code (reads ivx_groups_invite_codes → nk.groupJoin)│
│    │ fires code 500 ────────────────────────────► ivx_social_group_list_mine│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  STREAK CLUSTER                                                             │
│  ivx_social_streak_record ──writes──► ivx_friend_streaks/{gameId}_{pair}   │
│  ivx_social_streak_get    ──reads────► same                                 │
│  ivx_social_streak_nudge  ──fires────► code 30 → target opens app          │
│  ivx_social_streak_broken_log ──reads─► same                                │
│  ivx_social_streak_repair ──writes───► same                                 │
│  NOTE: ivx_social_group_activity_log does NOT auto-call streak_record       │
│        → game logic must call both explicitly after quiz completion          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  DM / CHAT CLUSTER                                                          │
│  ivx_social_dm_send          → nk.channelMessageSend (type 2)              │
│  ivx_social_dm_history       → nk.channelMessageList                       │
│  ivx_social_dm_mark_read     → nk channel read receipt                     │
│  ivx_social_dm_unread_counts → reads ivx_notification_inbox badge count    │
│  ivx_social_cross_game_messages_get → reads cross_game_messages collection │
│  ivx_social_cross_game_message_read → deletes cross_game_messages entry    │
│  ivx_social_pressure_summary → reads ivx_presence_v2 + ivx_game_player_stats│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### D.4 Missing Links — Gaps That Must Be Wired

These are connections that do NOT exist yet and will cause silent data inconsistencies if not explicitly addressed during implementation.

| # | Missing Link | Impact if Not Fixed | How to Wire It |
|---|-------------|---------------------|----------------|
| ML-001 | `ivx_social_group_activity_log` does NOT auto-call `ivx_social_streak_record` | Group quiz activity won't count toward friend streaks | Game quiz-complete flow must call **both** sequentially: `group_activity_log` → `streak_record` |
| ML-002 | `ivx_social_presence_set` does NOT update `ivx_game_player_stats` (weekly XP/quiz count) | `ivx_social_friends_list` `gameActivity` field will always be empty | Quiz completion flow must call a `player_stats_update` endpoint (or a before-hook on score submit) |
| ML-003 | `ivx_social_challenge_send` does NOT check if the target's presence `gameId` matches the challenge `gameId` | Player can receive a QuizVerse challenge while playing LastToLive — confusing UX | Add optional soft-check: if target presence `gameId ≠ challenge.gameId`, warn but don't block |
| ML-004 | `ivx_social_group_join_by_code` does NOT fire a notification to the group owner | Owner never knows someone joined via their link | After `nk.groupUserJoin`, fire code 22 `group_member_joined` to owner+admins |
| ML-005 | `ivx_social_invite_with_reward` does NOT connect to the wallet/economy layer when the reward is claimed | Reward row sits in storage permanently unclaimed with no expiry | On `invite_accept`, check if `ivx_social_invite_with_reward` row exists → auto-credit wallet → mark claimed |
| ML-006 | `ivx_social_dm_unread_counts` reads `ivx_notification_inbox` but DM messages go to Nakama channel storage, not the inbox | Unread count will always return 0 for DMs | DM send after-hook must also write a lightweight row to `ivx_notification_inbox` |
| ML-007 | `ivx_social_spectate` has no link to `ivx_social_challenges_pending` | Spectate request arrives but there's no active challenge to spectate | `spectate` must first call `challenges_pending` to verify an active challenge match exists |
| ML-008 | `ivx_social_group_xp_update` and `ivx_social_group_activity_log` BOTH write to `ivx_groups_progress` independently | Race condition: two simultaneous quiz completions in a group can clobber XP | Both must use optimistic concurrency (version field) on the progress write — one will retry |

---

### D.5 Correct Unity Client Call Sequence

The order Unity should call RPCs on key events:

```
── On App Launch / Session Start ──────────────────────────────────────────
1. ivx_social_presence_set { gameId, status: "browsing" }
2. ivx_social_friends_list { gameId, includePresence: true }
3. ivx_social_invites_pending { }             ← merge with step 2 Requests tab
4. ivx_social_challenges_pending { gameId }   ← populate "Your Turn"

── On Social Zone Opens (if cache stale) ──────────────────────────────────
5. ivx_social_friends_list (if > 60s since last call)
6. ivx_social_group_list_mine { gameId }
7. ivx_social_friend_nearby { gameId }        ← once per screen open

── On Quiz Complete ────────────────────────────────────────────────────────
8. [quiz score saved — game layer]
9. ivx_social_group_activity_log { groupId, xpEarned }   ← if in a group
10. ivx_social_streak_record { gameId, friendUserId }     ← for each streak partner
   (NOT ivx_social_presence_set — that's a separate 60s heartbeat, not per-quiz)

── On Notification Received (socket) ──────────────────────────────────────
code 1  → refresh ivx_social_invites_pending
code 2  → refresh ivx_social_friends_list
code 10 → refresh ivx_social_challenges_pending
code 500/501 → refresh ivx_social_group_list_mine

── On App Pause / Quit ─────────────────────────────────────────────────────
11. ivx_social_presence_set { online: false }
```

---

### D.6 Interlinking Health Score

| Cluster | Properly Linked? | Gaps |
|---------|-----------------|------|
| Presence → Friends | ✅ Yes | None |
| Invite → Friend Graph | ✅ Yes (split-brain fixed) | None |
| Challenge → Friend Graph (mutual check) | ✅ Yes | ML-003 (gameId soft-check) |
| Group → Meta/Progress/Wallet | ✅ Yes | ML-008 (XP race condition) |
| Group Invite Code → Join | ✅ Yes | ML-004 (owner notification missing) |
| Activity Log → Streak | ❌ Missing link | ML-001 (must call both) |
| DM → Unread Count | ❌ Missing link | ML-006 (inbox not written on DM send) |
| Presence → Player Stats | ❌ Missing link | ML-002 (stats not updated by presence) |
| Spectate → Active Challenge | ⚠️ Partial | ML-007 (no validation gate) |
| Invite With Reward → Wallet | ⚠️ Partial | ML-005 (reward never claimed) |

**8 out of 10 clusters are healthy. 2 have broken links, 2 are partial. All 8 Missing Links (ML-001 to ML-008) are solvable in Phase 1/2 without architectural changes.**

---

## Appendix E: Deep Angle Analysis — What the Plan Still Needs

> Thinking from three perspectives: **Mark Zuckerberg** (Facebook social graph), **Steve Jobs** (Apple iOS product discipline), and **Game Psychology** (retention science). Each angle reveals gaps the core plan doesn't yet address.

---

### E.1 The Facebook / Mark Zuckerberg Angle — Social Graph Thinking

Facebook's core insight (1 trillion edges, 3 billion users): **the graph structure matters more than the content on top of it.** Right now our design treats every friendship as equal. That's wrong.

#### Edge Weight — Not All Friends Are Equal

```
Current model:  A ←→ B  (binary: friend or not friend)

World-class:    A ──[weight=0.92]──► B
                weight = f(challenges played, streaks, DMs, mutual groups, recency)
```

| Why it matters | What breaks without it |
|---------------|----------------------|
| `ivx_social_friend_search` returns 200 friends in random order | User can't find their closest playmates |
| `ivx_social_challenges_pending` shows oldest challenges first | Challenges from strangers clutter the inbox |
| `ivx_social_pressure_summary` shows all friends equally | Pressure from a casual acquaintance has zero effect |
| Group member list shows random order | Owner can't see who is most active |

**What to add:**
A `friend_affinity` score updated server-side every time two users interact. Score decays daily. Stored in `ivx_friend_edge_weights/{min(A,B)}_{max(A,B)}`. Used to sort friend lists, surface challenge notifications, and power recommendations.

#### Viral Loop Instrumentation — The K-Factor

Andrew Chen (a16z): *"A big launch that pumps total users but doesn't increase network density will fail. You need minimum network density."*

The viral coefficient: **K = invites sent per DAU × invite acceptance rate**

- If K > 1.0 → exponential growth
- If K < 0.5 → growth stalls (paid UA dependent forever)
- Duolingo targets > 0.3 organic K via friend invites + streak sharing

**What to add to the plan:**
Every `ivx_social_invite_send` and `ivx_social_invite_accept` must emit an analytics event with:
```json
{ "event": "invite_sent|invite_accepted",  "sourceUserId": "A",
  "targetUserId": "B",  "channel": "in_app|push_tap|share_link|qr_code",
  "gameId": "quizverse",  "daysSinceSourceJoined": 14 }
```
This lets the data team compute K weekly and A/B test invite prompts.

#### Friend-of-Friend Recommendations — Graph Traversal

Right now `ivx_social_friend_nearby` uses **geo** (same country). That's weak social signal. Facebook's recommendation engine is built on **graph distance**:

- 2nd degree: "3 mutual friends" — strongest signal
- Same group member: "Both in Quiz Masters" — strong signal
- Same quiz topic played: "Both completed Science → Hard" — medium signal

**What to add:**
Extend `ivx_social_friend_search` with a recommendation mode:
```json
{ "gameId": "quizverse", "mode": "recommended", "limit": 10 }
```
Server-side logic: SQL query for friends-of-friends + group co-members + same topic players. Ranked by mutual friend count descending.

#### Network Density Threshold — The Critical Metric

Andrew Chen: *"100,000 users with 30 connections each beats 1,000,000 with 2 connections each."*

Current plan has zero measurement for this. Add a server-side check:

- **Network density gate**: User with < 3 confirmed friends → show "Find Friends" banner on every Social Zone open
- **Retention correlation target**: Users with 5+ friends should have 2× DAU/MAU vs users with 0 friends (measure, don't assume)
- **New user social onboarding target**: Every new user should have ≥ 1 friend within 7 days of joining

---

### E.2 The Steve Jobs / Apple iOS Angle — "It Just Works" Discipline

Jobs's standard: **every critical user flow must have exactly ONE path that always succeeds.** No fallbacks. No "try again." The product absorbs the complexity.

#### The Presence Heartbeat Will Break on iOS

iOS aggressively suspends background apps. A 60-second heartbeat `ivx_social_presence_set` will fire 0 times while the app is backgrounded. The result: every QuizVerse player appears offline 30 seconds after they switch to WhatsApp.

**The Apple-correct solution:**
```
APNs Background Mode (silent push) to wake the app for heartbeat
  OR
On app foreground → immediate presence_set call
On app resign active → presence_set { online: false } (with 10s background task)
```
The plan must explicitly state: **presence heartbeat is foreground-only**. `lastSeenMs` within 90s means online — not 5 minutes of assumed online with no signal.

#### Deep Links for Uninstalled Users

Current plan: `quizverse://group/join/QM-XK94`

This URL **does nothing** if QuizVerse is not installed. The world-class behavior:

```
User A (installed)  shares: https://quizverse.app/join/QM-XK94
User B (not installed) taps link:
  → Universal Link / App Link opens App Store
  → Installs QuizVerse
  → App opens → deferred deep link auto-runs join/QM-XK94
  → User B is immediately in the group
```

**What to add to the plan:**
- Use HTTPS Universal Links (iOS) + App Links (Android) — not custom scheme `quizverse://`
- ⚠️ CORRECTED 2026-07-06: do NOT use Firebase Dynamic Links — Google **shut the service down on 2025-08-25**. Use Branch.io, or the in-house pattern: the web `/join/[code]` page stores the code, the app reads it post-install via install-referrer (Android) / clipboard-pasteboard check (iOS).
- **Ground this in assets that already exist (verified 2026-07-06):**
  - The Unity repo already ships `apple-app-site-association` + `assetlinks.json` (repo root of `games/quiz-verse`) with paths like `/invite/*`, `/challenge/*`, `/ref/*` — **`/join/*` is missing and must be added** to both files.
  - The QuizVerse web frontend (`Quizverse-web-frontend/web/app/join/`) already has `join/clan` and `join/event` routes — add `join/group/[code]` as the web fallback + deferred-join page, reusing the existing `unity-auth-bridge` query-param handoff (`web/lib/unity-auth-bridge/`).
- Group invite link = `https://<existing web domain>/join/group/{code}` — one domain, already serving AASA, already deployed.

#### Push Notification Permission — One Shot

iOS gives you **ONE chance** to request push notification permission. If the user denies, you cannot ask again. Denied users never get friend invites, challenge notifications, or group updates.

**The Steve Jobs approach:** Earn the permission, don't demand it on launch.

**What to add to the plan:**
```
Permission Request Strategy:
1. NEVER ask at app launch (instant deny rate ~60%)
2. Ask ONLY when user has taken a social action:
   "Maria just sent you a friend invite — enable notifications to see it?"
   "Your group just earned 100 XP — enable notifications to never miss it?"
3. If denied: use in-app inbox (Tier 2) as silent fallback — never abandon the user
4. Re-prompt after 30 days via settings nudge (non-intrusive)
```

Add to server: RPC response for `ivx_social_invite_send` must include a field `suggestPushPermission: true` when the **sender** has push tokens but the **target** doesn't. Unity client uses this to trigger the permission prompt at the right moment.

#### Offline-First Friends List

On iOS with poor connection, the Social Zone shows a spinner indefinitely. Jobs's standard: **show stale data instantly, refresh in background.**

**What to add to the plan:**
- Unity must cache `ivx_social_friends_list` response in `PlayerPrefs` / local storage with a timestamp
- On Social Zone open: show cached list immediately, start background refresh
- Visual indicator: "Updated 3 minutes ago" — not a blank spinner
- This is a **Unity client responsibility**, but the server must include `meta.timestamp` in every response (already planned) and Unity must honour it

#### Share Sheet Integration (iOS Native)

Group invite link copy-to-clipboard is a 2019 UX pattern. The world-class flow uses the iOS native Share Sheet:

```
Unity calls: Application.OpenURL("intent://share?...") on Android
             SystemInfo.platform → iOS: use Unity's NativeShare plugin
             → Share Sheet shows: WhatsApp, iMessage, Telegram, Copy Link, AirDrop
```

**What to add to the plan:**
- `ivx_social_group_invite_link` response must include a `shareText` field:
  ```json
  { "inviteCode": "QM-XK94",
    "deepLink": "https://quizverse.app/join/QM-XK94",
    "shareText": "Join my QuizVerse group 'Quiz Masters'! 🎯 https://quizverse.app/join/QM-XK94" }
  ```
- Unity client passes `shareText` directly to the native Share Sheet — no manual copy needed

---

### E.3 Security, Trust & Safety — The Invisible Architecture

Every social product eventually becomes a vector for abuse. These gaps will be exploited.

#### Block Propagation — Incomplete in Current Design

Current design: `ivx_social_friend_block` adds to `ivx_user_blocks`. But:

| Scenario | Current behavior | Correct behavior |
|----------|-----------------|-----------------|
| A blocks B. B is in the same group as A. | B can still see A's group activity | A's activity hidden from B in group feed |
| A blocks B. B searches for players. | A appears in B's search results | A excluded from B's `ivx_social_friend_search` |
| A blocks B. B sends a challenge. | Server checks blocks at challenge send ✅ | Already handled |
| A blocks B. B is group owner. | B can kick A from the group | Correct — block doesn't override admin rights |

**What to add:**
`ivx_social_group_activity_log` and `ivx_social_group_detail` must filter activity by mutual block status before returning member data. Cost: one extra batch read of `ivx_user_blocks` for the viewer's block list.

#### Report System — Missing Entirely

There is no way to report a user, a group, or a challenge. Without it:
- Toxic players cannot be actioned without admin intervention
- Spam groups appear in search forever
- Abusive challenges sit in inboxes permanently

**Minimum viable report system to add:**
```
ivx_social_report(targetId, targetType, reason, details?)
  → Writes to ivx_moderation_reports/{reportId}
  → Nakama admin console query for review
  → Auto-action: if user receives 5+ reports in 7 days → flag for review
```

#### GDPR / Account Deletion — Cascade Delete

When a user deletes their account, the current design leaves orphaned data everywhere:

| Collection | Orphaned data | Action needed |
|-----------|--------------|---------------|
| `ivx_social_invites` | Rows where deleted user is sender | Delete all `inv_{deletedId}_*` |
| `ivx_game_challenges` | Challenge inbox/outbox | Delete all challenges involving deleted user |
| `ivx_friend_streaks` | Streak pairs | Delete all `*_{deletedId}` keys |
| `ivx_notification_inbox` | Notifications sent to deleted user | Auto-cleaned (storage owner deleted) |
| `ivx_groups_meta` | Groups created by deleted user | Ownership transfer to oldest admin, or archive |
| Nakama user_friends | Friend edges | Auto-cleaned by Nakama on account delete |

**What to add:**
A `before_delete_account` Nakama hook that runs the cascade delete sequence before the native account wipe.

#### Async Challenge Score Integrity

Current design: client sends `myScore` in the challenge payload. There is no server-side verification.

```json
// Any client can send this:
{ "friendUserId": "B", "gameId": "...", "challengeData": { "myScore": 999999 } }
```

**What to add:**
`ivx_social_challenge_send` must check that the score is backed by a signed server-side quiz result:
```
challengeData.scoreToken = JWT signed by quiz completion RPC
Server verifies token before accepting the challenge
```

---

### E.4 The Cold-Start Problem — New Users with Zero Friends

Andrew Chen (a16z): *"Social products fail when users have 0 connections. You need minimum network density."*

The Social Zone for a new user is an empty list. That's the worst possible first impression for a social feature.

#### Cold-Start Ladder — The 4 Stages

```
Stage 0: 0 friends  → "Find Friends" is the only CTA. Show suggestions prominently.
Stage 1: 1-2 friends → Show "People Like You" strip. Celebrate the first friend loudly.
Stage 2: 3-9 friends → Show friend leaderboard. Social pressure kicks in.
Stage 3: 10+ friends → Full social zone. Challenges, battles, group suggestions.
```

**What to add to server:**
A new RPC `ivx_social_onboarding_state` that returns:
```json
{
  "friendCount": 0,
  "stage": 0,
  "suggestedActions": [
    { "action": "find_friends", "priority": 1, "cta": "Find your first friend" },
    { "action": "import_contacts", "priority": 2, "cta": "Find friends from your contacts" }
  ]
}
```

**Contact Import (the fastest cold-start fix):**
- Unity collects phone contacts (with permission)
- Hash phone numbers client-side (SHA-256) — never send raw numbers
- `ivx_social_contacts_match(hashedPhones[])` → returns matched users
- This is how WhatsApp, Snapchat, and Duolingo seeded their social graphs

#### The "Atomic Network" Concept

Groups can solve cold-start if seeded correctly. One active group of 10 people creates a self-sustaining engagement loop even when the global friend graph is sparse.

**What to add:**
Curated "starter groups" per topic/language — pre-populated by the game team. New users are suggested these groups immediately after onboarding. Joining one group immediately gives the social zone meaningful content.

---

### E.5 Scalability — When You Hit 1M Users

The current design works fine at 10K users. At 1M, these specific patterns will fail:

#### The Fan-Out Problem

A popular player with 5,000 friends sends an invite. The current `ivx_social_invite_send` handler:
1. Calls `nk.usersGetId` ✅
2. Calls `nk.friendsList(callerId, 1000, null, null)` — returns up to 1,000 friends — OK
3. Calls `nk.notificationsSend` for 1 target ✅

Actually, the fan-out problem here is **groups**: when a group admin logs activity with `ivx_social_group_activity_log`, should all 50 members get a push? Currently, no. But when we add group activity notifications, it will be 50 simultaneous pushes per log call. At 1,000 groups each with 50 members each logging 10 activities per day: **500,000 push calls per day from one RPC**.

**What to add to the plan:**
Group activity notifications must be **async fan-out** — not inline in the RPC handler:
```
ivx_social_group_activity_log
  → write to storage (sync)
  → write to ivx_notification_fanout_queue/{groupId}/{actId}
  → return success immediately

Background job (every 30s):
  → reads ivx_notification_fanout_queue
  → paginates through group members
  → sends push notifications via FCM HTTP v1 (⚠️ CORRECTED 2026-07-06: the
    legacy FCM batch-send endpoint was DISCONTINUED by Google in June 2024.
    Use per-message HTTP v1 sends over a shared HTTP/2 connection, or the
    Admin SDK `sendEach()` equivalent — cap concurrency at ~100 in-flight)
```

#### Challenge Expiry Cleanup — Time Bomb

Current code comment: *"lazy expiry sweep at read time"* in `list_pending_friend_challenges`. This means **every call to `ivx_social_challenges_pending` scans all stored challenges and filters expired ones in JS**. At 10K challenges per user, this is O(N) in JS with N storage reads.

**What to add:**
A scheduled cleanup job that runs every hour. ⚠️ CORRECTED 2026-07-06: **Nakama's JS runtime has no native cron scheduler.** This codebase already has two established patterns — use one of them, don't invent a third:

1. **Kubernetes CronJob → service-token RPC** (the production pattern: see `intelli-verse-kube-infra/nakama/tournament-cron-*.yaml`, `analytics-tick-cronjob.yaml`). Register `ivx_social_challenge_cleanup_tick` guarded by `RpcHelpers.requireServiceToken`, add a CronJob manifest next to the tournament ones.
2. **Opportunistic tick with a storage-version leader lock** (the `TournamentCrons.opportunisticTick` pattern — piggybacks on high-traffic RPCs, at most once per interval globally).

```
ivx_social_challenge_cleanup_tick   (service-token gated)
  → SQL query: SELECT key FROM storage WHERE collection='ivx_game_challenges'
               AND value->>'expiresAt' < NOW()
  → Batch delete expired rows (paged, max 1000/tick)
```
This converts O(N) per-request work into O(1) per-request + offline cleanup. The same job family handles feed-event retention (§14A.4) and stale presence rows (B-005).

#### Friends List Cache — Most Read, Least Written

The friends list is read every time the Social Zone opens (30+ times per day per active user), but changes only when someone adds/removes a friend (~1× per week). It's the perfect cache candidate.

**What to add:**
```
Cache layer: Nakama storage key ivx_friends_cache/{userId}
  - Written: on every mutation (invite accept, remove, block)
  - Read: by ivx_social_friends_list on cache hit (< 30s old)
  - Invalidated: by incoming notification code 2 (accept) or code 5 (remove)
  - TTL: 30 seconds hard expiry regardless
```
Estimated saving: **-80% DB reads** on `ivx_social_friends_list`.

---

### E.6 Game Psychology — What Actually Drives Daily Returns

The social layer's job is not just connecting players. It's creating emotional reasons to open the app every day.

#### Loss Aversion — "You're Being Passed"

Duolingo's most effective retention feature is not the streak. It's: **"Maria just passed you in the leaderboard."**

Loss aversion is 2× stronger than equivalent gain. Seeing a friend move ahead is more motivating than seeing yourself move up.

**What to add:**
`ivx_social_pressure_summary` already exists. Enhance it to return:
```json
{
  "friendsAheadOfMe": [
    { "userId": "...", "displayName": "Maria", "xpThisWeek": 1400, "gapXP": 120, "movedAheadMinutesAgo": 14 }
  ],
  "friendsBehindMe": 3,
  "myRankInFriendList": 4,
  "totalFriendsThisWeek": 8
}
```
Unity renders this as: **"Maria passed you! 120 XP to get back ahead 🔥"** — tap to open a quiz.

#### Social Proof on Quiz Cards

Gizmo app's highest-converting feature: inline social proof on content.

**What to add:**
A lightweight RPC `ivx_social_quiz_social_proof(gameId, quizIds[])` that returns:
```json
{
  "quizId_123": { "friendsCompleted": 3, "topFriendScore": 1450, "friendNames": ["Ana", "Mike"] }
}
```
Unity shows on each quiz card: *"Ana and 2 friends played this"* — no extra taps required.

#### Group Streaks — The Collaborative Hook

Individual streaks break and die. Group streaks are kept alive by the whole group. If even one person plays today, the group streak survives.

**What to add:**
Extend `ivx_groups_progress` with:
```json
{ "groupStreakDays": 14, "groupStreakLastContributorId": "...", "groupStreakAtRiskAt": "2026-06-30T00:00:00Z" }
```
RPC `ivx_social_group_streak_status` — returns group streak health. Notification code 30 fires when streak is at risk → pushes to all group members.

#### The "7-Day Social Onboarding" Sequence

Instagram, Duolingo, and Discord all invest heavily in the first 7 days to reach social activation. Define the social activation event:

```
Social Activation = User has ≥ 1 confirmed friend AND ≥ 1 completed challenge
                    within their first 7 days

Target: 40% of new users reach social activation within 7 days
Measure: cohort analysis on invite_send + invite_accept + challenge_complete events
```

Day-by-day nudge sequence (server-driven, not hardcoded in client):
- Day 1: "Find 1 friend to challenge"
- Day 3 (if 0 friends): "Search for friends by username"
- Day 5 (if 1 friend, no challenge): "Challenge [friend name] to a quiz!"
- Day 7 (if no social activation): "Join a group — you don't need friends to start"

---

### E.7 Hard Anti-Patterns — What Must Never Be Built

These patterns look reasonable in isolation but are known to destroy social features at scale.

| # | Anti-Pattern | Why It's Deadly | The Rule |
|---|-------------|----------------|---------|
| AP-001 | **Over-notification** — sending push for every social event | iOS users deny push permission → 60% of users never get social notifications again | Max 2 push/day from social layer per user. Batch. Bundle. |
| AP-002 | **Lazy expiry in list RPCs** | O(N) JS scan per request → 10s latency at scale | All expiry via scheduled cleanup job only |
| AP-003 | **Socket online = presence** | Socket drops on iOS background → all users appear offline instantly | `ivx_presence_v2` storage is the ONLY presence source |
| AP-004 | **Client-side gameId filtering** | Returns wrong groups, wrong challenges, wrong friends from other games | Every list RPC filters at DB level via SQL WHERE |
| AP-005 | **Symmetric blocking without propagation** | Blocked user still visible in group feeds | Block check on every social read that returns user data |
| AP-006 | **PII in group metadata** | GDPR violation — group.metadata contains displayNames, avatarUrls | Group metadata stores IDs only; names resolved at read time |
| AP-007 | **Challenge scores trusted from client** | Score = 999999 trivially exploitable | Scores must be signed server-side at quiz completion |
| AP-008 | **Fan-out in RPC handler** | 50-member group activity → 50 synchronous pushes → 10s RPC timeout | Fan-out always via async queue |
| AP-009 | **Invite spam with no pair rate limit** | One user sends 1000 invites per hour | Rate limit key must be per-pair, not per-user |
| AP-010 | **Empty social zone for new users** | First impression is a blank list → instant churn | Cold-start onboarding state RPC required |

---

### E.8 Summary — What the Plan Is Missing (Action Items)

| # | Gap | Angle | Priority | Phase |
|---|-----|-------|---------|-------|
| G-001 | Friend affinity/edge weight scoring | Facebook | High | Phase 2 |
| G-002 | Viral loop instrumentation (K-factor events) | Facebook | High | Phase 1 |
| G-003 | Friend-of-friend / mutual friend recommendations | Facebook | Medium | Phase 3 |
| G-004 | Network density measurement + social activation metric | Facebook | High | Phase 1 |
| G-005 | APNs silent push for background presence | iOS | Critical | Phase 1 |
| G-006 | Universal Links / deferred deep link for group join | iOS | High | Phase 2 |
| G-007 | Push permission request strategy (earn, not demand) | iOS | High | Phase 1 |
| G-008 | Offline-first friends list cache in Unity | iOS | Medium | Phase 2 |
| G-009 | `shareText` field in group invite link response | iOS | Low | Phase 2 |
| G-010 | Block propagation to group activity feed | Security | High | Phase 1 |
| G-011 | Report system `ivx_social_report` RPC | Security | High | Phase 2 |
| G-012 | GDPR cascade delete hook on account deletion | Security | Critical | Phase 1 |
| G-013 | Challenge score JWT signing at quiz completion | Security | High | Phase 2 |
| G-014 | `ivx_social_onboarding_state` cold-start RPC | Cold Start | Critical | Phase 1 |
| G-015 | Contact import / phone number hash matching | Cold Start | High | Phase 2 |
| G-016 | Curated starter groups for new users | Cold Start | Medium | Phase 2 |
| G-017 | Async fan-out queue for group notifications | Scalability | High | Phase 2 |
| G-018 | Scheduled challenge expiry cleanup job | Scalability | High | Phase 1 |
| G-019 | Friends list cache (30s TTL) | Scalability | Medium | Phase 2 |
| G-020 | Enhanced `ivx_social_pressure_summary` with gap data | Psychology | High | Phase 2 |
| G-021 | `ivx_social_quiz_social_proof` — friends played inline | Psychology | High | Phase 2 |
| G-022 | Group streak system in `ivx_groups_progress` | Psychology | Medium | Phase 3 |
| G-023 | 7-day social onboarding sequence (server-driven nudges) | Psychology | High | Phase 2 |

**23 new gaps identified across 6 angles. 5 are Critical (ship in Phase 1), 12 are High, 6 are Medium.**

## Appendix F: 2026 Competitive Refresh & Conversion Engine

> **Date:** 2026-07-06 | **Source:** Live web research (Duolingo engineering blog, Supercell ScyllaDB blog, Clash of Clans June 2026 update, Gizmo Series A announcement, Mobile Game Retention Guide 2026)

### F.1 Executive Summary

This appendix adds **new 2026 findings** not available when the original document was written (2026-06-29). The competitive landscape has shifted:

- **Duolingo's Leagues** are now confirmed as their #1 retention driver (+25% lesson completion, 5.6x friend-follower course completion)
- **Gizmo** raised $22M Series A (April 2026) with real-time group quiz battles as their core differentiator
- **Clash of Clans** (June 2026) brought back Global Chat as a 3-tier system (Groups → Communities → Town Square)
- **Rich push notifications** with images + action buttons now deliver **56% higher open rates** (2026 benchmarks)
- **K-factor tracking** is mandatory: every social feature must measure invites-sent × conversion-rate

### F.2 The Retention Mechanics Ranking (By Proven Impact)

| Rank | Mechanic | Source | Proven Metric | Implementation Phase |
|------|----------|--------|---------------|---------------------|
| 1 | **Duo Quests** (random weekly pairing, shared goal) | Duolingo | 5.6x course completion for friend-followers | Phase 1 |
| 2 | **Leagues** (30-player weekly, promo/demotion) | Duolingo | +25% lesson completion, multi-month engagement | Phase 2 |
| 3 | **Friend Streaks** (mutual accountability) | Duolingo | Higher DAU/MAU than individual streaks | Phase 2 |
| 4 | **Rich Push Notifications** (image + action buttons) | 2026 Mobile Benchmarks | 56% higher open rates vs plain text | Phase 1 |
| 5 | **Real-time Group Quiz** (live answer visibility) | Gizmo | Highest engagement mode in competitive learning | Phase 1 |
| 6 | **Invite Links + Native Share Sheet** | Supercell / Gizmo | K-factor 0.4-0.6 target for social games | Phase 1 |
| 7 | **Presence + Social Pressure** (who's online now) | Duolingo / Supercell | FOMO trigger, immediate session starts | Phase 2 |
| 8 | **Streak Repair** (pay Gems to fix broken streak) | Duolingo | Direct monetization + retention safety net | Phase 3 |
| 9 | **Friend-of-Friend Recommendations** | Facebook / LinkedIn | Network density > total user count | Phase 4 |
| 10 | **Group Tournaments / Clan Wars** | CoC / Gizmo | Collective motivation, inter-group rivalry | Phase 4 |

### F.3 The 12-Week Build Roadmap

#### Phase 0 — Pre-Requisites (Weeks 1-2)
**Goal:** Fix live bugs before building new features

| Task | Fixes | Skill Required |
|------|-------|---------------|
| Boot `IVXFriendsManager` in Unity scene | All socket notifications currently dropped | `unity-mcp-skill` |
| Fix dual `create_game_group` registration (B-003) | 3 competing implementations = undefined behavior | `nakama-rpc` + `nakama-debug` |
| Fix per-pair rate limit (B-009) | Allows invite spam, hurts K-factor | `nakama-rpc` |
| Verify push token registration (FCM/APNS) | Rich pushes require valid tokens | `nakama-docker` |
| Regenerate `COMPLETE_RPC_REFERENCE.md` | 70+ social RPCs undocumented | `nakama-modules` |

#### Phase 1 — Viral Loop MVP (Weeks 3-4)
**Goal:** Turn 1 player into 2 players

| Feature | Technical Requirements | Skills |
|---------|----------------------|--------|
| Rich push notifications | `mutable-content: 1` + iOS Notification Service Extension + image downsampling (<50MB) | `nakama-rpc` + `nakama-docker` |
| Duo Quests (random pairing) | Weekly cron job, random friend pairing, shared XP goal, pre-written nudges | `nakama-rpc` + `nakama-economy` |
| Group quiz live entry point | Reuse `TeamBattleManager` + party-match template, add UI affordance | `unity-mcp-skill` + `nakama-rpc` |
| Invite links + native Share Sheet | HTTPS Universal Links (`quizverse.app/join/{code}`), `shareText` field in RPC response | `nakama-rpc` + mobile native |

**K-Factor Target:** 0.4-0.6

#### Phase 2 — Retention Core (Weeks 5-8)
**Goal:** Make players come back every day

| Feature | Technical Requirements | Skills |
|---------|----------------------|--------|
| Leagues (30-player weekly) | 10-tier ladder (Bronze→Diamond), Sunday-night reset, promotion/demotion, skill-based matchmaking | `nakama-rpc` + `nakama-economy` |
| Friend Streaks + repair | Shared streak counter, mutual daily check-in, Gem-based repair RPC | `nakama-rpc` + `nakama-economy` |
| Friends Activity Feed | Gizmo-style chronological stream, event writer hook after quiz completion, TTL 7 days | `nakama-rpc` |
| Presence V2 (90s heartbeat) | Per-game key, `sessionId` tracking, bulk read RPC, foreground-only contract | `nakama-rpc` |

**Retention Target:** D30 from 5% -> 8-10%

#### Phase 3 — Conversion Engine (Weeks 9-10)
**Goal:** Turn engagement into revenue

| Feature | Monetization Mechanic | Skills |
|---------|---------------------|--------|
| Streak repair with Gems | 50 Gems to fix own streak, 100 Gems to fix friend's streak (social guilt premium) | `nakama-economy` |
| Premium league badge frames | Diamond/Pearl frames visible on profile → status signal | `nakama-rpc` + `nakama-economy` |
| Exclusive group cosmetics | Season pass for group themes, animated badges, name colors | `nakama-economy` |
| Duo Quest premium multiplier | Free users = 50% reward; Premium = 2x reward | `nakama-economy` |
| Time-limited event bundles | "Weekend Warrior" pack: 500 Gems + exclusive frame + 3 streak repairs | `nakama-economy` |

**ARPU Target:** +30% from social mechanics

#### Phase 4 — Scale & Network Effects (Weeks 11-12)
**Goal:** Product grows itself

| Feature | Network Effect | Skills |
|---------|---------------|--------|
| Friend-of-friend recommendations | SQL query for 2nd-degree connections + mutual groups + same-topic players | `nakama-rpc` |
| Group tournaments / clan wars | Weekly inter-group battles, group-level prizes, bracket system | `nakama-rpc` + `nakama-economy` |
| UGC quiz deck marketplace | Players create/share decks, viral classroom adoption | `nakama-rpc` |
| "Study Group" school leaderboards | "Your school is #3 in NYC this week" → geographic pride | `nakama-rpc` + `nakama-economy` |

### F.4 Push Notification Deep-Dive (2026 Benchmarks)

#### iOS Requirements (Critical)
| Requirement | Implementation | Impact |
|-------------|---------------|--------|
| Notification Service Extension | Add NSE target to Xcode, implement `didReceive(_:withContentHandler:)` | Required for rich push |
| `mutable-content: 1` | Set in FCM payload | Enables image download |
| Image downsampling | Downsample to <1MB before displaying | Prevents 50MB memory limit crash |
| `serviceExtensionTimeWillExpire()` | Always implement fallback to text-only | Prevents blank notifications |
| Soft-ask permission timing | Ask AFTER positive social moment (friend accepted, quest completed) | 37% iOS opt-in vs 60% at launch |

#### Android Requirements
| Requirement | Implementation | Impact |
|-------------|---------------|--------|
| Runtime permission (API 33+) | Same soft-ask as iOS | 91% opt-in on Android |
| Rich notification format | FCM `image` field natively supported | No NSE equivalent needed |
| Notification channels | Separate channels for social, challenges, leagues | User can mute non-critical |

#### Frequency & Personalization Rules
| Rule | Detail |
|------|--------|
| Max 2-3 marketing pushes per week | More causes opt-outs/uninstalls |
| Send at player's local 6 PM | Hits "commute home" play window |
| Use player name + friend name + specific score | 3-5x higher engagement vs generic |
| Event-driven only (streak risk, league deadline, challenge received) | Never "Come back!" pings |

### F.5 The K-Factor / Viral Loop Design

Every social feature must emit analytics events for K-factor computation:

```json
{
  "event": "invite_sent",
  "sourceUserId": "uuid-a",
  "targetUserId": "uuid-b",
  "channel": "in_app|push_tap|share_link|qr_code|native_share_sheet",
  "gameId": "quizverse",
  "daysSinceSourceJoined": 14,
  "sourceFriendCount": 5,
  "sourceLeagueTier": "silver"
}
```

**K = invites_sent_per_DAU × invite_acceptance_rate**

| K Value | Interpretation |
|---------|---------------|
| K < 0.3 | Growth stalls, paid UA dependent |
| K = 0.3-0.6 | Healthy social contribution, reduces blended CPI by 28-37% |
| K > 1.0 | Exponential organic growth (rare, usually temporary) |

**Target: K ≥ 0.4 within 30 days of Phase 1 launch.**

### F.6 Conversion Mechanics Detail

#### Streak Repair (Primary Monetization)
```
Player breaks a 7-day streak with Friend A
→ Notification: "Your streak with Friend A is broken! Repair for 50 Gems?"
→ Friend A ALSO gets: "Your streak with Player is broken. Nudge them to repair?"
→ Social guilt premium: Repairing YOUR streak costs 50 Gems
→ Social saint premium: Repairing FRIEND'S streak costs 100 Gems
→ Revenue doubles when both players feel responsible
```

#### League Season Pass
```
Free League Player:
- Competes in Bronze→Diamond ladder
- Earns standard coin rewards
- No cosmetic rewards

Premium League Pass (499 Gems / season):
- Instant "Premium" badge frame
- 2x coin rewards from league placement
- Exclusive animated avatar border for current tier
- Early access to new league maps/themes
- "Premium-only" weekly tournament entry
```

#### Duo Quest Premium Multiplier
```
Free Duo Quest:
- Goal: "Earn 500 XP together in 3 days"
- Reward: 100 coins each

Premium Duo Quest:
- Same goal
- Reward: 200 coins each + exclusive "Duo Master" badge
- Streak bonus: If both are Premium, streak counts as 2 days instead of 1
```

### F.7 Required Agent Skills for Implementation

| Feature Domain | Primary Skill | Secondary Skill | Context Files |
|----------------|--------------|-----------------|---------------|
| New RPCs (leagues, duo quests, streaks) | `nakama-rpc` | `nakama-ts-build` | `data/modules/src/<domain>/<domain>.ts` |
| Wallet/currency (streak repair, season pass) | `nakama-economy` | `nakama-rpc` | `data/modules/wallet.js`, `docs/wallets.md` |
| Module organization (new domains) | `nakama-modules` | `nakama-rpc` | `data/modules/src/` structure |
| Build errors / compilation | `nakama-ts-build` | `nakama-debug` | `data/modules/postbuild.js` |
| Docker restart / env vars | `nakama-docker` | — | `docker-compose.yml` |
| Runtime debugging (RPC not found, etc.) | `nakama-debug` | `nakama-rpc` | `docker compose logs nakama` |
| Unity scene wiring (IVXFriendsManager) | `unity-mcp-skill` | — | `MainQuiz.unity` hierarchy |
| Web research / competitive intel | `user-firecrawl` | — | Firecrawl MCP tools |

### F.8 Cross-Reference to Original Document Sections

| Original Section | This Appendix Adds |
|-----------------|-------------------|
| §3.2 Duolingo Research | Leagues detail (promotion/demotion), Friends Quests mechanics, Friend Streaks |
| §3.3 Gizmo Research | Real-time group quiz confirmation, Study Group nudge mechanics |
| §7 Groups Architecture | Group invite links → Native Share Sheet, Communities vs Clans (CoC 2026) |
| §9 Notification Design | Rich push requirements (2026 benchmarks), iOS NSE implementation |
| §10 Rate Limiting | Per-pair rate limits for invites + challenges (K-factor optimization) |
| §E.1 Facebook Angle | K-factor tracking, friend-of-friend recommendations, network density gates |
| §E.2 Steve Jobs Angle | Soft-ask permission timing, offline-first cache, native Share Sheet |
| §E.3 Security | Report system minimum viable product, GDPR cascade delete specifics |

---

## Appendix G: Agent Skill Activation Guide

> **For AI agents implementing this plan:** Read ONLY the skills matching your current task. Max 2 skills per task. Never read all skills.

### Task → Skill Mapping

| Task | Primary Skill | Secondary Skill | Why |
|------|--------------|-----------------|-----|
| Implement `ivx_social_leagues_get` RPC | `nakama-rpc` | `nakama-economy` | Leagues use leaderboard + wallet |
| Implement `ivx_social_duo_quest_create` | `nakama-rpc` | `nakama-economy` | Quests grant rewards |
| Implement streak repair monetization | `nakama-economy` | `nakama-rpc` | Wallet mutations + RPC endpoint |
| Fix `IVXFriendsManager` in Unity | `unity-mcp-skill` | — | Scene object management |
| Add rich push notification support | `nakama-rpc` | `nakama-docker` | Payload schema + FCM/APNS config |
| Build failure after adding new module | `nakama-ts-build` | `nakama-debug` | tsc + postbuild.js verification |
| RPC not appearing in `index.js` | `nakama-debug` | `nakama-rpc` | postbuild detection + global scope check |
| Docker restart after code change | `nakama-docker` | — | `docker compose restart nakama` |

### Quick Skill Reference

- **`nakama-rpc`** — Register, implement, debug RPCs. Key: functions MUST be global scope, registerRpc MUST be direct call in InitModule.
- **`nakama-economy`** — Wallet, storage, leaderboards, IAP. Key: all wallet mutations are server-authoritative.
- **`nakama-modules`** — Navigate 40+ module system, add domains, manage cross-module deps. Key: modules cannot import each other; use global helpers.
- **`nakama-ts-build`** — TypeScript compilation, postbuild.js, ES5 target. Key: `npm run build` → verify in `index.js`.
- **`nakama-debug`** — Runtime errors, logs, RPC not found, goja crashes. Key: `docker compose logs nakama`.
- **`nakama-docker`** — Docker compose, restart, env vars, FCM/APNS credentials. Key: `RUNTIME_ENV_KEYS` in docker-compose.yml.
- **`unity-mcp-skill`** — Unity scene management, GameObject create/modify, component wiring.
- **`user-firecrawl`** — Web research, competitive analysis, documentation scraping.

---

*Document generated by AI architecture review — 2026-06-29.*  
*All changes are PLANNING ONLY. Zero code modifications made.*

*Section 17 added 2026-07-04: live validation against the Unity client and Nakama server codebases, plus a fresh Duolingo/Gizmo competitive pass. All Section 2 bug claims were confirmed accurate against code. Zero code modifications made in this update either — Section 17 and its backlog are still planning-only.*

*Appendices F & G added 2026-07-06: 2026 competitive refresh with Duolingo Leagues/Duo Quests, Gizmo real-time battles, rich push benchmarks, K-factor viral loop design, conversion mechanics (streak repair, season pass, premium duo), and agent skill activation guide for implementation.*

*Section 19 added 2026-07-06 (Principal Architecture Pass): re-verified all §17 findings against live code; applied nine in-place corrections (C-001…C-009 — Nakama storage TTL does not exist, feed permission leak, feed SQL read path, cron mechanism grounded in the k8s CronJob convention, FCM batch API and Firebase Dynamic Links discontinuations, presence threshold + native status hybrid, duplicate §15 numbering, B-004 is three files); added multi-app tenant registry (`ivx_app_registry`), use-the-platform checklist, idempotency/versioning standard, observability wiring into AnalyticsAlerts/Prometheus/Discord, unified data-lifecycle job + index strategy, capacity model, and per-phase rollout gates. Still planning-only — zero code modifications.*
