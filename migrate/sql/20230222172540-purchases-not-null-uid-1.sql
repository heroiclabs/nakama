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
-- This migration is split in two files due to the following CRDB limitation
-- https://stackoverflow.com/questions/68803747/encapsulating-a-drop-and-add-constraint-in-a-transaction
ALTER TABLE purchase
    DROP CONSTRAINT IF EXISTS purchase_user_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_user_id_ref_users;
ALTER TABLE subscription
    DROP CONSTRAINT IF EXISTS subscription_user_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_user_id_ref_users;

UPDATE purchase
    SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
UPDATE subscription
    SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;

-- +migrate Down
-- This migration is split in two files due to the following CRDB limitation
-- https://stackoverflow.com/questions/68803747/encapsulating-a-drop-and-add-constraint-in-a-transaction
UPDATE purchase
    SET user_id = NULL WHERE user_id = '00000000-0000-0000-0000-000000000000';
UPDATE subscription
    SET user_id = NULL WHERE user_id = '00000000-0000-0000-0000-000000000000';

ALTER TABLE purchase
    ADD CONSTRAINT purchase_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE subscription
    ADD CONSTRAINT subscription_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
