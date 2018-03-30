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
CREATE TABLE IF NOT EXISTS users (
    PRIMARY KEY (id),

    id            UUID          NOT NULL,
    username      VARCHAR(128)  CONSTRAINT users_username_key UNIQUE NOT NULL,
    display_name  VARCHAR(255),
    avatar_url    VARCHAR(255),
    -- https://tools.ietf.org/html/bcp47
    lang_tag      VARCHAR(18)   DEFAULT 'en',
    location      VARCHAR(255), -- e.g. "San Francisco, CA"
    timezone      VARCHAR(255), -- e.g. "Pacific Time (US & Canada)"
    metadata      JSONB         DEFAULT '{}' NOT NULL,
    wallet        JSONB         DEFAULT '{}' NOT NULL,
    email         VARCHAR(255)  UNIQUE,
    password      BYTEA         CHECK (length(password) < 32000),
    facebook_id   VARCHAR(128)  UNIQUE,
    google_id     VARCHAR(128)  UNIQUE,
    gamecenter_id VARCHAR(128)  UNIQUE,
    steam_id      VARCHAR(128)  UNIQUE,
    custom_id     VARCHAR(128)  UNIQUE,
    edge_count    INT           DEFAULT 0 CHECK (edge_count >= 0) NOT NULL,
    create_time   TIMESTAMPTZ   DEFAULT now() NOT NULL,
    update_time   TIMESTAMPTZ   DEFAULT now() NOT NULL,
    verify_time   TIMESTAMPTZ   DEFAULT CAST(0 AS TIMESTAMPTZ) NOT NULL,
    disable_time  TIMESTAMPTZ   DEFAULT CAST(0 AS TIMESTAMPTZ) NOT NULL
);

-- Setup System user.
INSERT INTO users (id, username)
    VALUES ('00000000-0000-0000-0000-000000000000', '')
    ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_device (
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    id          VARCHAR(128)    NOT NULL,
    user_id     UUID            NOT NULL
);

CREATE TABLE IF NOT EXISTS user_edge (
    PRIMARY KEY (source_id, state, position),
    FOREIGN KEY (source_id)      REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (destination_id) REFERENCES users (id) ON DELETE CASCADE,

    source_id      UUID         NOT NULL,
    position       BIGINT       NOT NULL, -- Used for sort order on rows.
    update_time    TIMESTAMPTZ  DEFAULT now() NOT NULL,
    destination_id UUID         NOT NULL,
    state          SMALLINT     DEFAULT 0 NOT NULL, -- friend(0), invite(1), invited(2), blocked(3), deleted(4), archived(5)

    UNIQUE (source_id, destination_id)
);

CREATE TABLE IF NOT EXISTS notification (
    -- FIXME: cockroach's analyser is not clever enough when create_time has DESC mode on the index.
    PRIMARY KEY (user_id, create_time, id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    id          UUID            CONSTRAINT notification_id_key UNIQUE NOT NULL,
    user_id     UUID            NOT NULL,
    subject     VARCHAR(255)    NOT NULL,
    content     JSONB           DEFAULT '{}' NOT NULL,
    code        SMALLINT        NOT NULL, -- Negative values are system reserved.
    sender_id   UUID            NOT NULL,
    create_time TIMESTAMPTZ     DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS storage (
    PRIMARY KEY (collection, read, key, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    collection  VARCHAR(128)    NOT NULL,
    key         VARCHAR(128)    NOT NULL,
    user_id     UUID            NOT NULL,
    value       JSONB           DEFAULT '{}' NOT NULL,
    version     VARCHAR(32)     NOT NULL, -- md5 hash of value object.
    read        SMALLINT        DEFAULT 1 CHECK (read >= 0) NOT NULL,
    write       SMALLINT        DEFAULT 1 CHECK (write >= 0) NOT NULL,
    create_time TIMESTAMPTZ     DEFAULT now() NOT NULL,
    update_time TIMESTAMPTZ     DEFAULT now() NOT NULL,

    UNIQUE (collection, key, user_id)
);
CREATE INDEX IF NOT EXISTS collection_read_user_id_key_idx ON storage (collection, read, user_id, key);

CREATE TABLE IF NOT EXISTS message (
  PRIMARY KEY (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id),
  FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (reference_id) REFERENCES message (id) ON DELETE CASCADE,

  id                UUID         UNIQUE NOT NULL,
  -- chat(0), chat_update(1), group_join(2), group_add(3), group_leave(4), group_kick(5), group_promoted(6)
  code              SMALLINT     DEFAULT 0 NOT NULL,
  sender_id         UUID         NOT NULL,
  username          VARCHAR(128) NOT NULL,
  stream_mode       SMALLINT     NOT NULL,
  stream_subject    UUID         NOT NULL,
  stream_descriptor UUID         NOT NULL,
  stream_label      VARCHAR(128) NOT NULL,
  content           JSONB        DEFAULT '{}' NOT NULL,
  reference_id      UUID,
  create_time       TIMESTAMPTZ  DEFAULT now() NOT NULL,
  update_time       TIMESTAMPTZ  DEFAULT now() NOT NULL,

  UNIQUE (sender_id, id)
);

CREATE TABLE IF NOT EXISTS leaderboard (
  PRIMARY KEY (id),

  id             VARCHAR(128) NOT NULL,
  authoritative  BOOLEAN      DEFAULT FALSE,
  cached_count   BIGINT       DEFAULT 0 CHECK (cached_count >= 0) NOT NULL,
  sort_order     SMALLINT     DEFAULT 1 NOT NULL, -- asc(0), desc(1)
  reset_schedule VARCHAR(64), -- e.g. cron format: "* * * * * * *"
  metadata       JSONB        DEFAULT '{}' NOT NULL,
  create_time    TIMESTAMPTZ  DEFAULT now() NOT NULL,
  update_time    TIMESTAMPTZ  DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_record (
  PRIMARY KEY (leaderboard_id, expiry_time, score, subscore, owner_id),
  FOREIGN KEY (leaderboard_id) REFERENCES leaderboard (id) ON DELETE CASCADE,

  leaderboard_id VARCHAR(128) NOT NULL,
  owner_id       UUID         NOT NULL,
  username       VARCHAR(128),
  score          BIGINT       DEFAULT 0 CHECK (score >= 0) NOT NULL,
  subscore       BIGINT       DEFAULT 0 CHECK (subscore >= 0) NOT NULL,
  rank_value     BIGINT       DEFAULT 0 CHECK (rank_value >= 0) NOT NULL,
  num_score      INT          DEFAULT 0 CHECK (num_score >= 0) NOT NULL,
  metadata       JSONB        DEFAULT '{}' NOT NULL,
  create_time    TIMESTAMPTZ  DEFAULT now() NOT NULL,
  update_time    TIMESTAMPTZ  DEFAULT now() NOT NULL,
  expiry_time    TIMESTAMPTZ  DEFAULT CAST(0 AS TIMESTAMPTZ) NOT NULL,
  rank_time      TIMESTAMPTZ  DEFAULT CAST(0 AS TIMESTAMPTZ) NOT NULL,

  UNIQUE (owner_id, leaderboard_id, expiry_time)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  PRIMARY KEY (user_id, create_time, id),
  FOREIGN KEY (user_id) REFERENCES users (id),

  id             UUID        UNIQUE NOT NULL,
  user_id        UUID        NOT NULL,
  changeset      JSONB       NOT NULL,
  metadata       JSONB       NOT NULL,
  create_time    TIMESTAMPTZ DEFAULT now() NOT NULL,
  update_time    TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- +migrate Down
DROP TABLE IF EXISTS wallet_ledger;
DROP TABLE IF EXISTS leaderboard_record;
DROP TABLE IF EXISTS leaderboard;
DROP TABLE IF EXISTS message;
DROP TABLE IF EXISTS storage;
DROP TABLE IF EXISTS notification;
DROP TABLE IF EXISTS user_edge;
DROP TABLE IF EXISTS user_device;
DROP TABLE IF EXISTS users;
