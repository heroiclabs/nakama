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
    PRIMARY KEY (user_id, provider, receipt_id), -- ad-hoc purchase lookup
    user_id         BYTEA        NOT NULL,
    provider        SMALLINT     NOT NULL, -- google(0), apple(1)
    product_id      VARCHAR(255) NOT NULL,
    receipt_id      VARCHAR(255) NOT NULL, -- the transaction ID
    receipt         BYTEA        NOT NULL,
    provider_resp   BYTEA        NOT NULL,
    created_at      BIGINT       CHECK (created_at > 0) NOT NULL
);

-- look up purchase by ID and retrieve user. This must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_provider_receipt_id_user_id_idx ON purchase (provider, receipt_id, user_id);
-- list purchases by user
CREATE INDEX IF NOT EXISTS purchase_user_id_created_at_provider_receipt_id_idx ON purchase (user_id, created_at, provider, receipt_id);
-- list purchases by most recent timestamp
CREATE INDEX IF NOT EXISTS purchase_created_at_user_id_provider_receipt_id_idx ON purchase (created_at, user_id, provider, receipt_id);

CREATE TABLE IF NOT EXISTS notification (
    PRIMARY KEY (id),
    id              BYTEA        NOT NULL,
    user_id         BYTEA        NOT NULL,
    subject         VARCHAR(255) NOT NULL,
    content         BYTEA        DEFAULT '{}' CHECK (length(content) < 16000) NOT NULL,
    code            SMALLINT     NOT NULL,      -- O to 100 is System reserved.
    sender_id       BYTEA,                      -- NULL for System messages
    created_at      BIGINT       CHECK (created_at > 0) NOT NULL,
    expires_at      BIGINT       CHECK (expires_at > created_at) NOT NULL,
    deleted_at      BIGINT       DEFAULT 0 NOT NULL
);

-- list notifications for a user that are not deleted or expired, starting from a given ID (cursor).
CREATE INDEX IF NOT EXISTS notification_user_id_deleted_at_expires_at_id_idx ON notification (user_id, deleted_at ASC, expires_at ASC, id);

-- +migrate Down
DROP TABLE IF EXISTS purchase;
DROP TABLE IF EXISTS notification;
