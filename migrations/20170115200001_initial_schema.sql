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
CREATE TABLE IF NOT EXISTS users (
    PRIMARY KEY (id),
    id             BYTEA         NOT NULL,
    handle         VARCHAR(128)  CONSTRAINT users_handle_key UNIQUE NOT NULL,
    fullname       VARCHAR(255),
    avatar_url     VARCHAR(255),
    -- https://tools.ietf.org/html/bcp47
    lang           VARCHAR(18)   DEFAULT 'en' NOT NULL,
    location       VARCHAR(255), -- e.g. "San Francisco, CA"
    timezone       VARCHAR(255), -- e.g. "Pacific Time (US & Canada)"
    utc_offset_ms  SMALLINT      DEFAULT 0 NOT NULL,
    metadata       BYTEA         DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    email          VARCHAR(255)  UNIQUE,
    password       BYTEA         CHECK (length(password) < 32000),
    facebook_id    VARCHAR(128)  UNIQUE,
    google_id      VARCHAR(128)  UNIQUE,
    gamecenter_id  VARCHAR(128)  UNIQUE,
    steam_id       VARCHAR(128)  UNIQUE,
    custom_id      VARCHAR(128)  UNIQUE,
    created_at     BIGINT        CHECK (created_at > 0) NOT NULL,
    updated_at     BIGINT        CHECK (updated_at > 0) NOT NULL,
    verified_at    BIGINT        CHECK (verified_at >= 0) DEFAULT 0 NOT NULL,
    disabled_at    BIGINT        CHECK (disabled_at >= 0) DEFAULT 0 NOT NULL
);

-- This table should be replaced with an array column in the users table
-- once cockroachdb adds support for array types
CREATE TABLE IF NOT EXISTS user_device (
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    id      VARCHAR(128) NOT NULL,
    user_id BYTEA        NOT NULL
);
-- In cockroachdb a FK relationship will implicitly create an index on the
-- column. As a result we don't need the separate index creation which breaks
-- when applied in a single transaction. See issue cockroachdb/cockroach#13505.
--CREATE INDEX IF NOT EXISTS user_id_idx ON user_device (user_id);

CREATE TABLE IF NOT EXISTS user_edge (
    PRIMARY KEY (source_id, state, position),
    source_id      BYTEA    NOT NULL,
    position       BIGINT   NOT NULL, -- Used for sort order on rows
    updated_at     BIGINT   CHECK (updated_at > 0) NOT NULL,
    destination_id BYTEA    NOT NULL,
    state          SMALLINT DEFAULT 0 NOT NULL, -- friend(0), invite(1), invited(2), blocked(3), deleted(4), archived(5)

    UNIQUE (source_id, destination_id)
);

CREATE TABLE IF NOT EXISTS user_edge_metadata (
    PRIMARY KEY (source_id),
    source_id  BYTEA    NOT NULL,
    count      INT      DEFAULT 0 CHECK (count >= 0) NOT NULL,
    state      SMALLINT DEFAULT 0 CHECK (state >= 0) NOT NULL, -- Unused, currently only set to 0.
    updated_at BIGINT   CHECK (updated_at > 0) NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    PRIMARY KEY (id),
    id            BYTEA         NOT NULL,
    creator_id    BYTEA         NOT NULL,
    name          VARCHAR(255)  CONSTRAINT groups_name_key UNIQUE NOT NULL,
    description   VARCHAR(255),
    avatar_url    VARCHAR(255),
    -- https://tools.ietf.org/html/bcp47
    lang          VARCHAR(18)   DEFAULT 'en' NOT NULL,
    utc_offset_ms SMALLINT      DEFAULT 0 NOT NULL,
    -- FIXME replace with JSONB
    metadata      BYTEA         DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    state         SMALLINT      DEFAULT 0 CHECK (state >= 0) NOT NULL, -- public(0), private(1)
    count         INT           DEFAULT 0 CHECK (count >= 0) NOT NULL,
    created_at    BIGINT        CHECK (created_at > 0) NOT NULL,
    updated_at    BIGINT        CHECK (updated_at > 0) NOT NULL,
    disabled_at   BIGINT        CHECK (disabled_at >= 0) DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS count_updated_at_id_idx ON groups (count, updated_at, id, disabled_at);
CREATE INDEX IF NOT EXISTS created_at_count_id_idx ON groups (created_at, count, id, disabled_at);
CREATE INDEX IF NOT EXISTS lang_count_id_idx ON groups (lang, count, id, disabled_at);
CREATE INDEX IF NOT EXISTS utc_offset_ms_count_id_idx ON groups (utc_offset_ms, count, id, disabled_at);
CREATE INDEX IF NOT EXISTS id_disabled_at_idx ON groups (id, disabled_at);

CREATE TABLE IF NOT EXISTS group_edge (
    PRIMARY KEY (source_id, state, position),
    source_id      BYTEA    NOT NULL,
    position       BIGINT   NOT NULL, -- Used for sort order on rows
    updated_at     BIGINT   CHECK (updated_at > 0) NOT NULL,
    destination_id BYTEA    NOT NULL,
    state          SMALLINT CHECK (state >= 0) NOT NULL, -- admin(0), member(1), join(2), archived(3)

    UNIQUE (source_id, destination_id)
);
CREATE INDEX IF NOT EXISTS source_id_destination_id_state_idx ON group_edge (source_id, destination_id, state);

CREATE TABLE IF NOT EXISTS message (
    PRIMARY KEY (topic, topic_type, message_id),
    topic      BYTEA        CHECK (length(topic) <= 128) NOT NULL,
    topic_type SMALLINT     NOT NULL, -- dm(0), room(1), group(2)
    message_id BYTEA        NOT NULL,
    user_id    BYTEA        NOT NULL,
    created_at BIGINT       CHECK (created_at > 0) NOT NULL,
    expires_at BIGINT       DEFAULT 0 CHECK (created_at >= 0) NOT NULL,
    handle     VARCHAR(128) NOT NULL,
    type       SMALLINT     NOT NULL, -- chat(0), group_join(1), group_add(2), group_leave(3), group_kick(4), group_promoted(5)
    -- FIXME replace with JSONB
    data       BYTEA        DEFAULT '{}' CHECK (length(data) <= 1000) NOT NULL
);
CREATE INDEX IF NOT EXISTS topic_topic_type_created_at_idx ON message (topic, topic_type, created_at);
CREATE INDEX IF NOT EXISTS topic_topic_type_created_at_message_id_user_id_idx ON message (topic, topic_type, created_at, message_id, user_id);

CREATE TABLE IF NOT EXISTS storage (
    PRIMARY KEY (bucket, collection, user_id, record, deleted_at),
    id         BYTEA        NOT NULL,
    user_id    BYTEA,
    bucket     VARCHAR(128) NOT NULL,
    collection VARCHAR(128) NOT NULL,
    record     VARCHAR(128) NOT NULL,
    -- FIXME replace with JSONB
    value      BYTEA        DEFAULT '{}' CHECK (length(value) < 16000) NOT NULL,
    version    BYTEA        NOT NULL,
    read       SMALLINT     DEFAULT 1 CHECK (read >= 0) NOT NULL,
    write      SMALLINT     DEFAULT 1 CHECK (write >= 0) NOT NULL,
    created_at BIGINT       CHECK (created_at > 0) NOT NULL,
    updated_at BIGINT       CHECK (updated_at > 0) NOT NULL,
    -- FIXME replace with TTL support
    expires_at BIGINT       CHECK (expires_at >= 0) DEFAULT 0 NOT NULL,
    deleted_at BIGINT       CHECK (deleted_at >= 0) DEFAULT 0 NOT NULL
);

-- +migrate Down
DROP TABLE IF EXISTS user_device;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS user_edge;
DROP TABLE IF EXISTS user_edge_metadata;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS group_edge;
DROP TABLE IF EXISTS message;
DROP TABLE IF EXISTS storage;
