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
CREATE TABLE IF NOT EXISTS setting (
    PRIMARY KEY (name),

    "name"      VARCHAR(64)  NOT NULL CHECK (length("name") > 0) CONSTRAINT setting_name_uniq UNIQUE,
    "value"     JSONB        NOT NULL DEFAULT '{}',
    update_time TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO
    setting ("name", "value")
VALUES
    ('utc_toggle', 'false')
ON CONFLICT ("name") DO NOTHING;

-- +migrate Down
DROP TABLE IF EXISTS setting;
