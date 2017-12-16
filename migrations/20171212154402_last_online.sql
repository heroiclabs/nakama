/*
 * Copyright 2017 The Nakama Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

-- +migrate Up
ALTER TABLE IF EXISTS leaderboard DROP CONSTRAINT IF EXISTS check_next_id_id;
ALTER TABLE IF EXISTS leaderboard DROP CONSTRAINT IF EXISTS fk_next_id_ref_leaderboard;
ALTER TABLE IF EXISTS leaderboard DROP CONSTRAINT IF EXISTS check_prev_id_id;
ALTER TABLE IF EXISTS leaderboard DROP CONSTRAINT IF EXISTS fk_prev_id_ref_leaderboard;

ALTER TABLE IF EXISTS leaderboard DROP COLUMN IF EXISTS next_id;
ALTER TABLE IF EXISTS leaderboard DROP COLUMN IF EXISTS prev_id;

ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS check_last_online_at;

ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS last_online_at;

ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS users ADD CONSTRAINT check_metadata CHECK (length(metadata) < 32000);

ALTER TABLE IF EXISTS groups DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS groups ADD CONSTRAINT check_metadata CHECK (length(metadata) < 32000);

ALTER TABLE IF EXISTS storage DROP CONSTRAINT IF EXISTS check_value;
ALTER TABLE IF EXISTS storage ADD CONSTRAINT check_value CHECK (length(value) < 32000);

ALTER TABLE IF EXISTS leaderboard_record DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS leaderboard_record ADD CONSTRAINT check_metadata CHECK (length(metadata) < 32000);

ALTER TABLE IF EXISTS notification DROP CONSTRAINT IF EXISTS check_content;
ALTER TABLE IF EXISTS notification ADD CONSTRAINT check_content CHECK (length(content) < 32000);

-- +migrate Down
ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS users ADD CONSTRAINT check_metadata CHECK (length(metadata) < 16000);

ALTER TABLE IF EXISTS groups DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS groups ADD CONSTRAINT check_metadata CHECK (length(metadata) < 16000);

ALTER TABLE IF EXISTS storage DROP CONSTRAINT IF EXISTS check_value;
ALTER TABLE IF EXISTS storage ADD CONSTRAINT check_value CHECK (length(value) < 16000);

ALTER TABLE IF EXISTS leaderboard_record DROP CONSTRAINT IF EXISTS check_metadata;
ALTER TABLE IF EXISTS leaderboard_record ADD CONSTRAINT check_metadata CHECK (length(metadata) < 16000);

ALTER TABLE IF EXISTS notification DROP CONSTRAINT IF EXISTS check_content;
ALTER TABLE IF EXISTS notification ADD CONSTRAINT check_content CHECK (length(content) < 16000);

ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS next_id BYTEA DEFAULT NULL::BYTEA;
ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS prev_id BYTEA DEFAULT NULL::BYTEA;

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_online_at BIGINT NOT NULL DEFAULT 0;

CREATE INDEX ON leaderboard (next_id);
CREATE INDEX ON leaderboard (prev_id);

-- FIXME cannot create constraints until newly added columns are committed, but that causes issues with the migration.
-- -- Commit so we can add constraints on the new columns.
-- COMMIT;
--
-- ALTER TABLE IF EXISTS leaderboard ADD CONSTRAINT fk_next_id_ref_leaderboard FOREIGN KEY (next_id) REFERENCES leaderboard(id);
-- ALTER TABLE IF EXISTS leaderboard ADD CONSTRAINT check_next_id_id CHECK (next_id <> id);
-- ALTER TABLE IF EXISTS leaderboard ADD CONSTRAINT fk_prev_id_ref_leaderboard FOREIGN KEY (prev_id) REFERENCES leaderboard(id);
-- ALTER TABLE IF EXISTS leaderboard ADD CONSTRAINT check_prev_id_id CHECK (prev_id <> id);

-- ALTER TABLE IF EXISTS users ADD CONSTRAINT check_last_online_at CHECK (last_online_at >= 0);
