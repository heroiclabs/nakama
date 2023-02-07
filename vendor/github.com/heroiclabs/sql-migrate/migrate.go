package migrate

import (
	"bytes"
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/heroiclabs/sql-migrate/sqlparse"
)

type MigrationDirection int

const (
	Up MigrationDirection = iota
	Down
)

// MigrationSet provides database parameters for a migration execution
type MigrationSet struct {
	// TableName name of the table used to store migration info.
	TableName string
	// IgnoreUnknown skips the check to see if there is a migration
	// ran in the database that is not in MigrationSource.
	//
	// This should be used sparingly as it is removing a safety check.
	IgnoreUnknown bool
	// DisableCreateTable disable the creation of the migration table
	DisableCreateTable bool
}

var migSet = MigrationSet{}

const DefaultMigrationTableName = "migration_info"

// NewMigrationSet returns a parametrized Migration object
func (ms MigrationSet) getTableName() string {
	if ms.TableName == "" {
		return DefaultMigrationTableName
	}
	return ms.TableName
}

var numberPrefixRegex = regexp.MustCompile(`^(\d+).*$`)

// PlanError happens where no migration plan could be created between the sets
// of already applied migrations and the currently found. For example, when the database
// contains a migration which is not among the migrations list found for an operation.
type PlanError struct {
	Migration    *Migration
	ErrorMessage string
}

func newPlanError(migration *Migration, errorMessage string) error {
	return &PlanError{
		Migration:    migration,
		ErrorMessage: errorMessage,
	}
}

func (p *PlanError) Error() string {
	return fmt.Sprintf("Unable to create migration plan because of %s: %s",
		p.Migration.Id, p.ErrorMessage)
}

// TxError is returned when any error is encountered during a database
// transaction. It contains the relevant *Migration and notes it's Id in the
// Error function output.
type TxError struct {
	Migration *Migration
	Err       error
}

func newTxError(migration *PlannedMigration, err error) error {
	return &TxError{
		Migration: migration.Migration,
		Err:       err,
	}
}

func (e *TxError) Error() string {
	return e.Err.Error() + " handling " + e.Migration.Id
}

// Set the name of the table used to store migration info.
//
// Should be called before any other call such as (Exec, ExecMax, ...).
func SetTable(name string) {
	if name != "" {
		migSet.TableName = name
	}
}

// SetDisableCreateTable sets the boolean to disable the creation of the migration table
func SetDisableCreateTable(disable bool) {
	migSet.DisableCreateTable = disable
}

// SetIgnoreUnknown sets the flag that skips database check to see if there is a
// migration in the database that is not in migration source.
//
// This should be used sparingly as it is removing a safety check.
func SetIgnoreUnknown(v bool) {
	migSet.IgnoreUnknown = v
}

type Migration struct {
	Id   string
	Up   []string
	Down []string

	DisableTransactionUp   bool
	DisableTransactionDown bool
}

func (m Migration) Less(other *Migration) bool {
	switch {
	case m.isNumeric() && other.isNumeric() && m.VersionInt() != other.VersionInt():
		return m.VersionInt() < other.VersionInt()
	case m.isNumeric() && !other.isNumeric():
		return true
	case !m.isNumeric() && other.isNumeric():
		return false
	default:
		return m.Id < other.Id
	}
}

func (m Migration) isNumeric() bool {
	return len(m.NumberPrefixMatches()) > 0
}

func (m Migration) NumberPrefixMatches() []string {
	return numberPrefixRegex.FindStringSubmatch(m.Id)
}

func (m Migration) VersionInt() int64 {
	v := m.NumberPrefixMatches()[1]
	value, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		panic(fmt.Sprintf("Could not parse %q into int64: %s", v, err))
	}
	return value
}

type PlannedMigration struct {
	*Migration

	DisableTransaction bool
	Queries            []string
}

type byId []*Migration

func (b byId) Len() int           { return len(b) }
func (b byId) Swap(i, j int)      { b[i], b[j] = b[j], b[i] }
func (b byId) Less(i, j int) bool { return b[i].Less(b[j]) }

type MigrationRecord struct {
	Id        string    `db:"id"`
	AppliedAt time.Time `db:"applied_at"`
}

type MigrationSource interface {
	// Finds the migrations.
	//
	// The resulting slice of migrations should be sorted by Id.
	FindMigrations() ([]*Migration, error)
}

// A hardcoded set of migrations, in-memory.
type MemoryMigrationSource struct {
	Migrations []*Migration
}

var _ MigrationSource = (*MemoryMigrationSource)(nil)

func (m MemoryMigrationSource) FindMigrations() ([]*Migration, error) {
	// Make sure migrations are sorted. In order to make the MemoryMigrationSource safe for
	// concurrent use we should not mutate it in place. So `FindMigrations` would sort a copy
	// of the m.Migrations.
	migrations := make([]*Migration, len(m.Migrations))
	copy(migrations, m.Migrations)
	sort.Sort(byId(migrations))
	return migrations, nil
}

// A set of migrations loaded from an http.FileServer

type HttpFileSystemMigrationSource struct {
	FileSystem http.FileSystem
}

var _ MigrationSource = (*HttpFileSystemMigrationSource)(nil)

func (f HttpFileSystemMigrationSource) FindMigrations() ([]*Migration, error) {
	return findMigrations(f.FileSystem, "/")
}

// A set of migrations loaded from a directory.
type FileMigrationSource struct {
	Dir string
}

var _ MigrationSource = (*FileMigrationSource)(nil)

func (f FileMigrationSource) FindMigrations() ([]*Migration, error) {
	filesystem := http.Dir(f.Dir)
	return findMigrations(filesystem, "/")
}

func findMigrations(dir http.FileSystem, root string) ([]*Migration, error) {
	migrations := make([]*Migration, 0)

	file, err := dir.Open(root)
	if err != nil {
		return nil, err
	}

	files, err := file.Readdir(0)
	if err != nil {
		return nil, err
	}

	for _, info := range files {
		if strings.HasSuffix(info.Name(), ".sql") {
			migration, err := migrationFromFile(dir, root, info)
			if err != nil {
				return nil, err
			}

			migrations = append(migrations, migration)
		}
	}

	// Make sure migrations are sorted
	sort.Sort(byId(migrations))

	return migrations, nil
}

func migrationFromFile(dir http.FileSystem, root string, info os.FileInfo) (*Migration, error) {
	path := path.Join(root, info.Name())
	file, err := dir.Open(path)
	if err != nil {
		return nil, fmt.Errorf("Error while opening %s: %s", info.Name(), err)
	}
	defer func() { _ = file.Close() }()

	migration, err := ParseMigration(info.Name(), file)
	if err != nil {
		return nil, fmt.Errorf("Error while parsing %s: %s", info.Name(), err)
	}
	return migration, nil
}

// Migrations from a bindata asset set.
type AssetMigrationSource struct {
	// Asset should return content of file in path if exists
	Asset func(path string) ([]byte, error)

	// AssetDir should return list of files in the path
	AssetDir func(path string) ([]string, error)

	// Path in the bindata to use.
	Dir string
}

var _ MigrationSource = (*AssetMigrationSource)(nil)

func (a AssetMigrationSource) FindMigrations() ([]*Migration, error) {
	migrations := make([]*Migration, 0)

	files, err := a.AssetDir(a.Dir)
	if err != nil {
		return nil, err
	}

	for _, name := range files {
		if strings.HasSuffix(name, ".sql") {
			file, err := a.Asset(path.Join(a.Dir, name))
			if err != nil {
				return nil, err
			}

			migration, err := ParseMigration(name, bytes.NewReader(file))
			if err != nil {
				return nil, err
			}

			migrations = append(migrations, migration)
		}
	}

	// Make sure migrations are sorted
	sort.Sort(byId(migrations))

	return migrations, nil
}

// Avoids pulling in the packr library for everyone, mimicks the bits of
// packr.Box that we need.
type PackrBox interface {
	List() []string
	Find(name string) ([]byte, error)
}

// Migration parsing
func ParseMigration(id string, r io.ReadSeeker) (*Migration, error) {
	m := &Migration{
		Id: id,
	}

	parsed, err := sqlparse.ParseMigration(r)
	if err != nil {
		return nil, fmt.Errorf("Error parsing migration (%s): %s", id, err)
	}

	m.Up = parsed.UpStatements
	m.Down = parsed.DownStatements

	m.DisableTransactionUp = parsed.DisableTransactionUp
	m.DisableTransactionDown = parsed.DisableTransactionDown

	return m, nil
}

// Execute a set of migrations
//
// Returns the number of applied migrations.
func Exec(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection) (int, error) {
	return ExecMax(ctx, db, m, dir, 0)
}

// Returns the number of applied migrations.
func (ms MigrationSet) Exec(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection) (int, error) {
	return ms.ExecMax(ctx, db, m, dir, 0)
}

// Execute a set of migrations
//
// Will apply at most `max` migrations. Pass 0 for no limit (or use Exec).
//
// Returns the number of applied migrations.
func ExecMax(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, max int) (int, error) {
	return migSet.ExecMax(ctx, db, m, dir, max)
}

// Execute a set of migrations
//
// Will apply at the target `version` of migration. Cannot be a negative value.
//
// Returns the number of applied migrations.
func ExecVersion(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, version int64) (int, error) {
	if version < 0 {
		return 0, fmt.Errorf("target version %d should not be negative", version)
	}
	return migSet.ExecVersion(ctx, db, m, dir, version)
}

// Returns the number of applied migrations.
func (ms MigrationSet) ExecMax(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, max int) (int, error) {
	migrations, err := ms.PlanMigration(ctx, db, m, dir, max)
	if err != nil {
		return 0, err
	}
	return ms.applyMigrations(ctx, db, dir, migrations)
}

// Returns the number of applied migrations.
func (ms MigrationSet) ExecVersion(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, version int64) (int, error) {
	migrations, err := ms.PlanMigrationToVersion(ctx, db, m, dir, version)
	if err != nil {
		return 0, err
	}
	return ms.applyMigrations(ctx, db, dir, migrations)
}

// Applies the planned migrations and returns the number of applied migrations.
func (ms MigrationSet) applyMigrations(ctx context.Context, db *pgx.Conn, dir MigrationDirection, migrations []*PlannedMigration) (int, error) {
	applied := 0

	for _, migration := range migrations {
		tx, err := db.Begin(ctx)
		if err != nil {
			return applied, fmt.Errorf("failed to init db transaction: %s", err.Error())
		}

		for _, stmt := range migration.Queries {
			if _, err = tx.Exec(ctx, stmt); err != nil {
				tx.Rollback(ctx)
				return applied, fmt.Errorf("failed to exec migration statement %q: %s", stmt, err.Error())
			}
		}

		switch dir {
		case Up:
			if _, err = tx.Exec(ctx, fmt.Sprintf("INSERT INTO %q (id, applied_at) VALUES ($1, now())", ms.TableName), migration.Id); err != nil {
				tx.Rollback(ctx)
				return applied, newTxError(migration, err)
			}
		case Down:
			if _, err = tx.Exec(ctx, fmt.Sprintf("DELETE FROM %q WHERE id = $1", ms.TableName), migration.Id); err != nil {
				tx.Rollback(ctx)
				return applied, newTxError(migration, err)
			}
		default:
			panic("Invalid direction")
		}

		if err := tx.Commit(ctx); err != nil {
			return applied, newTxError(migration, err)
		}

		applied++
	}

	return applied, nil
}

// Plan a migration.
func PlanMigration(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, max int) ([]*PlannedMigration, error) {
	return migSet.PlanMigration(ctx, db, m, dir, max)
}

// Plan a migration to version.
func PlanMigrationToVersion(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, version int64) ([]*PlannedMigration, error) {
	return migSet.PlanMigrationToVersion(ctx, db, m, dir, version)
}

// Plan a migration.
func (ms MigrationSet) PlanMigration(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, max int) ([]*PlannedMigration, error) {
	return ms.planMigrationCommon(ctx, db, m, dir, max, -1)
}

// Plan a migration to version.
func (ms MigrationSet) PlanMigrationToVersion(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, version int64) ([]*PlannedMigration, error) {
	return ms.planMigrationCommon(ctx, db, m, dir, 0, version)
}

// A common method to plan a migration.
func (ms MigrationSet) planMigrationCommon(ctx context.Context, db *pgx.Conn, m MigrationSource, dir MigrationDirection, max int, version int64) ([]*PlannedMigration, error) {
	if err := ms.createMigrationTable(ctx, db); err != nil {
		return nil, err
	}

	migrations, err := m.FindMigrations()
	if err != nil {
		return nil, err
	}

	migrationRecords, err := ms.GetMigrationRecords(ctx, db)
	if err != nil {
		return nil, err
	}

	// Sort migrations that have been run by Id.
	var existingMigrations []*Migration
	for _, migrationRecord := range migrationRecords {
		existingMigrations = append(existingMigrations, &Migration{
			Id: migrationRecord.Id,
		})
	}
	sort.Sort(byId(existingMigrations))

	// Make sure all migrations in the database are among the found migrations which
	// are to be applied.
	if !ms.IgnoreUnknown {
		migrationsSearch := make(map[string]struct{})
		for _, migration := range migrations {
			migrationsSearch[migration.Id] = struct{}{}
		}
		for _, existingMigration := range existingMigrations {
			if _, ok := migrationsSearch[existingMigration.Id]; !ok {
				return nil, newPlanError(existingMigration, "unknown migration in database")
			}
		}
	}

	// Get last migration that was run
	record := &Migration{}
	if len(existingMigrations) > 0 {
		record = existingMigrations[len(existingMigrations)-1]
	}

	result := make([]*PlannedMigration, 0)

	// Add missing migrations up to the last run migration.
	// This can happen for example when merges happened.
	if len(existingMigrations) > 0 {
		result = append(result, ToCatchup(migrations, existingMigrations, record)...)
	}

	// Figure out which migrations to apply
	toApply := ToApply(migrations, record.Id, dir)
	toApplyCount := len(toApply)

	if version >= 0 {
		targetIndex := 0
		for targetIndex < len(toApply) {
			tempVersion := toApply[targetIndex].VersionInt()
			if dir == Up && tempVersion > version || dir == Down && tempVersion < version {
				return nil, newPlanError(&Migration{}, fmt.Errorf("unknown migration with version id %d in database", version).Error())
			}
			if tempVersion == version {
				toApplyCount = targetIndex + 1
				break
			}
			targetIndex++
		}
		if targetIndex == len(toApply) {
			return nil, newPlanError(&Migration{}, fmt.Errorf("unknown migration with version id %d in database", version).Error())
		}
	} else if max > 0 && max < toApplyCount {
		toApplyCount = max
	}
	for _, v := range toApply[0:toApplyCount] {

		if dir == Up {
			result = append(result, &PlannedMigration{
				Migration:          v,
				Queries:            v.Up,
				DisableTransaction: v.DisableTransactionUp,
			})
		} else if dir == Down {
			result = append(result, &PlannedMigration{
				Migration:          v,
				Queries:            v.Down,
				DisableTransaction: v.DisableTransactionDown,
			})
		}
	}

	return result, nil
}

// Filter a slice of migrations into ones that should be applied.
func ToApply(migrations []*Migration, current string, direction MigrationDirection) []*Migration {
	var index = -1
	if current != "" {
		for index < len(migrations)-1 {
			index++
			if migrations[index].Id == current {
				break
			}
		}
	}

	if direction == Up {
		return migrations[index+1:]
	} else if direction == Down {
		if index == -1 {
			return []*Migration{}
		}

		// Add in reverse order
		toApply := make([]*Migration, index+1)
		for i := 0; i < index+1; i++ {
			toApply[index-i] = migrations[i]
		}
		return toApply
	}

	panic("Not possible")
}

func ToCatchup(migrations, existingMigrations []*Migration, lastRun *Migration) []*PlannedMigration {
	missing := make([]*PlannedMigration, 0)
	for _, migration := range migrations {
		found := false
		for _, existing := range existingMigrations {
			if existing.Id == migration.Id {
				found = true
				break
			}
		}
		if !found && migration.Less(lastRun) {
			missing = append(missing, &PlannedMigration{
				Migration:          migration,
				Queries:            migration.Up,
				DisableTransaction: migration.DisableTransactionUp,
			})
		}
	}
	return missing
}

func GetMigrationRecords(ctx context.Context, db *pgx.Conn) ([]*MigrationRecord, error) {
	return migSet.GetMigrationRecords(ctx, db)
}

func (ms MigrationSet) GetMigrationRecords(ctx context.Context, db *pgx.Conn) ([]*MigrationRecord, error) {
	var records []*MigrationRecord
	rows, err := db.Query(ctx, fmt.Sprintf("SELECT id, applied_at FROM %q ORDER BY id ASC", ms.getTableName()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var appliedAt pgtype.Timestamptz

		if rows.Scan(&id, &appliedAt); err != nil {
			return nil, err
		}
		records = append(records, &MigrationRecord{
			Id:        id,
			AppliedAt: appliedAt.Time,
		})
	}

	return records, nil
}

func (ms MigrationSet) createMigrationTable(ctx context.Context, db *pgx.Conn) error {
	if migSet.DisableCreateTable {
		return nil
	}

	if _, err := db.Exec(ctx, fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS %q (
	PRIMARY KEY (id),

	id         TEXT        NOT NULL UNIQUE,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`, ms.getTableName())); err != nil {
		return fmt.Errorf("failed to create migration table: %s", err.Error())
	}

	return nil
}
