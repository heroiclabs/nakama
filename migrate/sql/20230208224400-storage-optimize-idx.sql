CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS storage_collection_user_id_key_idx ON storage (collection, user_id, key);

--TODO: wait for index to complete

ALTER TABLE storage
  drop constraint storage_pkey, add primary key using index "storage_collection_user_id_key_idx";

DROP INDEX storage_pkey RESTRICT;
DROP INDEX storage_collection_key_user_id_key RESTRICT;
DROP INDEX collection_read_user_id_key_idx RESTRICT;
DROP INDEX collection_user_id_read_key_idx RESTRICT;


