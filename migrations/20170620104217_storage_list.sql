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
-- NOTE: not postgres compatible, it expects table.index rather than table@index.
DROP INDEX IF EXISTS storage@read_idx;
DROP INDEX IF EXISTS storage@write_idx;
DROP INDEX IF EXISTS storage@version_idx;
DROP INDEX IF EXISTS storage@user_id_bucket_updated_at_idx;
DROP INDEX IF EXISTS storage@user_id_deleted_at_idx;
DROP INDEX IF EXISTS storage@user_id_bucket_deleted_at_idx;
DROP INDEX IF EXISTS storage@user_id_bucket_collection_deleted_at_idx;

-- List by user first, then keep narrowing down.
CREATE INDEX IF NOT EXISTS deleted_at_user_id_read_bucket_collection_record_idx ON storage (deleted_at, user_id, read, bucket, collection, record);
CREATE INDEX IF NOT EXISTS deleted_at_user_id_bucket_read_collection_record_idx ON storage (deleted_at, user_id, bucket, read, collection, record);
CREATE INDEX IF NOT EXISTS deleted_at_user_id_bucket_collection_read_record_idx ON storage (deleted_at, user_id, bucket, collection, read, record);

-- List across users.
CREATE INDEX IF NOT EXISTS deleted_at_bucket_read_collection_record_user_id_idx ON storage (deleted_at, bucket, read, collection, record, user_id);
CREATE INDEX IF NOT EXISTS deleted_at_bucket_collection_read_record_user_id_idx ON storage (deleted_at, bucket, collection, read, record, user_id);

-- +migrate Down
