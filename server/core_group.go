package server

import (
	"go.uber.org/zap"
	"strings"
	"github.com/satori/go.uuid"
	"strconv"
	"encoding/json"
	"database/sql"
	"errors"
	"golang.org/x/tools/go/gcimporter15/testdata"
)

func extractGroup(r scanner) (*Group, error) {
	var id []byte
	var creatorID []byte
	var name sql.NullString
	var description sql.NullString
	var avatarURL sql.NullString
	var lang sql.NullString
	var utcOffsetMs sql.NullInt64
	var metadata []byte
	var state sql.NullInt64
	var count sql.NullInt64
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64

	err := r.Scan(&id, &creatorID, &name,
		&description, &avatarURL, &lang,
		&utcOffsetMs, &metadata, &state,
		&count, &createdAt, &updatedAt)

	if err != nil {
		return &Group{}, err
	}

	desc := ""
	if description.Valid {
		desc = description.String
	}

	avatar := ""
	if avatarURL.Valid {
		avatar = avatarURL.String
	}

	private := state.Int64 == 1

	return &Group{
		Id:          id,
		CreatorId:   creatorID,
		Name:        name.String,
		Description: desc,
		AvatarUrl:   avatar,
		Lang:        lang.String,
		UtcOffsetMs: utcOffsetMs.Int64,
		Metadata:    metadata,
		Private:     private,
		Count:       count.Int64,
		CreatedAt:   createdAt.Int64,
		UpdatedAt:   updatedAt.Int64,
	}, nil
}

func groupCreate(logger *zap.Logger, db *sql.DB, session *session, envelope *Envelope) {
	e := envelope.GetGroupsCreate()

	if len(e.Groups) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"))
		return
	} else if len(e.Groups) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	g := e.Groups[0]
	if g.Name == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group name is mandatory."))
		return
	}

	var group *Group

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not create group", zap.Error(err))
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Could not create group"))
		return
	}

	defer func() {
		if err != nil {
			logger.Error("Could not create group", zap.Error(err))
			if tx != nil {
				txErr := tx.Rollback()
				if txErr != nil {
					logger.Error("Could not rollback transaction", zap.Error(txErr))
				}
			}
			if strings.HasSuffix(err.Error(), "violates unique constraint \"groups_name_key\"") {
				session.Send(ErrorMessage(envelope.CollationId, GROUP_NAME_INUSE, "Name is in use"))
			} else {
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not create group"))
			}
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not create group"))
			} else {
				logger.Info("Created new group", zap.String("name", group.Name))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Group{Group: &TGroup{Group: group}}})
			}
		}
	}()

	state := 0
	if g.Private {
		state = 1
	}

	columns := make([]string, 0)
	params := make([]string, 0)
	values := make([]interface{}, 5)

	updatedAt := nowMs()

	values[0] = uuid.NewV4().Bytes()
	values[1] = session.userID.Bytes()
	values[2] = g.Name
	values[3] = state
	values[4] = updatedAt

	if g.Description != "" {
		columns = append(columns, "description")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Description)
	}

	if g.AvatarUrl != "" {
		columns = append(columns, "avatar_url")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.AvatarUrl)
	}

	if g.Lang != "" {
		columns = append(columns, "lang")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Lang)
	}

	if g.Metadata != nil {
		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal(g.Metadata, &maybeJSON) != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Metadata must be a valid JSON object"))
			return
		}

		columns = append(columns, "metadata")
		params = append(params, "$"+strconv.Itoa(len(values)))
		values = append(values, g.Metadata)
	}

	r := tx.QueryRow(`
INSERT INTO groups (id, creator_id, name, state, count, created_at, updated_at, `+strings.Join(columns, ", ")+")"+`
VALUES ($1, $2, $3, $4, 1, $5, $5, `+strings.Join(params, ",")+")"+`
RETURNING id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at
`, values...)

	group, err = extractGroup(r)
	if err != nil {
		return
	}

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
VALUES ($1, $2, $2, $3, 0), ($3, $2, $2, $1, 0)`,
		group.Id, updatedAt, session.userID.Bytes())

	if err != nil {
		return
	}

	rowAffected, err := res.RowsAffected()
	if err != nil {
		return
	}
	if rowAffected == 0 {
		err = errors.New("Could not insert into group_edge table")
		return
	}
}
