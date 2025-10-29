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
DROP TABLE IF EXISTS console_acl_template;
