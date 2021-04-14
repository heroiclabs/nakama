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
ALTER TABLE purchase_receipt
    ADD COLUMN environment SMALLINT NOT NULL DEFAULT 0, -- Unknown(0), Sandbox(1), Production(2)
    DROP COLUMN IF EXISTS receipt;

-- +migrate Down
ALTER TABLE purchase_receipt
    ADD COLUMN IF NOT EXISTS receipt TEXT NOT NULL CHECK (length(receipt) > 0),
    DROP COLUMN IF EXISTS environment;
