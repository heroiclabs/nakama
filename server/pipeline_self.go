// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"database/sql"
	"encoding/json"

	"go.uber.org/zap"
)

func (p *pipeline) selfFetch(logger *zap.Logger, session session, envelope *Envelope) {
	var fullname sql.NullString
	var handle sql.NullString
	var email sql.NullString
	var facebook sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var customID sql.NullString
	var timezone sql.NullString
	var location sql.NullString
	var lang sql.NullString
	var metadata []byte
	var avatarURL sql.NullString
	var verifiedAt sql.NullInt64
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64

	deviceIDs := make([]string, 0)

	rows, err := p.db.Query(`
SELECT u.handle, u.fullname, u.avatar_url, u.lang, u.location, u.timezone, u.metadata,
	u.email, u.facebook_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id,
	u.created_at, u.updated_at, u.verified_at,
	ud.id
FROM users u
LEFT JOIN user_device ud ON u.id = ud.user_id
WHERE u.id = $1`,
		session.UserID())
	if err != nil {
		logger.Error("Could not lookup user profile", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not lookup user profile"), true)
		return
	}

	defer rows.Close()
	for rows.Next() {
		var deviceID sql.NullString
		err = rows.Scan(&handle, &fullname, &avatarURL, &lang, &location, &timezone, &metadata,
			&email, &facebook, &google, &gamecenter, &steam, &customID,
			&createdAt, &updatedAt, &verifiedAt, &deviceID)
		if err != nil {
			logger.Error("Error reading user profile", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error reading user profile"), true)
			return
		}
		if deviceID.Valid {
			deviceIDs = append(deviceIDs, deviceID.String)
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error reading user profile", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error reading user profile"), true)
		return
	}

	s := &Self{
		User: &User{
			Id:        session.UserID(),
			Handle:    handle.String,
			Fullname:  fullname.String,
			AvatarUrl: avatarURL.String,
			Lang:      lang.String,
			Location:  location.String,
			Timezone:  timezone.String,
			Metadata:  string(metadata),
			CreatedAt: createdAt.Int64,
			UpdatedAt: updatedAt.Int64,
			// The self user is assumed to be online.
			LastOnlineAt: nowMs(),
		},
		Email:        email.String,
		DeviceIds:    deviceIDs,
		FacebookId:   facebook.String,
		GoogleId:     google.String,
		GamecenterId: gamecenter.String,
		SteamId:      steam.String,
		CustomId:     customID.String,
		Verified:     verifiedAt.Int64 > 0,
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Self{Self: &TSelf{Self: s}}}, true)
}

func (p *pipeline) selfUpdate(logger *zap.Logger, session session, envelope *Envelope) {
	update := envelope.GetSelfUpdate()

	// Validate any input possible before we hit database.
	if update.Handle == "" && update.Fullname == "" && update.Timezone == "" && update.Location == "" && update.Lang == "" && len(update.Metadata) == 0 && update.AvatarUrl == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No fields to update"), true)
		return
	}
	if len(update.Metadata) != 0 {
		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(update.Metadata), &maybeJSON) != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Metadata must be a valid JSON object"), true)
			return
		}
	}

	// Run the update.
	code, err := SelfUpdate(logger, p.db, []*SelfUpdateOp{&SelfUpdateOp{
		UserId:    session.UserID(),
		Handle:    update.Handle,
		Fullname:  update.Fullname,
		Timezone:  update.Timezone,
		Location:  update.Location,
		Lang:      update.Lang,
		Metadata:  []byte(update.Metadata),
		AvatarUrl: update.AvatarUrl,
	}})
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	// Update handle in session and any presences, if a handle update was processed.
	if update.Handle != "" {
		session.SetHandle(update.Handle)
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}
