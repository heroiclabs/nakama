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
CREATE TABLE IF NOT EXISTS console_user (
    PRIMARY KEY (id),

    create_time  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    disable_time TIMESTAMPTZ  NOT NULL DEFAULT '1970-01-01 00:00:00 UTC',
    email        VARCHAR(255) NOT NULL CONSTRAINT console_user_email_uniq UNIQUE,
    id           UUID         NOT NULL,
    metadata     JSONB        NOT NULL DEFAULT '{}',
    password     BYTEA        CHECK (length(password) < 32000),
    role         SMALLINT     NOT NULL DEFAULT 4 CHECK (role >= 1), -- unused(0), admin(1), developer(2), maintainer(3), readonly(4)
    update_time  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    username     VARCHAR(128) NOT NULL CONSTRAINT console_user_username_uniq UNIQUE
);

CREATE TABLE IF NOT EXISTS purchase_receipt (
    PRIMARY KEY (receipt),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE NO ACTION,

    create_time    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    product_id     VARCHAR(512) NOT NULL,
    purchase_time  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    raw_response   JSONB        NOT NULL DEFAULT '{}',
    receipt        TEXT         NOT NULL CHECK (length(receipt) > 0),
    store          SMALLINT     NOT NULL DEFAULT 0, -- AppleAppStore(0), GooglePlay(1), Huawei(2)
    transaction_id VARCHAR(512) NOT NULL CHECK (length(transaction_id) > 0),
    update_time    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    user_id        UUID         NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_receipt_user_id_purchase_time_transaction_id_idx
    ON purchase_receipt (user_id, purchase_time DESC, transaction_id);

ALTER TABLE user_device
    ADD COLUMN IF NOT EXISTS preferences        JSONB        NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS push_token_amazon  VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS push_token_android VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS push_token_huawei  VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS push_token_ios     VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS push_token_web     VARCHAR(512) NOT NULL DEFAULT '';

-- +migrate Down
ALTER TABLE user_device
    DROP COLUMN IF EXISTS preferences,
    DROP COLUMN IF EXISTS push_token_amazon,
    DROP COLUMN IF EXISTS push_token_android,
    DROP COLUMN IF EXISTS push_token_huawei,
    DROP COLUMN IF EXISTS push_token_ios,
    DROP COLUMN IF EXISTS push_token_web;

DROP TABLE IF EXISTS console_user, purchase_receipt;
