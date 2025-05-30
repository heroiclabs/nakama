/*
 * Copyright 2018 The Nakama Authors
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
ALTER TABLE leaderboard
    ADD COLUMN category      INT          NOT NULL DEFAULT 0;
ALTER TABLE leaderboard
    ADD COLUMN description   VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE leaderboard
    ADD COLUMN duration      INT          NOT NULL DEFAULT 0; -- in seconds.
ALTER TABLE leaderboard
    ADD COLUMN end_time      TIMESTAMPTZ  NOT NULL DEFAULT '1970-01-01 00:00:00 UTC';
ALTER TABLE leaderboard
    ADD COLUMN join_required BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE leaderboard
    ADD COLUMN max_size      INT          NOT NULL DEFAULT 100000000;
ALTER TABLE leaderboard
    ADD COLUMN max_num_score INT          NOT NULL DEFAULT 1000000; -- max allowed score attempts.
ALTER TABLE leaderboard
    ADD COLUMN title         VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE leaderboard
    ADD COLUMN size          INT          NOT NULL DEFAULT 0;
ALTER TABLE leaderboard
    ADD COLUMN start_time    TIMESTAMPTZ  NOT NULL DEFAULT now();

ALTER TABLE leaderboard_record
    ADD COLUMN max_num_score INT NOT NULL DEFAULT 1000000;

CREATE INDEX IF NOT EXISTS duration_start_time_end_time_category_idx
    ON leaderboard (duration, start_time, end_time DESC, category);
CREATE INDEX IF NOT EXISTS owner_id_expiry_time_leaderboard_id_idx
    ON leaderboard_record (owner_id, expiry_time, leaderboard_id);

-- +migrate Down
DROP INDEX IF EXISTS duration_start_time_end_time_category_idx;
DROP INDEX IF EXISTS owner_id_expiry_time_leaderboard_id_idx;

ALTER TABLE IF EXISTS leaderboard_record
    DROP COLUMN IF EXISTS max_num_score;

ALTER TABLE IF EXISTS leaderboard
    DROP COLUMN IF EXISTS "category",
    DROP COLUMN IF EXISTS description,
    DROP COLUMN IF EXISTS duration,
    DROP COLUMN IF EXISTS end_time,
    DROP COLUMN IF EXISTS join_required,
    DROP COLUMN IF EXISTS max_size,
    DROP COLUMN IF EXISTS max_num_score,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS size,
    DROP COLUMN IF EXISTS start_time;
