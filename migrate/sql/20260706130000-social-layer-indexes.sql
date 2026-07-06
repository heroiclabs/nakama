/*
 * Social layer indexes — 2026-07-06
 * (WORLD_CLASS_SOCIAL_FRIENDS_GROUPS_ARCHITECTURE.md §19.7)
 *
 * Every raw-SQL read path introduced by the social layer ships with its
 * index here, in the same migration that unblocks the querying RPC:
 *   - friends feed        (src/social/friends_feed.ts)      — storage by
 *     user_id + create_time within one collection
 *   - social proof        (src/social/engagement_extras.ts) — same shape
 *   - group search        (src/social/group_search.ts)      — groups by
 *     metadata gameId + popularity
 *   - maintenance sweeps  (src/social/maintenance.ts)       — storage by
 *     collection + update_time
 *   - expiry-warning scan (maintenance)                     — async
 *     challenges by JSON expiresAt
 *
 * CockroachDB: partial + expression indexes are supported; CREATE INDEX IF
 * NOT EXISTS makes this migration re-runnable.
 */

-- +migrate Up

-- Friends feed / social proof: page a set of authors' events newest-first.
CREATE INDEX IF NOT EXISTS idx_storage_feed_events
    ON storage (user_id, create_time DESC)
    WHERE collection = 'ivx_friends_feed_events';

-- Group discovery: filter by app, order by popularity.
CREATE INDEX IF NOT EXISTS idx_groups_gameid_popularity
    ON groups ((metadata->>'gameId'), edge_count DESC);

-- Maintenance sweeps: DELETE ... WHERE collection = $x AND update_time < $y.
CREATE INDEX IF NOT EXISTS idx_storage_collection_updated
    ON storage (collection, update_time);

-- Async-challenge expiry-warning scan (status + JSON expiresAt window).
CREATE INDEX IF NOT EXISTS idx_storage_async_challenge_expiry
    ON storage ((value->>'expiresAt'))
    WHERE collection = 'async_challenges';

-- +migrate Down
DROP INDEX IF EXISTS idx_storage_feed_events;
DROP INDEX IF EXISTS idx_groups_gameid_popularity;
DROP INDEX IF EXISTS idx_storage_collection_updated;
DROP INDEX IF EXISTS idx_storage_async_challenge_expiry;
