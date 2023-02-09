ALTER TABLE storage
  drop constraint storage_pkey, add primary key using index "storage_collection_key_user_id_key";

DROP INDEX storage_pkey RESTRICT;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS collection_user_id_key_idx ON storage (collection, user_id, key);
