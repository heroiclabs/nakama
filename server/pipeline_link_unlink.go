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
	"strconv"

	"strings"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

func (p *pipeline) linkID(logger *zap.Logger, session session, envelope *Envelope) {
	// Route to correct link handler
	switch envelope.GetLink().Id.(type) {
	case *TLink_Device:
		p.linkDevice(logger, session, envelope)
	case *TLink_Facebook:
		p.linkFacebook(logger, session, envelope)
	case *TLink_Google:
		p.linkGoogle(logger, session, envelope)
	case *TLink_GameCenter:
		p.linkGameCenter(logger, session, envelope)
	case *TLink_Steam:
		p.linkSteam(logger, session, envelope)
	case *TLink_Email:
		p.linkEmail(logger, session, envelope)
	case *TLink_Custom:
		p.linkCustom(logger, session, envelope)
	default:
		logger.Error("Could not link", zap.String("error", "Invalid payload"))
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid payload"), true)
		return
	}
}

func (p *pipeline) linkDevice(logger *zap.Logger, session session, envelope *Envelope) {
	deviceID := envelope.GetLink().GetDevice()
	if deviceID == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Device ID is required"), true)
		return
	} else if invalidCharsRegex.MatchString(deviceID) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid device ID, no spaces or control characters allowed"), true)
		return
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid device ID, must be 10-128 bytes"), true)
		return
	}

	txn, err := p.db.Begin()
	if err != nil {
		logger.Warn("Could not link, transaction begin error", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	}
	res, err := txn.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, session.UserID())
	if err != nil {
		// In any error case the link has failed, so we can rollback before checking what went wrong.
		if e := txn.Rollback(); e != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(e))
		}

		if strings.HasSuffix(err.Error(), "violates unique constraint \"primary\"") {
			session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Device ID in use"), true)
		} else {
			logger.Warn("Could not link, query error", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		}
		return
	}
	if count, _ := res.RowsAffected(); count == 0 {
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	}
	res, err = txn.Exec("UPDATE users SET updated_at = $1 WHERE id = $2", nowMs(), session.UserID())
	if err != nil {
		logger.Warn("Could not link, query error", zap.Error(err))
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	}
	if count, _ := res.RowsAffected(); count == 0 {
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	}
	err = txn.Commit()
	if err != nil {
		logger.Warn("Could not link, transaction commit error", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkFacebook(logger *zap.Logger, session session, envelope *Envelope) {
	accessToken := envelope.GetLink().GetFacebook()
	if accessToken == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Access token is required"), true)
		return
	} else if invalidCharsRegex.MatchString(accessToken) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid Facebook access token, no spaces or control characters allowed"), true)
		return
	}

	fbProfile, err := p.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		logger.Warn("Could not get Facebook profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Could not get Facebook profile"), true)
		return
	}

	userID := session.UserID()

	res, err := p.db.Exec(`
UPDATE users
SET facebook_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE facebook_id = $2)`,
		userID, fbProfile.ID, nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Facebook ID in use"), true)
		return
	}

	p.addFacebookFriends(logger, userID, session.Handle(), fbProfile.ID, accessToken)

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkGoogle(logger *zap.Logger, session session, envelope *Envelope) {
	accessToken := envelope.GetLink().GetGoogle()
	if accessToken == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Access token is required"), true)
		return
	} else if invalidCharsRegex.MatchString(accessToken) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid Google access token, no spaces or control characters allowed"), true)
		return
	}

	googleProfile, err := p.socialClient.CheckGoogleToken(accessToken)
	if err != nil {
		logger.Warn("Could not get Google profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Could not get Google profile"), true)
		return
	}

	res, err := p.db.Exec(`
UPDATE users
SET google_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE google_id = $2)`,
		session.UserID(),
		googleProfile.Sub,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Google ID in use"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkGameCenter(logger *zap.Logger, session session, envelope *Envelope) {
	gc := envelope.GetLink().GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Game Center credentials required"), true)
		return
	}

	_, err := p.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		logger.Warn("Could not get Game Center profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Could not get Game Center profile"), true)
		return
	}

	res, err := p.db.Exec(`
UPDATE users
SET gamecenter_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE gamecenter_id = $2)`,
		session.UserID(),
		gc.PlayerId,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Game Center ID in use"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkSteam(logger *zap.Logger, session session, envelope *Envelope) {
	if p.config.GetSocial().Steam.PublisherKey == "" || p.config.GetSocial().Steam.AppID == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Steam link not available"), true)
		return
	}

	ticket := envelope.GetLink().GetSteam()
	if ticket == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Steam ticket is required"), true)
		return
	} else if invalidCharsRegex.MatchString(ticket) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid Steam ticket, no spaces or control characters allowed"), true)
		return
	}

	steamProfile, err := p.socialClient.GetSteamProfile(p.config.GetSocial().Steam.PublisherKey, p.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		logger.Warn("Could not get Steam profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Could not get Steam profile"), true)
		return
	}

	res, err := p.db.Exec(`
UPDATE users
SET steam_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE steam_id = $2)`,
		session.UserID(),
		strconv.FormatUint(steamProfile.SteamID, 10),
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Steam ID in use"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkEmail(logger *zap.Logger, session session, envelope *Envelope) {
	email := envelope.GetLink().GetEmail()
	if email == nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid payload"), true)
		return
	} else if email.Email == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Email address is required"), true)
		return
	} else if invalidCharsRegex.MatchString(email.Email) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid email address, no spaces or control characters allowed"), true)
		return
	} else if !emailRegex.MatchString(email.Email) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid email address format"), true)
		return
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid email address, must be 10-255 bytes"), true)
		return
	} else if len(email.Password) < 8 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Password must be longer than 8 characters"), true)
		return
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(email.Password), bcrypt.DefaultCost)

	res, err := p.db.Exec(`
UPDATE users
SET email = $2, password = $3, updated_at = $4
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE email = $2)`,
		session.UserID(),
		strings.ToLower(email.Email),
		hashedPassword,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Email address in use"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) linkCustom(logger *zap.Logger, session session, envelope *Envelope) {
	customID := envelope.GetLink().GetCustom()
	if customID == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Custom ID is required"), true)
		return
	} else if invalidCharsRegex.MatchString(customID) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid custom ID, no spaces or control characters allowed"), true)
		return
	} else if len(customID) < 10 || len(customID) > 128 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid custom ID, must be 10-128 bytes"), true)
		return
	}

	res, err := p.db.Exec(`
UPDATE users
SET custom_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE custom_id = $2)`,
		session.UserID(),
		customID,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not link"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_INUSE, "Custom ID in use"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) unlinkID(logger *zap.Logger, session session, envelope *Envelope) {
	// Select correct unlink query
	var query string
	var param interface{}
	switch envelope.GetUnlink().Id.(type) {
	case *TUnlink_Device:
		txn, err := p.db.Begin()
		if err != nil {
			logger.Warn("Could not unlink, transaction begin error", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not unlink"), true)
			return
		}
		res, err := txn.Exec(`
DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
      (facebook_id IS NOT NULL
       OR google_id IS NOT NULL
       OR gamecenter_id IS NOT NULL
       OR steam_id IS NOT NULL
       OR email IS NOT NULL
       OR custom_id IS NOT NULL))
     OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2))`,
			session.UserID(),
			envelope.GetUnlink().GetDevice())
		if err != nil {
			logger.Warn("Could not unlink, query error", zap.Error(err))
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not unlink"), true)
			return
		}
		if count, _ := res.RowsAffected(); count == 0 {
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_DISALLOWED, "Check profile exists and is not last link"), true)
			return
		}
		res, err = txn.Exec("UPDATE users SET updated_at = $2 WHERE id = $1", session.UserID(), nowMs())
		if err != nil {
			logger.Warn("Could not unlink, query error", zap.Error(err))
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not unlink"), true)
			return
		}
		if count, _ := res.RowsAffected(); count == 0 {
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_DISALLOWED, "Check profile exists and is not last link"), true)
			return
		}
		err = txn.Commit()
		if err != nil {
			logger.Warn("Could not unlink, transaction commit error", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not unlink"), true)
			return
		}

		session.Send(&Envelope{CollationId: envelope.CollationId}, true)
		return
	case *TUnlink_Facebook:
		query = `UPDATE users SET facebook_id = NULL, updated_at = $3
WHERE id = $1
AND facebook_id = $2
AND ((google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetFacebook()
	case *TUnlink_Google:
		query = `UPDATE users SET google_id = NULL, updated_at = $3
WHERE id = $1
AND google_id = $2
AND ((facebook_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetGoogle()
	case *TUnlink_GameCenter:
		query = `UPDATE users SET gamecenter_id = NULL, updated_at = $3
WHERE id = $1
AND gamecenter_id = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetGameCenter()
	case *TUnlink_Steam:
		query = `UPDATE users SET steam_id = NULL, updated_at = $3
WHERE id = $1
AND steam_id = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR email IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetSteam()
	case *TUnlink_Email:
		query = `UPDATE users SET email = NULL, password = NULL, updated_at = $3
WHERE id = $1
AND email = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = strings.ToLower(envelope.GetUnlink().GetEmail())
	case *TUnlink_Custom:
		query = `UPDATE users SET custom_id = NULL, updated_at = $3
WHERE id = $1
AND custom_id = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetCustom()
	default:
		logger.Error("Could not unlink", zap.String("error", "Invalid payload"))
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid payload"), true)
		return
	}

	res, err := p.db.Exec(query, session.UserID(), param, nowMs())

	if err != nil {
		logger.Warn("Could not unlink", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not unlink"), true)
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_DISALLOWED, "Check profile exists and is not last link"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}
