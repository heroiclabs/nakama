/*
 * Copyright 2021 The Nakama Authors
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
CREATE TABLE IF NOT EXISTS subscription (
    PRIMARY KEY (original_transaction_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,

    original_transaction_id VARCHAR(512) NOT NULL CHECK (length(original_transaction_id) > 0),
    create_time             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    update_time             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    environment             SMALLINT     NOT NULL DEFAULT 0, -- Unknown(0), Sandbox(1), Production(2)
    product_id              VARCHAR(512) NOT NULL,
    purchase_time           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    store                   SMALLINT     NOT NULL DEFAULT 0, -- AppleAppStore(0), GooglePlay(1), Huawei(2)
    user_id                 UUID         DEFAULT NULL,
    expire_time             TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS subscription_user_id_purchase_time_transaction_id_idx
    ON subscription (user_id, purchase_time DESC, original_transaction_id);

-- +migrate Down
DROP TABLE IF EXISTS subscription;
