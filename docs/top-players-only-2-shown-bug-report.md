# Bug Report: Admin Dashboard Shows Only 2 Players Instead of All Active Players

**Date:** 2026-06-06  
**Severity:** High  
**Affected Feature:** Players Tab (`analytics_top_players` RPC)  
**Symptom:** Admin opens the Players tab on the dashboard and sees only 2 players, even though 10+ players are actively sending events.

---

## Plain-English Summary

The Players tab is supposed to show every active user. Right now it shows only 2 because **the nightly rollup job has never run** (or ran only once, a long time ago). The dashboard's fast path is to read pre-built summary files that the rollup job is supposed to create every night. Because those files don't exist for most days, the dashboard falls back to a limited emergency scan that reads only the first ~5,000 raw event documents out of 578,000+ and finds just 2 users.

---

## How It's Supposed to Work (The Happy Path)

```
Every night (1 AM UTC)
  └─► analytics_rollup_run RPC runs
        └─► Scans all events for that day
              └─► Writes "top_players_<gameId>_<date>" docs
                    └─► analytics_top_players RPC reads those docs
                          └─► Dashboard shows ALL players ✅
```

The rollup job writes one compact summary file per day called `top_players_<gameId>_<YYYY-MM-DD>`. The `analytics_top_players` RPC loops over the last N days, reads those files, and combines them. **No expensive scanning needed — it's just N fast reads.**

---

## What Is Actually Happening (The Broken Path)

```
Rollup job NOT running (or timing out)
  └─► No "top_players_*" daily docs exist
        └─► analytics_top_players RPC finds 0 rollup docs
              └─► Falls back to extScanEventsCapped()
                    └─► Scans only the FIRST 25 pages × 200 = 5,000 raw event docs
                          └─► With 578,000+ docs in storage, this is < 1% of events
                                └─► Only finds 2 user IDs in those 5,000 docs ❌
```

---

## Root Cause: The Rollup Job is Not Running

### Cause 1 — No Automatic Cron in the Code

There is **zero** `registerCron()` call anywhere in the JavaScript backend. The rollup is **never triggered automatically** by Nakama. It relies on an **external Docker sidecar** container to call the `analytics_rollup_run` RPC every night.

> From the technical document: *"There are NO registerCron() calls anywhere in the JS runtime. The rollup is triggered by an external Docker sidecar (or K8s CronJob). If the sidecar is not running, the rollup NEVER executes."*

**If that Docker sidecar is stopped, crashed, or was never deployed → rollup never runs → top_players files never get created.**

### Cause 2 — Even If Rollup Ran, It May Be Timing Out

The rollup scans all 578,000+ raw event documents in `analytics_events` collection to find events for a specific date. Nakama RPCs have a **30-second timeout**. With that many documents, the full-table scan may hit the timeout before it finishes, producing **zero results** even when the sidecar calls it.

> From the technical document: *"With 500K+ event docs across all dates, this takes many minutes and may timeout (30s Nakama RPC limit)."*

### Cause 3 — The Fallback Scan is Severely Limited on Purpose

When no rollup docs exist, the code falls back to `extScanEventsCapped()` with `maxPages = 25`. This means it reads at most `25 × 200 = 5,000` raw documents. Since `nk.storageList()` does **not** sort by date — it returns documents in an arbitrary (likely alphabetical by key) order — those 5,000 documents may not contain most of your active players.

```javascript
// analytics_extended.js line 2249
var fallbackEvents = extScanEventsCapped(nk, logger, 'analytics_events', days, gameId, 25);
//                                                                                       ^^^
//                           25 pages × 200 docs = 5,000 docs MAX out of 578,117 total
```

---

## Evidence From Storage Screenshot

The screenshot you shared shows `578,117` objects in `game_player_analytics`. Each player has at least 2 documents (one for themselves, one SYSTEM mirror). That means there are roughly **289,000 players** tracked. The fallback scan reading only 5,000 documents from 578,000+ will find almost no one.

---

## Why Does Individual Player View Work Fine?

When you click on a specific user (e.g., `0043039d-...`), the dashboard calls `qe_player_full_profile` which does a **direct key lookup** in `game_player_analytics` using the exact user ID as the key (`{gameId}:{userId}`). This is a single fast read — no scanning needed — so it always works and returns all the events, scores, and analytics data for that one player. ✅

**The Players tab listing is broken. Individual player profiles are fine.**

---

## Step-by-Step Verification

Follow these steps in your browser console (open the dashboard first so `callRpc` is available):

### Step 1: Check if rollup has ever run
```javascript
callRpc('analytics_rollup_status', {}).then(console.log)
```
Expected healthy output: `{ lastSuccess: { date: "2026-06-05", ... } }`  
**Broken output you'll likely see:** `{ lastSuccess: null }` or `"No successful rollup recorded yet"`

### Step 2: Check if top_players daily docs exist in storage
Go to Nakama Console → **Storage** → collection `analytics_top_players_daily`  
- If the collection is **empty or missing** → the rollup has never written top_player docs → confirmed bug.

### Step 3: Check how many rollup docs exist at all
```javascript
callRpc('analytics_rollup_status', {}).then(d => console.log(d))
```

### Step 4: Check rollup_hits in the RPC response
```javascript
callRpc('analytics_top_players', { days: 7, limit: 250 }).then(d => {
    console.log('Rollup hits:', d.rollup_hits);  // Should be > 0
    console.log('Players returned:', d.players?.length);
    console.log('Total active:', d.total_active_users);
});
```
If `rollup_hits` is **0** → the fallback scan was used → confirms no rollup docs exist.

---

## Fixes

### Fix 1 (Immediate — Run the Rollup Manually Right Now)

Run the rollup for recent days to generate top_player docs immediately. Do this from browser console on the dashboard:

```javascript
// Run for yesterday
callRpc('analytics_rollup_run', {
    date: '2026-06-05',
    dashboard_secret: 'YOUR_DASHBOARD_SECRET_HERE'
}).then(console.log);
```

Repeat for `2026-06-04`, `2026-06-03`, etc. for as many days as you want. After this, the Players tab will show all players for those days.

> ⚠️ **Warning:** If you have 578k+ docs in `analytics_events`, the rollup scan may time out. See Fix 3 if that happens.

### Fix 2 (Permanent — Fix the Docker Sidecar)

Verify the `analytics_cron` Docker sidecar is running and healthy:

```bash
docker ps | grep analytics_cron
docker logs analytics_cron --tail 100
```

If it's not running, restart it. The sidecar should call `analytics_rollup_run` every night at 1 AM UTC.

### Fix 3 (If Rollup Times Out Due to Too Many Docs)

The `analytics_events` collection has grown huge (578k+ docs). The full-table scan times out. You need to either:

**Option A:** Archive or delete old `dash_*` event documents older than 30 days from the `analytics_events` collection.

**Option B:** Run the rollup for one date at a time (not multi-day) to reduce the scan load.

**Option C:** Once rollup docs exist and are fresh, the Players tab will use the fast path and won't need to scan events at all.

---

## Summary Table

| What | Status | Why |
|------|--------|-----|
| Raw events being saved | ✅ Working | 578k+ docs in `analytics_events` and `game_player_analytics` |
| Individual player profile | ✅ Working | Direct key lookup, no scanning needed |
| Rollup cron job | ❌ Not running | No `registerCron()` in code — needs external Docker sidecar |
| `top_players_*` daily docs | ❌ Missing | Rollup never ran, so these files were never created |
| Players tab listing | ❌ Broken | Fallback scan reads only 5,000 of 578,000+ docs |
| How many players shown | 2 | Fallback found only 2 user IDs in first 5,000 docs |
| Players actually active | 10+ | All their data is in storage, just not indexed |

---

## One-Line Explanation for the Team

> The Players tab finds users by reading nightly summary files. Those files are never created because the nightly rollup job's Docker container is not running. Without those files, the dashboard falls back to scanning the first 5,000 of 578,000+ raw event records — and finds only 2 users.
