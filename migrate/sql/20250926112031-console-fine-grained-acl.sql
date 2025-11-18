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
ALTER TABLE console_user ADD COLUMN IF NOT EXISTS acl jsonb NOT NULL DEFAULT '{"admin":false}'::jsonb;

-- unused(0), admin(1), developer(2), maintainer(3), readonly(4)

UPDATE console_user
    SET acl = CASE
        WHEN role = 1 THEN '{"admin":true}'::jsonb
        ELSE '{"admin":false}'::jsonb
    END;
ALTER TABLE console_user DROP COLUMN IF EXISTS role;

-- +migrate Down
ALTER TABLE console_user ADD COLUMN IF NOT EXISTS role SMALLINT NOT NULL DEFAULT 4;

UPDATE console_user
    SET role = CASE
        WHEN (acl->'admin')::bool = true THEN 1
        ELSE 4
    END;

ALTER TABLE console_user DROP COLUMN IF EXISTS acl;
