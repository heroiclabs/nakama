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

SET DATABASE = nakama;

BEGIN;
UPSERT INTO leaderboard (id, authoritative, sort_order, reset_schedule, metadata)
VALUES (b'ce042d38-c3db-4ebd-bc99-3aaa0adbdef7', true, 1, '0 0 * * 1', b'{}');

UPSERT INTO users (id, handle, created_at, updated_at)
VALUES (b'4c2ae592-b2a7-445e-98ec-697694478b1c', b'02ebb2c8', now()::INT, now()::INT);
COMMIT;
