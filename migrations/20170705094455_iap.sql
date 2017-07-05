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
CREATE TABLE IF NOT EXISTS purchase (
    PRIMARY KEY (user_id, provider, product_id), -- adhoc purchase lookups
    created_at      BIGINT       CHECK (created_at > 0) NOT NULL,
    provider        SMALLINT     NOT NULL, -- google(0), apple(1)
    type            VARCHAR(70)  NOT NULL, -- product, subscription, etc
    user_id         BYTEA        NOT NULL,
    product_id      VARCHAR(70)  NOT NULL,
    transaction     BYTEA        NOT NULL,
    verification    BYTEA        NOT NULL
);

-- list purchases by user
CREATE INDEX IF NOT EXISTS purchase_user_created_at_provider_idx ON purchase (user_id, created_at DESC, provider);
-- list users who've purchased a particular product
CREATE INDEX IF NOT EXISTS purchase_user_provider_created_at_idx ON purchase (product_id, created_at DESC, user_id);
-- list purchases by most recent timestamp, and optionally for a given user
CREATE INDEX IF NOT EXISTS purchase_user_provider_created_at_idx ON purchase (created_at DESC, user_id);

-- +migrate Down
DROP TABLE IF EXISTS purchase;
