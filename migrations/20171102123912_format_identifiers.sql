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

UPDATE users SET id = from_uuid(id)::BYTEA WHERE length(id) = 16;
UPDATE user_device SET user_id = from_uuid(user_id)::BYTEA WHERE length(user_id) = 16;

ALTER TABLE IF EXISTS user_device ADD CONSTRAINT fk_user_id_ref_users FOREIGN KEY (user_id) REFERENCES users(id);

UPDATE user_edge SET source_id = from_uuid(source_id)::BYTEA WHERE length(source_id) = 16;
UPDATE user_edge SET destination_id = from_uuid(destination_id)::BYTEA WHERE length(destination_id) = 16;
UPDATE user_edge_metadata SET source_id = from_uuid(source_id)::BYTEA WHERE length(source_id) = 16;

UPDATE groups SET id = from_uuid(id)::BYTEA WHERE length(id) = 16;
UPDATE groups SET creator_id = from_uuid(creator_id)::BYTEA WHERE length(creator_id) = 16;
UPDATE group_edge SET source_id = from_uuid(source_id)::BYTEA WHERE length(source_id) = 16;
UPDATE group_edge SET destination_id = from_uuid(destination_id)::BYTEA WHERE length(destination_id) = 16;

UPDATE message SET user_id = from_uuid(user_id)::BYTEA WHERE length(user_id) = 16;
UPDATE message SET message_id = from_uuid(message_id)::BYTEA WHERE length(message_id) = 16;

UPDATE storage SET id = from_uuid(id)::BYTEA WHERE length(id) = 16;
UPDATE storage SET user_id = from_uuid(user_id)::BYTEA WHERE length(user_id) = 16;

UPDATE leaderboard_record SET id = from_uuid(id)::BYTEA WHERE length(id) = 16;
UPDATE leaderboard_record SET owner_id = from_uuid(owner_id)::BYTEA WHERE length(owner_id) = 16;

UPDATE purchase SET user_id = from_uuid(user_id)::BYTEA WHERE length(user_id) = 16;

UPDATE notification SET id = from_uuid(id)::BYTEA WHERE length(id) = 16;
UPDATE notification SET user_id = from_uuid(user_id)::BYTEA WHERE length(user_id) = 16;
UPDATE notification SET sender_id = from_uuid(sender_id)::BYTEA WHERE length(sender_id) = 16;

-- +migrate Down
ALTER TABLE IF EXISTS user_device DROP CONSTRAINT IF EXISTS fk_user_id_ref_users;

UPDATE users SET id = to_uuid(id::VARCHAR)::BYTEA WHERE length(id) = 36;
UPDATE user_device SET user_id = to_uuid(user_id::VARCHAR)::BYTEA WHERE length(user_id) = 36;

ALTER TABLE IF EXISTS user_device ADD CONSTRAINT fk_user_id_ref_users FOREIGN KEY (user_id) REFERENCES users(id);

UPDATE user_edge SET source_id = to_uuid(source_id::VARCHAR)::BYTEA WHERE length(source_id) = 36;
UPDATE user_edge SET destination_id = to_uuid(destination_id::VARCHAR)::BYTEA WHERE length(destination_id) = 36;
UPDATE user_edge_metadata SET source_id = to_uuid(source_id::VARCHAR)::BYTEA WHERE length(source_id) = 36;

UPDATE groups SET id = to_uuid(id::VARCHAR)::BYTEA WHERE length(id) = 36;
UPDATE groups SET creator_id = to_uuid(creator_id::VARCHAR)::BYTEA WHERE length(creator_id) = 36;
UPDATE group_edge SET source_id = to_uuid(source_id::VARCHAR)::BYTEA WHERE length(source_id) = 36;
UPDATE group_edge SET destination_id = to_uuid(destination_id::VARCHAR)::BYTEA WHERE length(destination_id) = 36;

UPDATE message SET user_id = to_uuid(user_id::VARCHAR)::BYTEA WHERE length(user_id) = 36;
UPDATE message SET message_id = to_uuid(message_id::VARCHAR)::BYTEA WHERE length(message_id) = 36;

UPDATE storage SET id = to_uuid(id::VARCHAR)::BYTEA WHERE length(id) = 36;
UPDATE storage SET user_id = to_uuid(user_id::VARCHAR)::BYTEA WHERE length(user_id) = 36;

UPDATE leaderboard_record SET id = to_uuid(id::VARCHAR)::BYTEA WHERE length(id) = 36;
UPDATE leaderboard_record SET owner_id = to_uuid(owner_id::VARCHAR)::BYTEA WHERE length(owner_id) = 36;

UPDATE purchase SET user_id = to_uuid(user_id::VARCHAR)::BYTEA WHERE length(user_id) = 36;

UPDATE notification SET id = to_uuid(id::VARCHAR)::BYTEA WHERE length(id) = 36;
UPDATE notification SET user_id = to_uuid(user_id::VARCHAR)::BYTEA WHERE length(user_id) = 36;
UPDATE notification SET sender_id = to_uuid(sender_id::VARCHAR)::BYTEA WHERE length(sender_id) = 36;
