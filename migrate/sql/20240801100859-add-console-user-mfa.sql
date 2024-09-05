/*
 * Copyright 2024 The Nakama Authors
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
ALTER TABLE console_user
    ADD COLUMN mfa_secret BYTEA DEFAULT NULL,
    ADD COLUMN mfa_recovery_codes BYTEA DEFAULT NULL,
    ADD COLUMN mfa_required BOOLEAN DEFAULT FALSE;

-- +migrate Down
ALTER TABLE console_user
    DROP COLUMN mfa_secret,
    DROP COLUMN mfa_recovery_codes,
    DROP COLUMN mfa_required;
