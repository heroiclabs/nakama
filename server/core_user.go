// Copyright 2018 The Nakama Authors
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
	"context"
	"database/sql"
	"fmt"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func GetUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, ids, usernames, fbIDs []string) (*api.Users, error) {
	query := `
SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata,
	apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
FROM users
WHERE`

	params := make([]any, 0)
	counter := 1
	useSQLOr := false

	if len(ids) > 0 {
		params = append(params, ids)
		query = query + fmt.Sprintf(" id = ANY($%d)", counter)
		counter++
		useSQLOr = true
	}

	if len(usernames) > 0 {
		params = append(params, usernames)
		if useSQLOr {
			query = query + " OR"
		}
		query = query + fmt.Sprintf(" username = ANY($%d::text[])", counter)
		counter++
		useSQLOr = true
	}

	if len(fbIDs) > 0 {
		params = append(params, fbIDs)
		if useSQLOr {
			query = query + " OR"
		}
		query = query + fmt.Sprintf(" facebook_id = ANY($%d::text[])", counter)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
		return nil, err
	}

	users := &api.Users{Users: make([]*api.User, 0)}
	for rows.Next() {
		user, err := convertUser(rows)
		if err != nil {
			_ = rows.Close()
			logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
			return nil, err
		}
		users.Users = append(users.Users, user)
	}
	_ = rows.Close()
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
		return nil, err
	}

	statusRegistry.FillOnlineUsers(users.Users)

	return users, nil
}

func GetRandomUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, count int) ([]*api.User, error) {
	if count == 0 {
		return []*api.User{}, nil
	}

	query := `
SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata,
	apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
FROM users
WHERE id > $1
LIMIT $2`
	rows, err := db.QueryContext(ctx, query, uuid.Must(uuid.NewV4()).String(), count)
	if err != nil {
		logger.Error("Error retrieving random user accounts.", zap.Error(err))
		return nil, err
	}
	users := make([]*api.User, 0, count)
	for rows.Next() {
		user, err := convertUser(rows)
		if err != nil {
			_ = rows.Close()
			logger.Error("Error retrieving random user accounts.", zap.Error(err))
			return nil, err
		}
		users = append(users, user)
	}
	_ = rows.Close()

	if len(users) < count {
		// Need more users.
		rows, err = db.QueryContext(ctx, query, uuid.Nil.String(), count)
		if err != nil {
			logger.Error("Error retrieving random user accounts.", zap.Error(err))
			return nil, err
		}
		for rows.Next() {
			user, err := convertUser(rows)
			if err != nil {
				_ = rows.Close()
				logger.Error("Error retrieving random user accounts.", zap.Error(err))
				return nil, err
			}
			var found bool
			for _, existing := range users {
				if existing.Id == user.Id {
					found = true
					break
				}
			}
			if !found {
				users = append(users, user)
			}
			if len(users) >= count {
				break
			}
		}
		_ = rows.Close()
	}

	statusRegistry.FillOnlineUsers(users)

	return users, nil
}

func DeleteUser(ctx context.Context, tx *sql.Tx, userID uuid.UUID) (int64, error) {
	res, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return 0, err
	}

	return res.RowsAffected()
}

func BanUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, sessionCache SessionCache, sessionRegistry SessionRegistry, tracker Tracker, ids []uuid.UUID) error {
	query := "UPDATE users SET disable_time = now() WHERE id = ANY($1::UUID[])"
	_, err := db.ExecContext(ctx, query, ids)
	if err != nil {
		logger.Error("Error banning user accounts.", zap.Error(err), zap.Any("ids", ids))
		return err
	}

	sessionCache.Ban(ids)

	for _, id := range ids {
		// Disconnect.
		for _, presence := range tracker.ListPresenceIDByStream(PresenceStream{Mode: StreamModeNotifications, Subject: id}) {
			if err = sessionRegistry.Disconnect(ctx, presence.SessionID, true); err != nil {
				return err
			}
		}
	}

	return nil
}

func UnbanUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, sessionCache SessionCache, ids []uuid.UUID) error {
	query := "UPDATE users SET disable_time = '1970-01-01 00:00:00 UTC' WHERE id = ANY($1::UUID[])"
	_, err := db.ExecContext(ctx, query, ids)
	if err != nil {
		logger.Error("Error unbanning user accounts.", zap.Error(err), zap.Any("ids", ids))
		return err
	}

	sessionCache.Unban(ids)

	return nil
}

func UserExistsAndDoesNotBlock(ctx context.Context, db *sql.DB, checkUserID, blocksUserID uuid.UUID) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx, `
SELECT COUNT(id) FROM users
WHERE id = $1::UUID AND NOT EXISTS (
	SELECT state FROM user_edge
	WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state = 3
)
`, checkUserID, blocksUserID).Scan(&count)

	return count != 0, err
}

func convertUser(rows *sql.Rows) (*api.User, error) {
	var id string
	var displayName sql.NullString
	var username sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata []byte
	var apple sql.NullString
	var facebook sql.NullString
	var facebookInstantGame sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var edgeCount int
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz

	err := rows.Scan(&id, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
		&apple, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &edgeCount, &createTime, &updateTime)
	if err != nil {
		return nil, err
	}

	userID := uuid.FromStringOrNil(id)
	return &api.User{
		Id:                    userID.String(),
		Username:              username.String,
		DisplayName:           displayName.String,
		AvatarUrl:             avatarURL.String,
		LangTag:               langTag.String,
		Location:              location.String,
		Timezone:              timezone.String,
		Metadata:              string(metadata),
		AppleId:               apple.String,
		FacebookId:            facebook.String,
		FacebookInstantGameId: facebookInstantGame.String,
		GoogleId:              google.String,
		GamecenterId:          gamecenter.String,
		SteamId:               steam.String,
		EdgeCount:             int32(edgeCount),
		CreateTime:            &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
		UpdateTime:            &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
		// Online filled later.
	}, nil
}

func fetchUserID(ctx context.Context, db *sql.DB, usernames []string) ([]string, error) {
	ids := make([]string, 0, len(usernames))
	if len(usernames) == 0 {
		return ids, nil
	}

	query := "SELECT id FROM users WHERE username = ANY($1::text[])"
	rows, err := db.QueryContext(ctx, query, usernames)
	if err != nil {
		if err == sql.ErrNoRows {
			return ids, nil
		}
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		err := rows.Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	return ids, nil
}
