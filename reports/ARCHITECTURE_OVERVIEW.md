# Nakama Backend Architecture Overview (Unity-First Explanation)

Date: January 31, 2026

## 1) What this repository is

This is a customized Nakama server that exposes a large set of game backend features via RPCs and built-in Nakama APIs. The core runtime is the Nakama server written in Go, and the game logic is implemented in JavaScript and Lua modules under data/modules.

Key entrypoints and runtime wiring:

- Server startup and lifecycle: [main.go](main.go#L1)
- API server, gRPC + HTTP gateway, WebSocket: [server/api.go](server/api.go#L1)
- HTTP RPC handler: [server/api_rpc.go](server/api_rpc.go#L1)
- JavaScript runtime module registry: [data/modules/index.js](data/modules/index.js#L1)
- Database schema migrations: [migrate/sql/20180103142001_initial_schema.sql](migrate/sql/20180103142001_initial_schema.sql#L1)

## 2) Runtime flow (client → Nakama → DB)

### Request flow diagram (RPC)

Client (Unity/Unreal/Web) 
  → HTTP POST /v2/rpc/<id> or gRPC
  → API gateway in Nakama
  → Auth + session validation
  → Runtime RPC function dispatch
  → Storage/DB + other services
  → Response back to client

Concrete flow in this repo:

1) Client makes an HTTP or gRPC call.
2) HTTP RPC goes through `RpcFuncHttp` in `server/api_rpc.go`.
   - Auth token or HTTP key is validated.
   - The RPC id is resolved to a runtime function.
   - The payload is parsed and passed to the runtime.
3) Runtime dispatch uses `InitModule` registrations in `data/modules/index.js`.
4) Runtime code uses `nk.*` APIs to read/write storage, create leaderboards, manage friends, etc.
5) Storage maps to Postgres/Cockroach via Nakama core tables + storage objects.

### Request flow diagram (real-time)

Client (Unity/Unreal/Web)
  → WebSocket /ws
  → Nakama socket runtime
  → Matchmaker / matches / streams
  → DB writes for durable state
  → Realtime events back to client

WebSocket entrypoint:
- [server/api.go](server/api.go#L95)

## 3) What runs server-side vs client-side

Server-side:
- Authentication and session verification.
- RPC handlers registered in `InitModule` inside [data/modules/index.js](data/modules/index.js#L17950).
- Storage reads/writes to Nakama’s `storage` collection and built-in tables.
- Leaderboards, wallet ledger, notifications, groups, social graph, and game registry.

Client-side (Unity developer view):
- You call RPCs via the Nakama client SDK.
- You handle UI updates, game logic, and local caching.
- You do not store authoritative state in the client; you request it from server.

## 4) Why each backend concept exists (Unity analogies)

- Auth/session: prevents client spoofing. Think of it like a server-authoritative MultiplayerManager.
- Storage: persistent save data. Similar to ScriptableObjects, but stored in DB.
- Leaderboards: time-windowed ranking. Similar to a global ScoreManager.
- Wallet/ledger: authoritative currency store. Think of it as server-side EconomyManager.
- Friends/groups: social graph. Equivalent to a social subsystem, but server owned.
- Matchmaker: pairs players and creates match state. Similar to Matchmaking services in Unity.
- Notifications: async messages. Think of it as server-side event bus + push service.

## 5) Data model foundations

The foundational schema is Nakama’s standard tables:

- Users + devices: `users`, `user_device`
- Social graph: `user_edge`
- Storage: `storage` (JSONB objects with permissions)
- Leaderboards: `leaderboard`, `leaderboard_record`
- Wallet ledger: `wallet_ledger`
- Groups: `groups`, `group_edge`

Schema reference:
- [migrate/sql/20180103142001_initial_schema.sql](migrate/sql/20180103142001_initial_schema.sql#L1)

## 6) Runtime modules (current implementation)

A large monolithic JavaScript file contains most runtime logic:
- [data/modules/index.js](data/modules/index.js#L1)

It registers RPCs for:
- Identity and player metadata
- Multi-game wallets
- Leaderboards and time-period leaderboards
- Daily rewards and missions
- Quiz results + daily completion
- Friends, groups, push notifications
- Analytics and onboarding

This file is effectively the server-side gameplay layer.

## 7) Why this architecture exists

Nakama provides:
- Authentication, realtime sockets, storage, and multiplayer primitives.
- A runtime engine (JS/Lua/Go) to run custom game logic.

This repository wraps that into a multi-game backend platform so multiple games can share:
- Identity
- Economy
- Social systems
- Leaderboards
- Analytics

It is a good base for a single source of truth across Unity, Unreal, and web clients.

## 8) Summary for a Unity developer

- You call RPCs and built-in Nakama APIs.
- Nakama validates auth, then calls server-side JS logic.
- JS logic writes to storage tables and returns responses.
- The DB is the source of truth; your client is never authoritative.

If you want to think like a backend engineer, treat the server as the gameplay authority and treat the client as a UI + input source only.
