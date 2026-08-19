/*
 * Copyright 2026 The Nakama Authors
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
CREATE TABLE IF NOT EXISTS user_provider (
    PRIMARY KEY (provider, provider_user_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    provider         VARCHAR(128) NOT NULL,
    provider_user_id VARCHAR(128) NOT NULL,
    user_id          UUID         NOT NULL,
    create_time      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (user_id, provider)
);

-- +migrate Down
DROP TABLE IF EXISTS user_provider;
