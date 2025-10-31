/*
 * Copyright 2025 The Nakama Authors
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
CREATE TABLE IF NOT EXISTS users_notes (
    PRIMARY KEY (user_id, create_time, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (id),

    id          UUID NOT NULL,
    user_id     UUID NOT NULL,
    create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT   NOT NULL,
    create_id   UUID DEFAULT NULL,
    update_id   UUID DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS console_audit_log (
   PRIMARY KEY (create_time, console_username, action, resource, id),
   UNIQUE (id),

   create_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   id               UUID NOT NULL DEFAULT gen_random_uuid(),
   console_user_id  UUID NOT NULL,
   console_username TEXT NOT NULL,
   email            TEXT NOT NULL,
   action           TEXT NOT NULL,
   resource         TEXT NOT NULL,
   message          TEXT NOT NULL,
   metadata         JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS console_acl_template (
    PRIMARY KEY (id),

    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"        VARCHAR(64)  NOT NULL CHECK (length("name") > 0) CONSTRAINT template_name_uniq UNIQUE,
    "description" VARCHAR(64)  NOT NULL DEFAULT '',
    "acl"         JSONB        NOT NULL DEFAULT '{}',
    create_time   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    update_time   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- +migrate Down
DROP TABLE IF EXISTS console_audit_log;
DROP TABLE IF EXISTS users_notes;
DROP TABLE IF EXISTS console_acl_template;
