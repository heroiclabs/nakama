/*
 * Copyright 2020 The Nakama Authors
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
CREATE TABLE IF NOT EXISTS console_users (
    PRIMARY KEY (id),

    id           UUID         NOT NULL,
    username     VARCHAR(128) NOT NULL CONSTRAINT users_username_uniq UNIQUE,
    email        VARCHAR(255) NOT NULL CONSTRAINT users_email_uniq UNIQUE,
    password     BYTEA        CHECK (length(password) < 32000),
    role         SMALLINT     NOT NULL DEFAULT 4 CHECK (role >= 1), -- unused(0), admin(1), developer(2), maintainer(3), readonly(4)
    metadata     JSONB        NOT NULL DEFAULT '{}',
    create_time  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    update_time  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    disable_time TIMESTAMPTZ  NOT NULL DEFAULT '1970-01-01 00:00:00 UTC'
);

-- +migrate Down
DROP TABLE IF EXISTS console_users;
