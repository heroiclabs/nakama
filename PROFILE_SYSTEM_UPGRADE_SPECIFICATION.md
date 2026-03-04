# Profile System Upgrade Specification

**Version:** 1.0 | **Date:** 2025-02-27 | **Status:** Implemented

---

## ✅ Backend Patch (Minimal Code Additions Only)

### 1. `rpc_update_player_metadata` Enhancement

**File:** `data/modules/index.js`

**Changes:**
- Added `display_name`, `avatar_url` to `MAX_STRING_LENGTHS`
- Added `display_name` to `sanitizeMetadataPayload` identity fields
- Added `avatar_url` sanitization (HTTP/HTTPS URL validation, max 2048 chars)
- Added `syncMetadataToNakamaAccount()` helper
- Call `syncMetadataToNakamaAccount()` after storage write (Step 10b)

**Sync logic:** After metadata storage write, sync `display_name`, `avatar_url`, `timezone`, `location` (formatted), `langTag` (locale) to Nakama native account via `nk.accountUpdateId()`. Username is NOT updated here—only via `rpc_change_username`.

**Fallback chain for display_name:**
1. `display_name` (if set)
2. `firstName + " " + lastName` (trimmed)
3. `nakama_username` (from context)

---

### 2. `rpc_change_username` RPC (New)

**File:** `data/modules/index.js`

**Constants:**
- `USERNAME_MIN_LEN = 3`
- `USERNAME_MAX_LEN = 20`
- `USERNAME_REGEX = /^[a-zA-Z0-9_]+$/`
- `RESERVED_USERNAMES`: admin, system, nakama, root, moderator, support, null, undefined, guest, anonymous, intelliversex, intelliverse

**Flow:**
1. Parse payload `{ new_username }` or `{ newUsername }`
2. Validate length (3–20), regex (alphanumeric + underscore), reserved list
3. Normalize to lowercase for case-insensitive uniqueness
4. `nk.usersGetUsername([normalized])`—if found and `existing.id !== userId` → `USERNAME_TAKEN`
5. If same user → idempotent success (username unchanged)
6. `nk.accountUpdateId(userId, normalized, null, null, null, null, null, null)`
7. Update `player_metadata` storage: set `username`, `nakama_username`, `updated_at`
8. Return `{ success: true, username: normalized, request_id }`

**Error codes:**
- `AUTH_REQUIRED` — Not authenticated
- `INVALID_JSON` — Payload parse failure
- `USERNAME_INVALID` — Empty, invalid chars, or failed regex
- `USERNAME_TOO_SHORT` — &lt; 3 chars
- `USERNAME_TOO_LONG` — &gt; 20 chars
- `USERNAME_RESERVED` — Reserved keyword
- `USERNAME_TAKEN` — Already taken by another user
- `UPDATE_FAILED` — accountUpdateId or storage error

---

## ✅ Username RPC (Production Version)

**RPC ID:** `rpc_change_username`  
**Payload:** `{ "new_username": "string" }` or `{ "newUsername": "string" }`  
**Response (success):** `{ "success": true, "username": "normalized", "request_id": "..." }`  
**Response (failure):** `{ "success": false, "error": "...", "error_code": "...", "request_id": "..." }`

---

## ✅ Unity SDK Patch

**File:** `Assets/_IntelliVerseXSDK/V2/Manager/IVXNProfileManager.cs`

**Changes:**
1. **Validation alignment:** Username 3–20 chars, regex `^[a-zA-Z0-9_]{3,20}$` (removed hyphen)
2. **Reserved usernames:** Client-side check mirrors server list
3. **UpdateUsernameAsync:** Alias for `ChangeUsernameAsync`
4. **ChangeUsernameLock:** `SemaphoreSlim(1,1)` prevents concurrent username change calls
5. **UpdateProfileLock:** `SemaphoreSlim(1,1)` prevents concurrent profile update calls
6. **Cache invalidation:** Snapshot updated in lock after success; `RaiseUsernameChanged` / `RaiseProfileUpdated` emit events

---

## ✅ Validation Rules (Client + Server)

| Rule | Client (Unity) | Server (Nakama) |
|------|----------------|-----------------|
| Username length | 3–20 | 3–20 |
| Username chars | `[a-zA-Z0-9_]` | `[a-zA-Z0-9_]` |
| Reserved | Same list | Same list |
| Display name | 2–50, SafeNamePattern | 50 max (identity field) |
| Avatar URL | HTTP/HTTPS, URI validation | HTTP/HTTPS prefix check |

---

## ✅ Concurrency Strategy

1. **Username change:** `ChangeUsernameLock` serializes all `ChangeUsernameAsync` calls. Second caller waits; no duplicate in-flight.
2. **Profile update:** `UpdateProfileLock` serializes all `UpdateProfileAsync` calls.
3. **Server:** `rpc_change_username` uses `usersGetUsername` + `accountUpdateId` + storage write in sequence. No transaction; failure after account update is logged—metadata may be stale until next update. Mitigation: metadata write uses `version` from read for optimistic concurrency.
4. **Race (two users, same username):** First `accountUpdateId` wins; second fails with unique constraint. Nakama DB enforces uniqueness. Error surfaced as `UPDATE_FAILED` or `USERNAME_TAKEN` depending on error message parsing.

---

## ✅ Edge Case Handling

| Edge Case | Handling |
|-----------|----------|
| Simultaneous username update | DB unique constraint; second fails |
| Same username, different casing | Normalized to lowercase; `usersGetUsername([normalized])` catches |
| Metadata/account mismatch | Sync runs after every metadata write; mismatch temporary |
| Partial failure after account update | Metadata write may fail; next profile fetch/update repairs |
| Network interruption after server update | Client retry; server idempotent |
| Old client, outdated RPC | `rpc_change_username` is new; old clients use `rpc_update_player_metadata` only (no username change) |
| Device → email auth upgrade | No schema change; metadata stays compatible |
| Cross-game account sharing | Same `player_metadata` collection; works across games |
| Reserved usernames | Server + client validation |
| Unicode / injection | Regex + sanitize; no raw SQL |
| Empty payload | Rejected with `INVALID_JSON` / `USERNAME_INVALID` |
| Overposting (extra JSON) | Sanitize only known fields; unknown ignored |
| Invalid avatar URL | Rejected at sanitization |
| Rate limit | Existing 5s minimum interval; no new limit |
| Replay | Session-bound; requires valid auth |

---

## ✅ Migration Safety Notes

- **No storage schema change:** Uses existing `player_metadata` collection and `user_identity` key
- **Backward compatible:** `rpc_update_player_metadata` still accepts same payload; new fields optional
- **Display name:** New field; fallback to `firstName + lastName` or `username` if missing
- **Avatar sync:** New; existing avatars in metadata will sync on next update
- **Username:** Change only via `rpc_change_username`; existing usernames unchanged until explicit change

---

## ✅ Testing Checklist (Production Ready)

- [ ] Change username: valid, invalid, reserved, taken, same-as-current
- [ ] Profile update: display_name, avatar_url, location, locale
- [ ] Verify Nakama account: display_name, avatar_url, location, lang_tag after sync
- [ ] Leaderboard / friends: avatar and display name visible
- [ ] Concurrent ChangeUsernameAsync: serialized, no corruption
- [ ] Concurrent UpdateProfileAsync: serialized
- [ ] Client validation: reserved, length, regex before RPC
- [ ] Network failure / retry: idempotent, no double-update
- [ ] Cross-device: same user, different device, profile consistent
- [ ] Cross-game: same backend, different game, profile consistent

---

## ✅ Deployment Safety Steps

1. Deploy Nakama modules (index.js) to runtime
2. Restart Nakama (or hot-reload if supported)
3. Verify RPC registration: `rpc_change_username` in logs
4. Deploy Unity SDK (IVXNProfileManager.cs) to consumers
5. Smoke test: change username, update profile, verify account sync
6. Monitor logs for `[ChangeUsername:...]` and `[PlayerMetadata:...] Synced to Nakama account`

---

## ✅ Why This Is Architecturally Safe

1. **Minimal surface:** Only targeted additions; no full rewrite
2. **Idempotent:** Same inputs produce same outcome; safe to retry
3. **Single source of truth:** Metadata in storage; account sync is derived view
4. **Explicit username flow:** Username only via `rpc_change_username`; no accidental overwrite in profile update
5. **Client/server parity:** Validation aligned; fewer invalid RPCs
6. **Serialization:** Locks prevent concurrent mutation races in Unity
7. **Backward compatible:** Old clients and payloads still work
8. **Observable:** Request IDs, structured errors, logging for debugging
