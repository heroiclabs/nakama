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
    id            BYTES         DEFAULT uuid_v4() NOT NULL,
    handle        VARCHAR(20)   UNIQUE NOT NULL,
    fullname      VARCHAR(70),
    avatar_url    VARCHAR(255),
    -- https://tools.ietf.org/html/bcp47
    lang          VARCHAR(18)   DEFAULT 'en' NOT NULL,
    location      VARCHAR(64),  -- e.g. "San Francisco, CA"
    timezone      VARCHAR(64),  -- e.g. "Pacific Time (US & Canada)"
    utc_offset_ms SMALLINT      DEFAULT 0 NOT NULL,
    metadata      BLOB          DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    email         VARCHAR(255),
    password      BYTES         CHECK (length(password) < 32000),
    facebook_id   VARCHAR(64),
    google_id     VARCHAR(64),
    gamecenter_id VARCHAR(64),
    steam_id      VARCHAR(64),
    custom_id     VARCHAR(64),
    created_at    INT           CHECK (created_at > 0) NOT NULL,
    updated_at    INT           CHECK (updated_at > 0) NOT NULL,
    verified_at   INT           CHECK (verified_at >= 0) DEFAULT 0 NOT NULL,
    disabled_at   INT           CHECK (disabled_at >= 0) DEFAULT 0 NOT NULL,
    last_online_at INT          CHECK (last_online_at >= 0) DEFAULT 0 NOT NULL,

    UNIQUE INDEX email_idx (email)                 STORING (password, disabled_at, verified_at),
    UNIQUE INDEX facebook_id_idx (facebook_id)     STORING (disabled_at),
    UNIQUE INDEX google_id_idx (google_id)         STORING (disabled_at),
    UNIQUE INDEX gamecenter_id_idx (gamecenter_id) STORING (disabled_at),
    UNIQUE INDEX steam_id_idx (steam_id)           STORING (disabled_at),
    UNIQUE INDEX custom_id_idx (custom_id)         STORING (disabled_at)
);

-- This table should be replaced with an Array column in the users table
-- once Cockroach adds support for Array types
CREATE TABLE IF NOT EXISTS user_device (
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    id VARCHAR(36) NOT NULL,
    user_id BYTES NOT NULL,

    INDEX user_id_idx (user_id)
);

CREATE TABLE IF NOT EXISTS user_edge (
    PRIMARY KEY (source_id, state, position),
    source_id      BYTES    NOT NULL,
    position       BIGINT   NOT NULL, -- Used for sort order on rows
    updated_at     INT      CHECK (updated_at > 0) NOT NULL,
    destination_id BYTES    NOT NULL,
    state          SMALLINT DEFAULT 0 NOT NULL, -- friend(0), invite(1), invited(2), blocked(3), deleted(4), archived(5)

    UNIQUE INDEX source_id_destination_id_idx (source_id, destination_id)
);

CREATE TABLE IF NOT EXISTS user_edge_metadata (
    PRIMARY KEY (source_id),
    source_id  BYTES    NOT NULL,
    count      INT      DEFAULT 0 CHECK (count >= 0) NOT NULL,
    state      SMALLINT DEFAULT 0 CHECK (state >= 0) NOT NULL, -- Unused, currently only set to 0.
    updated_at INT      CHECK (updated_at > 0) NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    PRIMARY KEY (id),
    id            BYTES         DEFAULT uuid_v4() NOT NULL,
    creator_id    BYTES         NOT NULL,
    name          VARCHAR(70)   NOT NULL,
    description   VARCHAR(255),
    avatar_url    VARCHAR(255),
    -- https://tools.ietf.org/html/bcp47
    lang          VARCHAR(18)   DEFAULT 'en' NOT NULL,
    utc_offset_ms SMALLINT      DEFAULT 0 NOT NULL,
    -- FIXME replace with JSONB
    metadata      BLOB          DEFAULT '{}' CHECK (length(metadata) < 16000) NOT NULL,
    state         SMALLINT      DEFAULT 0 CHECK (state >= 0) NOT NULL, -- public(0), private(1)
    count         INT           DEFAULT 0 CHECK (count >= 0) NOT NULL,
    created_at    INT           CHECK (created_at > 0) NOT NULL,
    updated_at    INT           CHECK (updated_at > 0) NOT NULL,
    disabled_at   INT           CHECK (disabled_at >= 0) DEFAULT 0 NOT NULL,

    INDEX count_updated_at_id_idx (count, updated_at, id, disabled_at)       STORING (name, description, avatar_url, lang, state, utc_offset_ms, created_at),
    INDEX created_at_count_id_idx (created_at, count, id, disabled_at)       STORING (name, description, avatar_url, lang, state, utc_offset_ms, updated_at),
    INDEX lang_count_id_idx (lang, count, id, disabled_at)                   STORING (name, description, avatar_url, state, utc_offset_ms, created_at, updated_at),
    INDEX utc_offset_ms_count_id_idx (utc_offset_ms, count, id, disabled_at) STORING (name, description, avatar_url, lang, state, created_at, updated_at),
    INDEX id_disabled_at_idx (id, disabled_at)
);

CREATE TABLE IF NOT EXISTS group_edge (
    PRIMARY KEY (source_id, state, position),
    source_id      BYTES    NOT NULL,
    position       BIGINT   NOT NULL, -- Used for sort order on rows
    updated_at     INT      CHECK (updated_at > 0) NOT NULL,
    destination_id BYTES    NOT NULL,
    state          SMALLINT CHECK (state >= 0) NOT NULL, -- admin(0), member(1), join(2), archived(3)

    UNIQUE INDEX source_id_destination_id_idx (source_id, destination_id),
    INDEX source_id_destination_id_state_idx (source_id, destination_id, state)
);

CREATE TABLE IF NOT EXISTS message (
    PRIMARY KEY (topic, topic_type, message_id),
    topic      BYTES       CHECK (length(topic) <= 64) NOT NULL,
    topic_type SMALLINT    NOT NULL, -- dm(0), room(1), group(2)
    message_id BYTES       DEFAULT uuid_v4() NOT NULL,
    user_id    BYTES       NOT NULL,
    created_at INT         CHECK (created_at > 0) NOT NULL,
    expires_at INT         DEFAULT 0 CHECK (created_at >= 0) NOT NULL,
    handle     VARCHAR(20) NOT NULL,
    type       SMALLINT    NOT NULL, -- chat(0), group_join(1), group_add(2), group_leave(3), group_kick(4), group_promoted(5)
    -- FIXME replace with JSONB
    data       BYTES       DEFAULT '{}' CHECK (length(data) <= 1000) NOT NULL,

    INDEX topic_topic_type_created_at_idx (topic, topic_type, created_at),
    INDEX topic_topic_type_created_at_message_id_user_id_idx (topic, topic_type, created_at, message_id, user_id)
);

CREATE TABLE IF NOT EXISTS storage (
    PRIMARY KEY (bucket, collection, user_id, record, deleted_at),
    id         BYTES       DEFAULT uuid_v4() NOT NULL,
    user_id    BYTES,
    bucket     VARCHAR(70) NOT NULL,
    collection VARCHAR(70) NOT NULL,
    record     VARCHAR(70) NOT NULL,
    -- FIXME replace with JSONB
    value      BLOB        DEFAULT '{}' CHECK (length(value) < 16000) NOT NULL,
    version    BYTES       NOT NULL,
    read       SMALLINT    DEFAULT 1 CHECK (read >= 0) NOT NULL,
    write      SMALLINT    DEFAULT 1 CHECK (write >= 0) NOT NULL,
    created_at INT         CHECK (created_at > 0) NOT NULL,
    updated_at INT         CHECK (updated_at > 0) NOT NULL,
    -- FIXME replace with TTL support
    expires_at INT         CHECK (expires_at >= 0) DEFAULT 0 NOT NULL,
    deleted_at INT         CHECK (deleted_at >= 0) DEFAULT 0 NOT NULL,

    INDEX (read),
    INDEX (write),
    INDEX (version),
    -- For sync fetch
    INDEX (user_id, bucket, updated_at),
    -- For bulk deletes
    INDEX (user_id, deleted_at)                     STORING (expires_at),
    INDEX (user_id, bucket, deleted_at)             STORING (expires_at),
    INDEX (user_id, bucket, collection, deleted_at) STORING (expires_at)
);

-- +migrate Down
SET DATABASE TO nakama;

DROP TABLE IF EXISTS user_device;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS user_edge;
DROP TABLE IF EXISTS user_edge_metadata;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS group_edge;
DROP TABLE IF EXISTS message;
DROP TABLE IF EXISTS storage;
