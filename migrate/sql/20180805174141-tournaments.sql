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

-- NOTE: This migration manually commits in separate transactions to ensure
-- the schema updates are sequenced because cockroachdb does not support
-- adding CHECK constraints via "ALTER TABLE ... ADD COLUMN" statements.

-- +migrate Up notransaction
BEGIN;
ALTER TABLE leaderboard
  ADD COLUMN category      SMALLINT     DEFAULT 0 NOT NULL,
  ADD COLUMN description   VARCHAR(255) DEFAULT '' NOT NULL,
  ADD COLUMN duration      INT          DEFAULT 0 NOT NULL, -- in seconds.
  ADD COLUMN end_time      TIMESTAMPTZ,
  ADD COLUMN join_required BOOLEAN      DEFAULT FALSE NOT NULL,
  ADD COLUMN max_size      INT          DEFAULT 100000000 NOT NULL,
  ADD COLUMN max_num_score INT          DEFAULT 1000000 NOT NULL, -- max allowed score attempts.
  ADD COLUMN title         VARCHAR(255) DEFAULT '' NOT NULL,
  ADD COLUMN size          INT          DEFAULT 0 NOT NULL,
  ADD COLUMN start_time    TIMESTAMPTZ  DEFAULT now() NOT NULL;

ALTER TABLE leaderboard_record
  ADD COLUMN max_num_score INT DEFAULT 1000000 NOT NULL;
COMMIT;

BEGIN;
ALTER TABLE leaderboard
  ADD CONSTRAINT check_category CHECK (category >= 0),
  ADD CONSTRAINT check_duration CHECK (duration >= 0),
  ADD CONSTRAINT check_max_size CHECK (max_size > 0),
  ADD CONSTRAINT check_max_num_score CHECK (max_num_score > 0),
  VALIDATE CONSTRAINT check_category,
  VALIDATE CONSTRAINT check_duration,
  VALIDATE CONSTRAINT check_max_size,
  VALIDATE CONSTRAINT check_max_num_score;

ALTER TABLE leaderboard_record
  ADD CONSTRAINT check_max_num_score CHECK (max_num_score > 0),
  VALIDATE CONSTRAINT check_max_num_score;
COMMIT;

-- +migrate Down
ALTER TABLE IF EXISTS leaderboard
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS duration,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS join_required,
  DROP COLUMN IF EXISTS max_size,
  DROP COLUMN IF EXISTS max_num_score,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS size,
  DROP COLUMN IF EXISTS start_time;

ALTER TABLE IF EXISTS leaderboard_record
  DROP COLUMN IF EXISTS max_num_score;
