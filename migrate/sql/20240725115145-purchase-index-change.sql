/*
 * Copyright 2023 The Nakama Authors
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
DROP INDEX IF EXISTS purchase_user_id_purchase_time_transaction_id_idx;
DROP INDEX IF EXISTS subscription_user_id_purchase_time_transaction_id_idx;

CREATE INDEX IF NOT EXISTS purchase_time_user_id_transaction_id_idx
    ON purchase (purchase_time DESC, user_id DESC, transaction_id DESC);
CREATE INDEX IF NOT EXISTS subscription_time_user_id_transaction_id_idx
    ON subscription (purchase_time DESC, user_id DESC, original_transaction_id DESC);

-- +migrate Down
DROP INDEX IF EXISTS purchase_time_user_id_transaction_id_idx;
DROP INDEX IF EXISTS subscription_time_user_id_transaction_id_idx;

CREATE INDEX IF NOT EXISTS purchase_user_id_purchase_time_transaction_id_idx
    ON purchase (user_id, purchase_time DESC, transaction_id);
CREATE INDEX IF NOT EXISTS subscription_user_id_purchase_time_transaction_id_idx
    ON subscription (user_id, purchase_time DESC, original_transaction_id);
