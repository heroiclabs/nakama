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

CREATE TABLE IF NOT EXISTS purchase (
    PRIMARY KEY (user_id, provider, product_id), -- ad-hoc purchase lookup
    created_at      BIGINT       CHECK (created_at > 0) NOT NULL,
    provider        SMALLINT     NOT NULL, -- google(0), apple(1)
    type            VARCHAR(70)  NOT NULL, -- product, subscription, etc
    user_id         BYTEA        NOT NULL,
    product_id      VARCHAR(70)  NOT NULL,
    receipt         BYTEA        NOT NULL,
    provider_resp   BYTEA        NOT NULL
);

-- list purchases by user
CREATE INDEX IF NOT EXISTS purchase_user_created_at_provider_idx ON purchase (user_id, created_at DESC, provider);
-- list users who've purchased a particular product
CREATE INDEX IF NOT EXISTS purchase_user_provider_created_at_idx ON purchase (product_id, created_at DESC, user_id);
-- list purchases by most recent timestamp, and optionally for a given user
CREATE INDEX IF NOT EXISTS purchase_user_provider_created_at_idx ON purchase (created_at DESC, user_id);

-- +migrate Down
DROP TABLE IF EXISTS purchase;
