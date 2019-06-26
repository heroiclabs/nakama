/*
 * Copyright 2018 The Nakama Authors
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
CREATE TABLE IF NOT EXISTS achievements (
    id uuid NOT NULL,
    name text NOT NULL,
    description text NULL,
    initial_state int8 NOT NULL,
    "type" int8 NOT NULL,
    repeatability int8 NOT NULL,
    target_value int8 NULL,
    locked_image_url text NULL,
    unlocked_image_url text NULL,
    auxiliary_data jsonb NULL,
    CONSTRAINT achievements_pk PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS achievement_progress (
    achievement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    achievement_state int8 NOT NULL,
    progress int8 NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    awarded_at timestamptz NULL,
    auxiliary_data jsonb NULL,
    CONSTRAINT achievement_id_fk FOREIGN KEY (achievement_id) REFERENCES achievements(id),
    CONSTRAINT achievement_owner_fk FOREIGN KEY (user_id) REFERENCES "users"(id),
    CONSTRAINT achievement_progress_pk PRIMARY KEY (achievement_id, user_id)
);

-- +migrate Down
DROP TABLE IF EXISTS achievement_progress;
DROP TABLE IF EXISTS achievements;