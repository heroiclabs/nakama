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
ALTER TABLE IF EXISTS user_device DROP CONSTRAINT IF EXISTS fk_user_id_ref_users;

UPDATE users SET id = from_uuid(id)::BYTEA;
UPDATE user_device SET user_id = from_uuid(user_id)::BYTEA;

ALTER TABLE IF EXISTS user_device ADD CONSTRAINT fk_user_id_ref_users FOREIGN KEY (user_id) REFERENCES users(id);

UPDATE user_edge SET source_id = from_uuid(source_id)::BYTEA, destination_id = from_uuid(destination_id)::BYTEA;
UPDATE user_edge_metadata SET source_id = from_uuid(source_id)::BYTEA;

UPDATE groups SET id = from_uuid(id)::BYTEA, creator_id = from_uuid(creator_id)::BYTEA;
UPDATE group_edge SET source_id = from_uuid(source_id)::BYTEA, destination_id = from_uuid(destination_id)::BYTEA;

UPDATE message SET user_id = from_uuid(user_id)::BYTEA, message_id = from_uuid(message_id)::BYTEA;

UPDATE storage SET id = from_uuid(id)::BYTEA, user_id = from_uuid(user_id)::BYTEA;

UPDATE leaderboard_record SET id = from_uuid(id)::BYTEA, owner_id = from_uuid(owner_id)::BYTEA;

UPDATE purchase SET user_id = from_uuid(user_id)::BYTEA;

UPDATE notification SET id = from_uuid(id)::BYTEA, user_id = from_uuid(user_id)::BYTEA, sender_id = from_uuid(sender_id)::BYTEA;

-- +migrate Down
ALTER TABLE IF EXISTS user_device DROP CONSTRAINT IF EXISTS fk_user_id_ref_users;

UPDATE users SET id = to_uuid(id)::BYTEA;
UPDATE user_device SET user_id = to_uuid(user_id)::BYTEA;

ALTER TABLE IF EXISTS user_device ADD CONSTRAINT fk_user_id_ref_users FOREIGN KEY (user_id) REFERENCES users(id);

UPDATE user_edge SET source_id = to_uuid(source_id)::BYTEA, destination_id = to_uuid(destination_id)::BYTEA;
UPDATE user_edge_metadata SET source_id = to_uuid(source_id)::BYTEA;

UPDATE groups SET id = to_uuid(id)::BYTEA, creator_id = to_uuid(creator_id)::BYTEA;
UPDATE group_edge SET source_id = to_uuid(source_id)::BYTEA, destination_id = to_uuid(destination_id)::BYTEA;

UPDATE message SET user_id = to_uuid(user_id)::BYTEA, message_id = to_uuid(message_id)::BYTEA;

UPDATE storage SET id = to_uuid(id)::BYTEA, user_id = to_uuid(user_id)::BYTEA;

UPDATE leaderboard_record SET id = to_uuid(id)::BYTEA, owner_id = to_uuid(owner_id)::BYTEA;

UPDATE purchase SET user_id = to_uuid(user_id)::BYTEA;

UPDATE notification SET id = to_uuid(id)::BYTEA, user_id = to_uuid(user_id)::BYTEA, sender_id = to_uuid(sender_id)::BYTEA;
