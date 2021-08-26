#!/bin/bash

set -e

psql postgres://$1:$2@$3:5432 -q -c "CREATE USER nakama WITH PASSWORD 'nakama';"
psql postgres://$1:$2@$3:5432 -q -c "ALTER USER nakama CREATEDB;"
psql postgres://$1:$2@$3:5432 -q -c "CREATE DATABASE \"nakama\";"
psql postgres://$1:$2@$3:5432 -q -c "GRANT ALL PRIVILEGES ON DATABASE nakama TO nakama;"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"btree_gin\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"btree_gist\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"fuzzystrmatch\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"pgrowlocks\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"pg_stat_statements\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql postgres://$1:$2@$3:5432/nakama -q -c "GRANT EXECUTE ON FUNCTION pg_stat_statements_reset TO nakama;"
psql postgres://$1:$2@$3:5432/nakama -q -c "GRANT pg_monitor TO nakama;"
