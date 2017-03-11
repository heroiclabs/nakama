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
    FOREIGN KEY (next_id) REFERENCES leaderboard(id) ON DELETE SET DEFAULT,
    FOREIGN KEY (prev_id) REFERENCES leaderboard(id) ON DELETE SET DEFAULT,
    id             BYTEA        NOT NULL,
    authoritative  BOOLEAN      DEFAULT FALSE,
    sort_order     SMALLINT     DEFAULT 1 NOT NULL, -- asc(0), desc(1)
    count          BIGINT       DEFAULT 0 CHECK (count >= 0) NOT NULL,
    score_delta    INT          DEFAULT 0 CHECK (score_delta >= 0) NOT NULL,
    reset_schedule VARCHAR(64), -- e.g. cron format: "* * * * * * *"
    metadata       BYTEA        DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    next_id        BYTEA        DEFAULT NULL CHECK (next_id <> id),
    prev_id        BYTEA        DEFAULT NULL CHECK (prev_id <> id)
);

CREATE TABLE IF NOT EXISTS leaderboard_record (
    PRIMARY KEY (leaderboard_id, owner_id, expires_at),
    FOREIGN KEY (leaderboard_id) REFERENCES leaderboard(id) ON DELETE CASCADE,
    leaderboard_id BYTEA        NOT NULL,
    owner_id       BYTEA        NOT NULL,
    handle         VARCHAR(20)  NOT NULL,
    lang           VARCHAR(18)  DEFAULT 'en' NOT NULL,
    location       VARCHAR(64), -- e.g. "San Francisco, CA"
    timezone       VARCHAR(64), -- e.g. "Pacific Time (US & Canada)"
    rank_value     BIGINT       DEFAULT 0 CHECK (rank_value >= 0) NOT NULL, -- TODO maybe rename?
    score          BIGINT       DEFAULT 0 NOT NULL,
    num_score      INT          DEFAULT 0 CHECK (num_score >= 0) NOT NULL,
    -- FIXME replace with JSONB
    metadata       BYTEA        DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    ranked_at      INT          CHECK (ranked_at >= 0) DEFAULT 0 NOT NULL,
    -- TODO do we need updated_at_inverse ?
    updated_at     INT          CHECK (created_at > 0) NOT NULL,
    expires_at     INT          CHECK (expires_at >= 0) DEFAULT 0 NOT NULL,
    banned_at      INT          CHECK (expires_at >= 0) DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_id_idx ON leaderboard_record (leaderboard_id); -- TODO make multi-column

-- +migrate Down
DROP TABLE IF EXISTS leaderboard_record;
DROP TABLE IF EXISTS leaderboard;
