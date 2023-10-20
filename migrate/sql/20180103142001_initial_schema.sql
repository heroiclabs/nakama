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
    username      VARCHAR(128)  NOT NULL CONSTRAINT users_username_key UNIQUE,
    display_name  VARCHAR(255),
    avatar_url    VARCHAR(512),
    -- https://tools.ietf.org/html/bcp47
    lang_tag      VARCHAR(18)   NOT NULL DEFAULT 'en',
    location      VARCHAR(255), -- e.g. "San Francisco, CA"
    timezone      VARCHAR(255), -- e.g. "Pacific Time (US & Canada)"
    metadata      JSONB         NOT NULL DEFAULT '{}',
    wallet        JSONB         NOT NULL DEFAULT '{}',
    email         VARCHAR(255)  UNIQUE,
    password      BYTEA         CHECK (length(password) < 32000),
    facebook_id   VARCHAR(128)  UNIQUE,
    google_id     VARCHAR(128)  UNIQUE,
    gamecenter_id VARCHAR(128)  UNIQUE,
    steam_id      VARCHAR(128)  UNIQUE,
    custom_id     VARCHAR(128)  UNIQUE,
    edge_count    INT           NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
    create_time   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    update_time   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    verify_time   TIMESTAMPTZ   NOT NULL DEFAULT '1970-01-01 00:00:00 UTC',
    disable_time  TIMESTAMPTZ   NOT NULL DEFAULT '1970-01-01 00:00:00 UTC'
);

-- Setup System user.
INSERT INTO users (id, username)
    VALUES ('00000000-0000-0000-0000-000000000000', '')
    ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_device (
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    id      VARCHAR(128) NOT NULL,
    user_id UUID         NOT NULL,

    UNIQUE (user_id, id)
);

CREATE TABLE IF NOT EXISTS user_edge (
    PRIMARY KEY (source_id, state, position),
    FOREIGN KEY (source_id)      REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (destination_id) REFERENCES users (id) ON DELETE CASCADE,

    source_id      UUID        NOT NULL CHECK (source_id <> '00000000-0000-0000-0000-000000000000'),
    position       BIGINT      NOT NULL, -- Used for sort order on rows.
    update_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    destination_id UUID        NOT NULL CHECK (destination_id <> '00000000-0000-0000-0000-000000000000'),
    state          SMALLINT    NOT NULL DEFAULT 0, -- friend(0), invite_sent(1), invite_received(2), blocked(3)

    UNIQUE (source_id, destination_id)
);
CREATE INDEX IF NOT EXISTS user_edge_auto_index_fk_destination_id_ref_users ON user_edge (destination_id);

CREATE TABLE IF NOT EXISTS notification (
    -- FIXME: cockroach's analyser is not clever enough when create_time has DESC mode on the index.
    PRIMARY KEY (user_id, create_time, id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    id          UUID         NOT NULL CONSTRAINT notification_id_key UNIQUE,
    user_id     UUID         NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    content     JSONB        NOT NULL DEFAULT '{}',
    code        SMALLINT     NOT NULL, -- Negative values are system reserved.
    sender_id   UUID         NOT NULL,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage (
    PRIMARY KEY (collection, key, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    collection  VARCHAR(128) NOT NULL,
    key         VARCHAR(128) NOT NULL,
    user_id     UUID         NOT NULL,
    value       JSONB        NOT NULL DEFAULT '{}',
    version     VARCHAR(32)  NOT NULL, -- md5 hash of value object.
    read        SMALLINT     NOT NULL DEFAULT 1 CHECK (read >= 0),
    write       SMALLINT     NOT NULL DEFAULT 1 CHECK (write >= 0),
    create_time TIMESTAMPTZ  NOT NULL DEFAULT now(),
    update_time TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_read_user_id_key_idx ON storage (collection, read, user_id, key);
CREATE INDEX IF NOT EXISTS collection_read_key_user_id_idx ON storage (collection, read, key, user_id);
CREATE INDEX IF NOT EXISTS collection_user_id_read_key_idx ON storage (collection, user_id, read, key);
CREATE INDEX IF NOT EXISTS storage_auto_index_fk_user_id_ref_users ON storage (user_id);

CREATE TABLE IF NOT EXISTS message (
    PRIMARY KEY (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id),
    FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,

    id                UUID         NOT NULL UNIQUE,
    -- chat(0), chat_update(1), chat_remove(2), group_join(3), group_add(4), group_leave(5), group_kick(6), group_promoted(7)
    code              SMALLINT     NOT NULL DEFAULT 0,
    sender_id         UUID         NOT NULL,
    username          VARCHAR(128) NOT NULL,
    stream_mode       SMALLINT     NOT NULL,
    stream_subject    UUID         NOT NULL,
    stream_descriptor UUID         NOT NULL,
    stream_label      VARCHAR(128) NOT NULL,
    content           JSONB        NOT NULL DEFAULT '{}',
    create_time       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    update_time       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (sender_id, id)
);

CREATE TABLE IF NOT EXISTS leaderboard (
    PRIMARY KEY (id),

    id             VARCHAR(128) NOT NULL,
    authoritative  BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order     SMALLINT     NOT NULL DEFAULT 1, -- asc(0), desc(1)
    operator       SMALLINT     NOT NULL DEFAULT 0, -- best(0), set(1), increment(2), decrement(3)
    reset_schedule VARCHAR(64), -- e.g. cron format: "* * * * * * *"
    metadata       JSONB        NOT NULL DEFAULT '{}',
    create_time    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_record (
    PRIMARY KEY (leaderboard_id, expiry_time, score, subscore, owner_id),
    FOREIGN KEY (leaderboard_id) REFERENCES leaderboard (id) ON DELETE CASCADE,

    leaderboard_id VARCHAR(128)  NOT NULL,
    owner_id       UUID          NOT NULL,
    username       VARCHAR(128),
    score          BIGINT        NOT NULL DEFAULT 0 CHECK (score >= 0),
    subscore       BIGINT        NOT NULL DEFAULT 0 CHECK (subscore >= 0),
    num_score      INT           NOT NULL DEFAULT 1 CHECK (num_score >= 0),
    metadata       JSONB         NOT NULL DEFAULT '{}',
    create_time    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    update_time    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expiry_time    TIMESTAMPTZ   NOT NULL DEFAULT '1970-01-01 00:00:00 UTC',

    UNIQUE (owner_id, leaderboard_id, expiry_time)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
    PRIMARY KEY (user_id, create_time, id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    id          UUID        NOT NULL UNIQUE,
    user_id     UUID        NOT NULL,
    changeset   JSONB       NOT NULL,
    metadata    JSONB       NOT NULL,
    create_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    update_time TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_tombstone (
    PRIMARY KEY (create_time, user_id),

    user_id        UUID        NOT NULL UNIQUE,
    create_time    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
    PRIMARY KEY (disable_time, lang_tag, edge_count, id),

    id           UUID          NOT NULL UNIQUE,
    creator_id   UUID          NOT NULL,
    name         VARCHAR(255)  NOT NULL CONSTRAINT groups_name_key UNIQUE,
    description  VARCHAR(255),
    avatar_url   VARCHAR(512),
    -- https://tools.ietf.org/html/bcp47
    lang_tag     VARCHAR(18)   NOT NULL DEFAULT 'en',
    metadata     JSONB         NOT NULL DEFAULT '{}',
    state        SMALLINT      NOT NULL DEFAULT 0 CHECK (state >= 0), -- open(0), closed(1)
    edge_count   INT           NOT NULL DEFAULT 0 CHECK (edge_count >= 1 AND edge_count <= max_count),
    max_count    INT           NOT NULL DEFAULT 100 CHECK (max_count >= 1),
    create_time  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    update_time  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    disable_time TIMESTAMPTZ   NOT NULL DEFAULT '1970-01-01 00:00:00 UTC'
);
CREATE INDEX IF NOT EXISTS edge_count_update_time_id_idx ON groups (disable_time, edge_count, update_time, id);
CREATE INDEX IF NOT EXISTS update_time_edge_count_id_idx ON groups (disable_time, update_time, edge_count, id);

CREATE TABLE IF NOT EXISTS group_edge (
    PRIMARY KEY (source_id, state, position),

    source_id      UUID        NOT NULL CHECK (source_id <> '00000000-0000-0000-0000-000000000000'),
    position       BIGINT      NOT NULL, -- Used for sort order on rows.
    update_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    destination_id UUID        NOT NULL CHECK (destination_id <> '00000000-0000-0000-0000-000000000000'),
    state          SMALLINT    NOT NULL DEFAULT 0, -- superadmin(0), admin(1), member(2), join_request(3), banned(4)

    UNIQUE (source_id, destination_id)
);

-- +migrate Down
DROP TABLE IF EXISTS
    group_edge, groups, user_tombstone, wallet_ledger, leaderboard_record, leaderboard, message, storage, notification, user_edge, user_device, users;
