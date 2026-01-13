// Copyright 2019 The Nakama Authors
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
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var usernameRegex = regexp.MustCompile("^[a-zA-Z0-9][a-zA-Z0-9._].*[a-zA-Z0-9]$")

type UserInvitationClaims struct {
	Id        string `json:"uid,omitempty"`
	Username  string `json:"usn,omitempty"`
	Email     string `json:"ema,omitempty"`
	ExpiresAt int64  `json:"exp,omitempty"`
	IssuedAt  int64  `json:"iat,omitempty"`
}

func (s *UserInvitationClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.ExpiresAt, 0)), nil
}
func (s *UserInvitationClaims) GetNotBefore() (*jwt.NumericDate, error) {
	return nil, nil
}
func (s *UserInvitationClaims) GetIssuedAt() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.IssuedAt, 0)), nil
}
func (s *UserInvitationClaims) GetAudience() (jwt.ClaimStrings, error) {
	return []string{}, nil
}
func (s *UserInvitationClaims) GetIssuer() (string, error) {
	return "", nil
}
func (s *UserInvitationClaims) GetSubject() (string, error) {
	return s.Id, nil
}

func (s *ConsoleServer) AddUser(ctx context.Context, in *console.AddUserRequest) (*console.AddUserResponse, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	uname := ctx.Value(ctxConsoleUsernameKey{}).(string)
	if uname == in.Username {
		return nil, status.Error(codes.FailedPrecondition, "Cannot change own configuration")
	}

	if in.Username == "" {
		return nil, status.Error(codes.InvalidArgument, "Username is required")
	} else if len(in.Username) < 3 || len(in.Username) > 20 || !usernameRegex.MatchString(in.Username) {
		return nil, status.Error(codes.InvalidArgument, "Username must be 3-20 long sequence of alphanumeric characters _ or . and cannot start and end with _ or .")
	}
	in.Username = strings.ToLower(in.Username)

	if in.Username == "admin" || in.Username == s.config.GetConsole().Username {
		return nil, status.Error(codes.InvalidArgument, "Username cannot be the console configured username")
	}

	if in.Email == "" {
		return nil, status.Error(codes.InvalidArgument, "Email is required")
	} else if len(in.Email) < 3 || len(in.Email) > 254 || !emailRegex.MatchString(in.Email) || invalidCharsRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Not a valid email address")
	}
	in.Email = strings.ToLower(in.Email)

	inviterUsername := ctx.Value(ctxConsoleUsernameKey{}).(string)
	inviterEmail := ctx.Value(ctxConsoleEmailKey{}).(string)
	payload := map[string]interface{}{
		"email":            in.Email,
		"username":         in.Username,
		"cookie":           s.cookie,
		"inviter_username": inviterUsername,
		"inviter_email":    inviterEmail,
		"newsletter":       in.NewsletterSubscription,
	}

	if payloadJson, err := json.Marshal(payload); err != nil {
		logger.Debug("Failed to create newsletter request payload.", zap.Error(err))
	} else {
		if req, err := http.NewRequest(http.MethodPost, "https://cloud.heroiclabs.com/v1/nakama-newsletter/subscribe", bytes.NewBuffer(payloadJson)); err != nil {
			logger.Debug("Failed to create newsletter request.", zap.Error(err))
		} else {
			req.Header.Set("Content-Type", "application/json")
			if resp, err := s.httpClient.Do(req); err != nil {
				logger.Debug("Failed to add newsletter subscription.", zap.Error(err))
			} else {
				logger.Debug("Added newsletter subscription.", zap.Int("status", resp.StatusCode))
			}
		}
	}

	user, err := s.dbInsertConsoleUser(ctx, logger, in)
	if err != nil {
		if _, ok := status.FromError(err); ok {
			return nil, err
		} else {
			logger.Error("failed to insert console user", zap.Error(err), zap.String("username", in.Username), zap.String("email", in.Email))
			return nil, status.Error(codes.Internal, "Internal Server Error")
		}
	}

	token, err := generateJWTToken(
		s.config.GetConsole().SigningKey,
		&UserInvitationClaims{
			Id:        user.Id,
			Username:  in.Username,
			Email:     in.Email,
			ExpiresAt: user.CreateTime.AsTime().Add(time.Duration(s.config.GetConsole().TokenExpirySec) * time.Second).Unix(),
			IssuedAt:  user.CreateTime.AsTime().UTC().Unix(),
		},
	)
	if err != nil {
		logger.Error("failed to generate console user token", zap.Error(err), zap.String("username", in.Username), zap.String("email", in.Email))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}

	return &console.AddUserResponse{User: user, Token: token}, nil
}

func (s *ConsoleServer) dbInsertConsoleUser(ctx context.Context, logger *zap.Logger, in *console.AddUserRequest) (*console.User, error) {
	id, err := uuid.NewV4()
	if err != nil {
		return nil, err
	}

	userAcl := acl.New(in.Acl)
	if userAcl.IsNone() {
		return nil, status.Error(codes.InvalidArgument, "User must have at least some permissions.")
	}

	userAclJson, err := userAcl.ToJson()
	if err != nil {
		logger.Error("failed to json marshal acl", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error creating console user.")
	}

	var createTime *time.Time
	var updateTime *time.Time
	updated := false
	mfaEnabled := false
	query := `INSERT INTO console_user (id, username, email, acl, mfa_required) VALUES ($1, $2, $3, $4, $5)
						ON CONFLICT (username) DO
						UPDATE SET acl = $4, mfa_required = $5, update_time = now()
						RETURNING id, create_time, update_time, create_time != update_time AS updated, mfa_secret IS NOT NULL AS mfa_enabled`
	err = s.db.QueryRowContext(ctx, query, id.String(), in.Username, in.Email, userAclJson, in.MfaRequired).Scan(&id, &createTime, &updateTime, &updated, &mfaEnabled)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == dbErrorUniqueViolation {
				return nil, status.Error(codes.FailedPrecondition, "Username or Email already exists")
			}
		}
		return nil, err
	}

	if updated {
		s.sessionCache.RemoveAll(id)
	}

	user := &console.User{
		Id:          id.String(),
		Username:    in.Username,
		Email:       in.Email,
		Acl:         in.Acl,
		MfaRequired: in.MfaRequired,
		MfaEnabled:  mfaEnabled,
		CreateTime:  timestamppb.New(*createTime),
		UpdateTime:  timestamppb.New(*updateTime),
	}

	return user, nil
}

func (s *ConsoleServer) GetUser(ctx context.Context, in *console.Username) (*console.User, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	users, err := s.dbListConsoleUsers(ctx, []string{in.Username})
	if err != nil {
		logger.Error("failed to list console users", zap.Error(err))
		return nil, err
	}

	if len(users) == 0 {
		return nil, status.Error(codes.NotFound, "User not found")
	}

	return users[0], nil
}

func (s *ConsoleServer) UpdateUser(ctx context.Context, in *console.UpdateUserRequest) (*console.User, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	creatorRole := ctx.Value(ctxConsoleUserAclKey{}).(acl.Permission)
	uname := ctx.Value(ctxConsoleUsernameKey{}).(string)

	if in.Username == uname {
		return nil, status.Error(codes.FailedPrecondition, "Cannot change own configuration")
	}

	role := acl.New(in.Acl)
	if !creatorRole.HasAccess(role) {
		return nil, status.Error(codes.InvalidArgument, "Cannot create users with more permissions that the one in session.")
	}

	var update *console.User

	if err := ExecuteInTx(ctx, s.db, func(tx *sql.Tx) error {
		var err error
		update, _, err = updateUser(ctx, logger, tx, in)
		if err != nil {
			return err
		}

		return nil
	}); err != nil {
		return nil, err
	}

	s.consoleSessionCache.RemoveAll(uuid.Must(uuid.FromString(update.Id)))

	return update, nil
}

func updateUser(ctx context.Context, logger *zap.Logger, tx *sql.Tx, in *console.UpdateUserRequest) (*console.User, *console.UpdateUserRequest, error) {
	var email string
	var createTime, updateTime time.Time
	var prevAclBytes []byte
	var id uuid.UUID
	var mfaEnabled, mfaRequired bool
	role := acl.New(in.Acl)
	if role.IsNone() {
		return nil, nil, status.Error(codes.InvalidArgument, "User must have at least some permissions.")
	}
	roleJson, err := role.ToJson()
	if err != nil {
		logger.Error("failed to json marshal acl", zap.Error(err))
		return nil, nil, status.Error(codes.Internal, "Error updating console user.")
	}
	query := `
			UPDATE console_user new
			SET acl = $1, update_time = now()
			FROM (SELECT id, username, acl FROM console_user WHERE username = $2) old WHERE old.username = new.username
			RETURNING new.id,	old.acl, new.email, new.create_time, new.update_time, new.mfa_secret IS NOT NULL AS mfa_enabled, new.mfa_required`

	if err := tx.QueryRowContext(ctx, query, roleJson, in.Username).Scan(&id, &prevAclBytes, &email, &createTime, &updateTime, &mfaEnabled, &mfaRequired); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, status.Error(codes.NotFound, "User not found.")
		}
		logger.Error("Error updating user.", zap.Error(err))
		return nil, nil, status.Error(codes.Internal, "An error occurred while trying to update the user.")
	}

	prevAcl, err := acl.NewFromJson(string(prevAclBytes))
	if err != nil {
		logger.Error("failed to json unmarshal acl", zap.Error(err))
		return nil, nil, status.Error(codes.Internal, "Error updating console user.")
	}

	undoReq := &console.UpdateUserRequest{
		Username: in.Username,
		Acl:      prevAcl.ACL(),
	}
	update := &console.User{
		Id:          id.String(),
		Username:    in.Username,
		Email:       email,
		Acl:         role.ACL(),
		MfaRequired: mfaRequired,
		MfaEnabled:  mfaEnabled,
		CreateTime:  timestamppb.New(createTime),
		UpdateTime:  timestamppb.New(updateTime),
	}

	return update, undoReq, nil
}

func (s *ConsoleServer) ResetUserPassword(ctx context.Context, in *console.Username) (*console.ResetUserResponse, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)

	var token, email string

	transaction := func(tx *sql.Tx) error {
		password := make([]byte, 32)
		if _, err := rand.Read(password); err != nil {
			logger.Error("Failed to generate a temporary password for the user.", zap.Error(err))
			return status.Error(codes.Internal, "Failed to generate a temporary password for the user.")
		}

		hashedPassword, err := bcrypt.GenerateFromPassword(password, bcryptHashCost)
		if err != nil {
			logger.Error("Failed to hash the temporary password for the user.", zap.Error(err))
			return status.Error(codes.Internal, "Failed to hash the temporary password for the user.")
		}

		var uid uuid.UUID
		var username string
		var updateTime pgtype.Timestamptz
		if err := tx.QueryRowContext(ctx, `UPDATE console_user SET password = $1, update_time = NOW() WHERE username = $2 RETURNING id, username, email, update_time`, hashedPassword, in.Username).Scan(&uid, &username, &email, &updateTime); err != nil {
			return status.Error(codes.NotFound, "User not found.")
		}

		config := s.config.GetConsole()
		tokenTime := updateTime.Time.UTC()

		token, err = generateJWTToken(
			config.SigningKey,
			&UserInvitationClaims{
				Id:        uid.String(),
				Username:  username,
				Email:     email,
				ExpiresAt: tokenTime.Add(time.Duration(config.TokenExpirySec) * time.Second).Unix(),
				IssuedAt:  tokenTime.UTC().Unix(),
			},
		)
		if err != nil {
			logger.Error("Failed generate one-time code to reconfigure the user's password.", zap.Error(err))
			return status.Errorf(codes.Internal, "Failed generate one-time code to reconfigure the user's password.")
		}

		return nil
	}
	if err := ExecuteInTx(ctx, s.db, transaction); err != nil {
		return nil, err
	}

	return &console.ResetUserResponse{Code: token}, nil
}

func (s *ConsoleServer) DeleteUser(ctx context.Context, in *console.Username) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	uname := ctx.Value(ctxConsoleUsernameKey{}).(string)

	if in.Username == uname {
		return nil, status.Error(codes.FailedPrecondition, "Cannot delete own user")
	}

	deleted, id, err := s.dbDeleteConsoleUser(ctx, in.Username)
	if err != nil {
		logger.Error("failed to delete console user", zap.Error(err), zap.String("username", in.Username))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	} else if !deleted {
		return nil, status.Error(codes.InvalidArgument, "User not found")
	}
	s.consoleSessionCache.RemoveAll(id)

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) ListUsers(ctx context.Context, in *emptypb.Empty) (*console.UserList, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	users, err := s.dbListConsoleUsers(ctx, nil)
	if err != nil {
		logger.Error("failed to list console users", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}
	return &console.UserList{Users: users}, nil
}

func (s *ConsoleServer) dbListConsoleUsers(ctx context.Context, usernames []string) ([]*console.User, error) {
	result := make([]*console.User, 0, 10)
	query := "SELECT id, username, email, acl, mfa_required, mfa_secret IS NOT NULL AS mfa_enabled, create_time, update_time FROM console_user WHERE id != $1"
	params := []any{uuid.Nil}
	if len(usernames) > 0 {
		query += " AND username = ANY($2)"
		params = append(params, usernames)
	}
	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		user := &console.User{}
		var createTime, updateTime time.Time
		var aclBytes []byte
		if err := rows.Scan(&user.Id, &user.Username, &user.Email, &aclBytes, &user.MfaRequired, &user.MfaEnabled, &createTime, &updateTime); err != nil {
			_ = rows.Close()
			return nil, err
		}
		user.CreateTime = timestamppb.New(createTime)
		user.UpdateTime = timestamppb.New(updateTime)
		userAcl, err := acl.NewFromJson(string(aclBytes))
		if err != nil {
			return nil, err
		}
		user.Acl = userAcl.ACL()
		result = append(result, user)
	}
	_ = rows.Close()

	return result, nil
}

func (s *ConsoleServer) dbDeleteConsoleUser(ctx context.Context, username string) (bool, uuid.UUID, error) {
	var deletedID uuid.UUID
	if err := s.db.QueryRowContext(ctx, "DELETE FROM console_user WHERE username = $1 RETURNING id", username).Scan(&deletedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, uuid.Nil, nil
		}
		return false, uuid.Nil, err
	}
	return true, deletedID, nil
}

func (s *ConsoleServer) RequireUserMfa(ctx context.Context, in *console.RequireUserMfaRequest) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if _, err := s.db.ExecContext(ctx, "UPDATE console_user SET mfa_required = $1 WHERE username = $2", in.Required, in.Username); err != nil {
		logger.Error("failed to change required value for user MFA", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}

	return nil, nil
}

func (s *ConsoleServer) ResetUserMfa(ctx context.Context, in *console.ResetUserMfaRequest) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if _, err := s.db.ExecContext(ctx, "UPDATE console_user SET mfa_secret = NULL, mfa_recovery_codes = NULL WHERE username = $1", in.Username); err != nil {
		logger.Error("failed to reset user MFA", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}

	return &emptypb.Empty{}, nil
}

type UserMFASetupToken struct {
	UserID      string `json:"user_id,omitempty"`
	UserEmail   string `json:"user_email,omitempty"`
	ExpiryTime  int64  `json:"exp,omitempty"`
	CreateTime  int64  `json:"crt,omitempty"`
	MFASecret   string `json:"secret,omitempty"`
	MFAUrl      string `json:"mfa_url,omitempty"`
	MFARequired bool   `json:"mfa_required,omitempty"`
}

func (s *UserMFASetupToken) GetExpirationTime() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.ExpiryTime, 0)), nil
}
func (s *UserMFASetupToken) GetNotBefore() (*jwt.NumericDate, error) {
	return nil, nil
}
func (s *UserMFASetupToken) GetIssuedAt() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(s.CreateTime, 0)), nil
}
func (s *UserMFASetupToken) GetAudience() (jwt.ClaimStrings, error) {
	return []string{}, nil
}
func (s *UserMFASetupToken) GetIssuer() (string, error) {
	return "", nil
}
func (s *UserMFASetupToken) GetSubject() (string, error) {
	return "", nil
}
