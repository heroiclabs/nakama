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
ALTER TABLE purchase
    DROP CONSTRAINT purchase_user_id_fkey;
ALTER TABLE subscription
    DROP CONSTRAINT subscription_user_id_fkey;

UPDATE purchase
    SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
UPDATE subscription
    SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;

ALTER TABLE purchase
    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE purchase
    ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE subscription
    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE subscription
    ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE purchase
    ADD CONSTRAINT purchase_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET DEFAULT;
ALTER TABLE subscription
    ADD CONSTRAINT subscription_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET DEFAULT;

-- +migrate Down
ALTER TABLE purchase
    DROP CONSTRAINT purchase_user_id_fkey;
ALTER TABLE subscription
    DROP CONSTRAINT subscription_user_id_fkey;

ALTER TABLE purchase
    ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE purchase
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE subscription
    ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE subscription
    ALTER COLUMN user_id DROP NOT NULL;

UPDATE purchase
    SET user_id = NULL WHERE user_id = '00000000-0000-0000-0000-000000000000';
UPDATE subscription
    SET user_id = NULL WHERE user_id = '00000000-0000-0000-0000-000000000000';

ALTER TABLE purchase
    ADD CONSTRAINT purchase_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE subscription
    ADD CONSTRAINT subscription_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
