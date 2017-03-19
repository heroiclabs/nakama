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

	"github.com/uber-go/zap"
	"golang.org/x/crypto/bcrypt"
)

func (p *pipeline) linkID(logger zap.Logger, session *session, envelope *Envelope) {
	// Route to correct link handler
	switch envelope.GetLink().Payload.(type) {
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
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_PAYLOAD, "Invalid payload"))
		return
	}
}

func (p *pipeline) linkDevice(logger zap.Logger, session *session, envelope *Envelope) {
	deviceID := envelope.GetLink().GetDevice()
	if deviceID == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_ID, "Device ID is required"))
		return
	} else if invalidCharsRegex.MatchString(deviceID) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_ID, "Invalid device ID, no spaces or control characters allowed"))
		return
	} else if len(deviceID) < 10 || len(deviceID) > 36 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_ID, "Invalid device ID, must be 10-36 bytes"))
		return
	}

	txn, err := p.db.Begin()
	if err != nil {
		logger.Warn("Could not link, transaction begin error", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}
	res, err := txn.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, session.userID.Bytes())
	if err != nil {
		logger.Warn("Could not link, query error", zap.Error(err))
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}
	if count, _ := res.RowsAffected(); count == 0 {
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}
	res, err = txn.Exec("UPDATE users SET updated_at = $1 WHERE id = $2", nowMs(), session.userID.Bytes())
	if err != nil {
		logger.Warn("Could not link, query error", zap.Error(err))
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}
	if count, _ := res.RowsAffected(); count == 0 {
		err = txn.Rollback()
		if err != nil {
			logger.Warn("Could not link, transaction rollback error", zap.Error(err))
		}
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}
	err = txn.Commit()
	if err != nil {
		logger.Warn("Could not register, transaction commit error", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkFacebook(logger zap.Logger, session *session, envelope *Envelope) {
	accessToken := envelope.GetLink().GetFacebook()
	if accessToken == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_TOKEN, "Access token is required"))
		return
	} else if invalidCharsRegex.MatchString(accessToken) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_TOKEN, "Invalid Facebook access token, no spaces or control characters allowed"))
		return
	}

	fbProfile, err := p.socialClient.GetFacebookProfile(accessToken)
	if err != nil {
		logger.Warn("Could not get Facebook profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_PROFILE_FAILED, "Could not get Facebook profile"))
		return
	}

	userID := session.userID.Bytes()

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
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Facebook ID in use"))
		return
	}

	p.addFacebookFriends(logger, userID, accessToken)

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkGoogle(logger zap.Logger, session *session, envelope *Envelope) {
	accessToken := envelope.GetLink().GetGoogle()
	if accessToken == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_TOKEN, "Access token is required"))
		return
	} else if invalidCharsRegex.MatchString(accessToken) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_TOKEN, "Invalid Google access token, no spaces or control characters allowed"))
		return
	}

	googleProfile, err := p.socialClient.GetGoogleProfile(accessToken)
	if err != nil {
		logger.Warn("Could not get Google profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_PROFILE_FAILED, "Could not get Google profile"))
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
		session.userID.Bytes(),
		googleProfile.ID,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Google ID in use"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkGameCenter(logger zap.Logger, session *session, envelope *Envelope) {
	gc := envelope.GetLink().GetGameCenter()
	if gc == nil || gc.PlayerId == "" || gc.BundleId == "" || gc.Timestamp == 0 || gc.Salt == "" || gc.Signature == "" || gc.PublicKeyUrl == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_TOKEN, "Game Center credentials required"))
		return
	}

	_, err := p.socialClient.CheckGameCenterID(gc.PlayerId, gc.BundleId, gc.Timestamp, gc.Salt, gc.Signature, gc.PublicKeyUrl)
	if err != nil {
		logger.Warn("Could not get Game Center profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_PROFILE_FAILED, "Could not get Game Center profile"))
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
		session.userID.Bytes(),
		gc.PlayerId,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Game Center ID in use"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkSteam(logger zap.Logger, session *session, envelope *Envelope) {
	if p.config.GetSocial().Steam.PublisherKey == "" || p.config.GetSocial().Steam.AppID == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_PROVIDER_UNAVAILABLE, "Steam link not available"))
		return
	}

	ticket := envelope.GetLink().GetSteam()
	if ticket == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_TOKEN, "Steam ticket is required"))
		return
	} else if invalidCharsRegex.MatchString(ticket) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_TOKEN, "Invalid Steam ticket, no spaces or control characters allowed"))
		return
	}

	steamProfile, err := p.socialClient.GetSteamProfile(p.config.GetSocial().Steam.PublisherKey, p.config.GetSocial().Steam.AppID, ticket)
	if err != nil {
		logger.Warn("Could not get Steam profile", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_PROFILE_FAILED, "Could not get Steam profile"))
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
		session.userID.Bytes(),
		strconv.FormatUint(steamProfile.SteamID, 10),
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Steam ID in use"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkEmail(logger zap.Logger, session *session, envelope *Envelope) {
	email := envelope.GetLink().GetEmail()
	if email == nil {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_PAYLOAD, "Invalid payload"))
		return
	} else if email.Email == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_EMAIL, "Email address is required"))
		return
	} else if invalidCharsRegex.MatchString(email.Email) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_EMAIL, "Invalid email address, no spaces or control characters allowed"))
		return
	} else if !emailRegex.MatchString(email.Email) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_EMAIL, "Invalid email address format"))
		return
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_EMAIL, "Invalid email address, must be 10-255 bytes"))
		return
	} else if len(email.Password) < 8 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_EMAIL, "Password must be longer than 8 characters"))
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
		session.userID.Bytes(),
		email.Email,
		hashedPassword,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Email address in use"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) linkCustom(logger zap.Logger, session *session, envelope *Envelope) {
	customID := envelope.GetLink().GetCustom()
	if customID == "" {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_MISSING_ID, "Custom ID is required"))
		return
	} else if invalidCharsRegex.MatchString(customID) {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_ID, "Invalid custom ID, no spaces or control characters allowed"))
		return
	} else if len(customID) < 10 || len(customID) > 64 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_BAD_ID, "Invalid custom ID, must be 10-64 bytes"))
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
		session.userID.Bytes(),
		customID,
		nowMs())

	if err != nil {
		logger.Warn("Could not link", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED, "Could not link"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_LINK_FAILED_IN_USE, "Custom ID in use"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) unlinkID(logger zap.Logger, session *session, envelope *Envelope) {
	// Select correct unlink query
	var query string
	var param interface{}
	switch envelope.GetUnlink().Payload.(type) {
	case *TUnlink_Device:
		txn, err := p.db.Begin()
		if err != nil {
			logger.Warn("Could not unlink, transaction begin error", zap.Error(err))
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED, "Could not unlink"))
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
			session.userID.Bytes(),
			envelope.GetUnlink().GetDevice())
		if err != nil {
			logger.Warn("Could not unlink, query error", zap.Error(err))
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED, "Could not unlink"))
			return
		}
		if count, _ := res.RowsAffected(); count == 0 {
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_PROHIBITED, "Check profile exists and is not last link"))
			return
		}
		res, err = txn.Exec("UPDATE users SET updated_at = $2 WHERE id = $1", session.userID.Bytes(), nowMs())
		if err != nil {
			logger.Warn("Could not unlink, query error", zap.Error(err))
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED, "Could not unlink"))
			return
		}
		if count, _ := res.RowsAffected(); count == 0 {
			err = txn.Rollback()
			if err != nil {
				logger.Warn("Could not unlink, transaction rollback error", zap.Error(err))
			}
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_PROHIBITED, "Check profile exists and is not last link"))
			return
		}
		err = txn.Commit()
		if err != nil {
			logger.Warn("Could not unlink, transaction commit error", zap.Error(err))
			session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED, "Could not unlink"))
			return
		}

		session.Send(&Envelope{CollationId: envelope.CollationId})
		return
	case *TUnlink_Facebook:
		query = `UPDATE users SET facebook_id = NULL, updated_at = $3
WHERE id = $1
AND custom_id = $2
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
AND custom_id = $2
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
AND custom_id = $2
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
AND custom_id = $2
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
AND custom_id = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`
		param = envelope.GetUnlink().GetEmail()
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
		session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED_BAD_PAYLOAD, "Invalid payload"))
		return
	}

	res, err := p.db.Exec(query, session.userID.Bytes(), param, nowMs())

	if err != nil {
		logger.Warn("Could not unlink", zap.Error(err))
		session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_FAILED, "Could not unlink"))
		return
	} else if count, _ := res.RowsAffected(); count == 0 {
		session.Send(ErrorMessage(envelope.CollationId, USER_UNLINK_PROHIBITED, "Check profile exists and is not last link"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}
