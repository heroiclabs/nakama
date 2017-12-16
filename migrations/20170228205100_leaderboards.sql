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
CREATE TABLE IF NOT EXISTS leaderboard (
    PRIMARY KEY (id),
    id             BYTEA        NOT NULL,
    authoritative  BOOLEAN      DEFAULT FALSE,
    sort_order     SMALLINT     DEFAULT 1 NOT NULL, -- asc(0), desc(1)
    count          BIGINT       DEFAULT 0 CHECK (count >= 0) NOT NULL,
    reset_schedule VARCHAR(64), -- e.g. cron format: "* * * * * * *"
    metadata       BYTEA        DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_record (
    PRIMARY KEY (leaderboard_id, expires_at, owner_id),
    -- Creating a foreign key constraint and defining indexes that include it
    -- in the same transaction breaks. See issue cockroachdb/cockroach#13505.
    -- In this case we prefer the indexes over the constraint.
    -- FOREIGN KEY (leaderboard_id) REFERENCES leaderboard(id),
    id                 BYTEA         UNIQUE NOT NULL,
    leaderboard_id     BYTEA         NOT NULL,
    owner_id           BYTEA         NOT NULL,
    handle             VARCHAR(128)  NOT NULL,
    lang               VARCHAR(18)   DEFAULT 'en' NOT NULL,
    location           VARCHAR(255), -- e.g. "San Francisco, CA"
    timezone           VARCHAR(255), -- e.g. "Pacific Time (US & Canada)"
    rank_value         BIGINT        DEFAULT 0 CHECK (rank_value >= 0) NOT NULL,
    score              BIGINT        DEFAULT 0 NOT NULL,
    num_score          INT           DEFAULT 0 CHECK (num_score >= 0) NOT NULL,
    -- FIXME replace with JSONB
    metadata           BYTEA         DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    ranked_at          BIGINT        CHECK (ranked_at >= 0) DEFAULT 0 NOT NULL,
    updated_at         BIGINT        CHECK (updated_at > 0) NOT NULL,
    -- Used to enable proper order in revscan when sorting by score descending.
    -- Revscan is unaviodable here due to cockroachdb/cockroach#14241.
    updated_at_inverse BIGINT        CHECK (updated_at > 0) NOT NULL,
    expires_at         BIGINT        CHECK (expires_at >= 0) DEFAULT 0 NOT NULL,
    banned_at          BIGINT        CHECK (expires_at >= 0) DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_id_leaderboard_id_idx ON leaderboard_record (owner_id, leaderboard_id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_score_updated_at_inverse_id_idx ON leaderboard_record (leaderboard_id, expires_at, score, updated_at_inverse, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_score_updated_at_id_idx ON leaderboard_record (leaderboard_id, expires_at, score, updated_at, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_lang_score_updated_at_inverse_id_idx ON leaderboard_record (leaderboard_id, expires_at, lang, score, updated_at_inverse, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_lang_score_updated_at_id_idx ON leaderboard_record (leaderboard_id, expires_at, lang, score, updated_at, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_location_score_updated_at_inverse_id_idx ON leaderboard_record (leaderboard_id, expires_at, location, score, updated_at_inverse, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_location_score_updated_at_id_idx ON leaderboard_record (leaderboard_id, expires_at, location, score, updated_at, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_timezone_score_updated_at_inverse_id_idx ON leaderboard_record (leaderboard_id, expires_at, timezone, score, updated_at_inverse, id);
CREATE INDEX IF NOT EXISTS leaderboard_id_expires_at_timezone_score_updated_at_id_idx ON leaderboard_record (leaderboard_id, expires_at, timezone, score, updated_at, id);

-- +migrate Down
DROP TABLE IF EXISTS leaderboard_record;
DROP TABLE IF EXISTS leaderboard CASCADE;
