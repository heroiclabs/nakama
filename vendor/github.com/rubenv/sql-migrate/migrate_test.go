package migrate

import (
	"database/sql"
	"net/http"

	"github.com/gobuffalo/packr"
	_ "github.com/mattn/go-sqlite3"
	. "gopkg.in/check.v1"
	"gopkg.in/gorp.v1"
)

var sqliteMigrations = []*Migration{
	&Migration{
		Id:   "123",
		Up:   []string{"CREATE TABLE people (id int)"},
		Down: []string{"DROP TABLE people"},
	},
	&Migration{
		Id:   "124",
		Up:   []string{"ALTER TABLE people ADD COLUMN first_name text"},
		Down: []string{"SELECT 0"}, // Not really supported
	},
}

type SqliteMigrateSuite struct {
	Db    *sql.DB
	DbMap *gorp.DbMap
}

var _ = Suite(&SqliteMigrateSuite{})

func (s *SqliteMigrateSuite) SetUpTest(c *C) {
	var err error
	db, err := sql.Open("sqlite3", ":memory:")
	c.Assert(err, IsNil)

	s.Db = db
	s.DbMap = &gorp.DbMap{Db: db, Dialect: &gorp.SqliteDialect{}}
}

func (s *SqliteMigrateSuite) TestRunMigration(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: sqliteMigrations[:1],
	}

	// Executes one migration
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	// Can use table now
	_, err = s.DbMap.Exec("SELECT * FROM people")
	c.Assert(err, IsNil)

	// Shouldn't apply migration again
	n, err = Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 0)
}

func (s *SqliteMigrateSuite) TestRunMigrationEscapeTable(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: sqliteMigrations[:1],
	}

	SetTable(`my migrations`)

	// Executes one migration
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)
}

func (s *SqliteMigrateSuite) TestMigrateMultiple(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: sqliteMigrations[:2],
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Can use column now
	_, err = s.DbMap.Exec("SELECT first_name FROM people")
	c.Assert(err, IsNil)
}

func (s *SqliteMigrateSuite) TestMigrateIncremental(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: sqliteMigrations[:1],
	}

	// Executes one migration
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	// Execute a new migration
	migrations = &MemoryMigrationSource{
		Migrations: sqliteMigrations[:2],
	}
	n, err = Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	// Can use column now
	_, err = s.DbMap.Exec("SELECT first_name FROM people")
	c.Assert(err, IsNil)
}

func (s *SqliteMigrateSuite) TestFileMigrate(c *C) {
	migrations := &FileMigrationSource{
		Dir: "test-migrations",
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))
}

func (s *SqliteMigrateSuite) TestHttpFileSystemMigrate(c *C) {
	migrations := &HttpFileSystemMigrationSource{
		FileSystem: http.Dir("test-migrations"),
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))
}

func (s *SqliteMigrateSuite) TestAssetMigrate(c *C) {
	migrations := &AssetMigrationSource{
		Asset:    Asset,
		AssetDir: AssetDir,
		Dir:      "test-migrations",
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))
}

func (s *SqliteMigrateSuite) TestPackrMigrate(c *C) {
	migrations := &PackrMigrationSource{
		Box: packr.NewBox("test-migrations"),
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))
}

func (s *SqliteMigrateSuite) TestPackrMigrateDir(c *C) {
	migrations := &PackrMigrationSource{
		Box: packr.NewBox("."),
		Dir: "./test-migrations/",
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))
}

func (s *SqliteMigrateSuite) TestMigrateMax(c *C) {
	migrations := &FileMigrationSource{
		Dir: "test-migrations",
	}

	// Executes one migration
	n, err := ExecMax(s.Db, "sqlite3", migrations, Up, 1)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	id, err := s.DbMap.SelectInt("SELECT COUNT(*) FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(0))
}

func (s *SqliteMigrateSuite) TestMigrateDown(c *C) {
	migrations := &FileMigrationSource{
		Dir: "test-migrations",
	}

	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))

	// Undo the last one
	n, err = ExecMax(s.Db, "sqlite3", migrations, Down, 1)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	// No more data
	id, err = s.DbMap.SelectInt("SELECT COUNT(*) FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(0))

	// Remove the table.
	n, err = ExecMax(s.Db, "sqlite3", migrations, Down, 1)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 1)

	// Cannot query it anymore
	_, err = s.DbMap.SelectInt("SELECT COUNT(*) FROM people")
	c.Assert(err, Not(IsNil))

	// Nothing left to do.
	n, err = ExecMax(s.Db, "sqlite3", migrations, Down, 1)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 0)
}

func (s *SqliteMigrateSuite) TestMigrateDownFull(c *C) {
	migrations := &FileMigrationSource{
		Dir: "test-migrations",
	}

	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Has data
	id, err := s.DbMap.SelectInt("SELECT id FROM people")
	c.Assert(err, IsNil)
	c.Assert(id, Equals, int64(1))

	// Undo the last one
	n, err = Exec(s.Db, "sqlite3", migrations, Down)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Cannot query it anymore
	_, err = s.DbMap.SelectInt("SELECT COUNT(*) FROM people")
	c.Assert(err, Not(IsNil))

	// Nothing left to do.
	n, err = Exec(s.Db, "sqlite3", migrations, Down)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 0)
}

func (s *SqliteMigrateSuite) TestMigrateTransaction(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: []*Migration{
			sqliteMigrations[0],
			sqliteMigrations[1],
			&Migration{
				Id:   "125",
				Up:   []string{"INSERT INTO people (id, first_name) VALUES (1, 'Test')", "SELECT fail"},
				Down: []string{}, // Not important here
			},
		},
	}

	// Should fail, transaction should roll back the INSERT.
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, Not(IsNil))
	c.Assert(n, Equals, 2)

	// INSERT should be rolled back
	count, err := s.DbMap.SelectInt("SELECT COUNT(*) FROM people")
	c.Assert(err, IsNil)
	c.Assert(count, Equals, int64(0))
}

func (s *SqliteMigrateSuite) TestPlanMigration(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: []*Migration{
			&Migration{
				Id:   "1_create_table.sql",
				Up:   []string{"CREATE TABLE people (id int)"},
				Down: []string{"DROP TABLE people"},
			},
			&Migration{
				Id:   "2_alter_table.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN first_name text"},
				Down: []string{"SELECT 0"}, // Not really supported
			},
			&Migration{
				Id:   "10_add_last_name.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN last_name text"},
				Down: []string{"ALTER TABLE people DROP COLUMN last_name"},
			},
		},
	}
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 3)

	migrations.Migrations = append(migrations.Migrations, &Migration{
		Id:   "11_add_middle_name.sql",
		Up:   []string{"ALTER TABLE people ADD COLUMN middle_name text"},
		Down: []string{"ALTER TABLE people DROP COLUMN middle_name"},
	})

	plannedMigrations, _, err := PlanMigration(s.Db, "sqlite3", migrations, Up, 0)
	c.Assert(err, IsNil)
	c.Assert(plannedMigrations, HasLen, 1)
	c.Assert(plannedMigrations[0].Migration, Equals, migrations.Migrations[3])

	plannedMigrations, _, err = PlanMigration(s.Db, "sqlite3", migrations, Down, 0)
	c.Assert(err, IsNil)
	c.Assert(plannedMigrations, HasLen, 3)
	c.Assert(plannedMigrations[0].Migration, Equals, migrations.Migrations[2])
	c.Assert(plannedMigrations[1].Migration, Equals, migrations.Migrations[1])
	c.Assert(plannedMigrations[2].Migration, Equals, migrations.Migrations[0])
}

func (s *SqliteMigrateSuite) TestSkipMigration(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: []*Migration{
			&Migration{
				Id:   "1_create_table.sql",
				Up:   []string{"CREATE TABLE people (id int)"},
				Down: []string{"DROP TABLE people"},
			},
			&Migration{
				Id:   "2_alter_table.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN first_name text"},
				Down: []string{"SELECT 0"}, // Not really supported
			},
			&Migration{
				Id:   "10_add_last_name.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN last_name text"},
				Down: []string{"ALTER TABLE people DROP COLUMN last_name"},
			},
		},
	}
	n, err := SkipMax(s.Db, "sqlite3", migrations, Up, 0)
	// there should be no errors
	c.Assert(err, IsNil)
	// we should have detected and skipped 3 migrations
	c.Assert(n, Equals, 3)
	// should not actually have the tables now since it was skipped
	// so this query should fail
	_, err = s.DbMap.Exec("SELECT * FROM people")
	c.Assert(err, NotNil)
	// run the migrations again, should execute none of them since we pegged the db level
	// in the skip command
	n2, err2 := Exec(s.Db, "sqlite3", migrations, Up)
	// there should be no errors
	c.Assert(err2, IsNil)
	// we should not have executed any migrations
	c.Assert(n2, Equals, 0)
}

func (s *SqliteMigrateSuite) TestPlanMigrationWithHoles(c *C) {
	up := "SELECT 0"
	down := "SELECT 1"
	migrations := &MemoryMigrationSource{
		Migrations: []*Migration{
			&Migration{
				Id:   "1",
				Up:   []string{up},
				Down: []string{down},
			},
			&Migration{
				Id:   "3",
				Up:   []string{up},
				Down: []string{down},
			},
		},
	}
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	migrations.Migrations = append(migrations.Migrations, &Migration{
		Id:   "2",
		Up:   []string{up},
		Down: []string{down},
	})

	migrations.Migrations = append(migrations.Migrations, &Migration{
		Id:   "4",
		Up:   []string{up},
		Down: []string{down},
	})

	migrations.Migrations = append(migrations.Migrations, &Migration{
		Id:   "5",
		Up:   []string{up},
		Down: []string{down},
	})

	// apply all the missing migrations
	plannedMigrations, _, err := PlanMigration(s.Db, "sqlite3", migrations, Up, 0)
	c.Assert(err, IsNil)
	c.Assert(plannedMigrations, HasLen, 3)
	c.Assert(plannedMigrations[0].Migration.Id, Equals, "2")
	c.Assert(plannedMigrations[0].Queries[0], Equals, up)
	c.Assert(plannedMigrations[1].Migration.Id, Equals, "4")
	c.Assert(plannedMigrations[1].Queries[0], Equals, up)
	c.Assert(plannedMigrations[2].Migration.Id, Equals, "5")
	c.Assert(plannedMigrations[2].Queries[0], Equals, up)

	// first catch up to current target state 123, then migrate down 1 step to 12
	plannedMigrations, _, err = PlanMigration(s.Db, "sqlite3", migrations, Down, 1)
	c.Assert(err, IsNil)
	c.Assert(plannedMigrations, HasLen, 2)
	c.Assert(plannedMigrations[0].Migration.Id, Equals, "2")
	c.Assert(plannedMigrations[0].Queries[0], Equals, up)
	c.Assert(plannedMigrations[1].Migration.Id, Equals, "3")
	c.Assert(plannedMigrations[1].Queries[0], Equals, down)

	// first catch up to current target state 123, then migrate down 2 steps to 1
	plannedMigrations, _, err = PlanMigration(s.Db, "sqlite3", migrations, Down, 2)
	c.Assert(err, IsNil)
	c.Assert(plannedMigrations, HasLen, 3)
	c.Assert(plannedMigrations[0].Migration.Id, Equals, "2")
	c.Assert(plannedMigrations[0].Queries[0], Equals, up)
	c.Assert(plannedMigrations[1].Migration.Id, Equals, "3")
	c.Assert(plannedMigrations[1].Queries[0], Equals, down)
	c.Assert(plannedMigrations[2].Migration.Id, Equals, "2")
	c.Assert(plannedMigrations[2].Queries[0], Equals, down)
}

func (s *SqliteMigrateSuite) TestLess(c *C) {
	c.Assert((Migration{Id: "1"}).Less(&Migration{Id: "2"}), Equals, true)           // 1 less than 2
	c.Assert((Migration{Id: "2"}).Less(&Migration{Id: "1"}), Equals, false)          // 2 not less than 1
	c.Assert((Migration{Id: "1"}).Less(&Migration{Id: "a"}), Equals, true)           // 1 less than a
	c.Assert((Migration{Id: "a"}).Less(&Migration{Id: "1"}), Equals, false)          // a not less than 1
	c.Assert((Migration{Id: "a"}).Less(&Migration{Id: "a"}), Equals, false)          // a not less than a
	c.Assert((Migration{Id: "1-a"}).Less(&Migration{Id: "1-b"}), Equals, true)       // 1-a less than 1-b
	c.Assert((Migration{Id: "1-b"}).Less(&Migration{Id: "1-a"}), Equals, false)      // 1-b not less than 1-a
	c.Assert((Migration{Id: "1"}).Less(&Migration{Id: "10"}), Equals, true)          // 1 less than 10
	c.Assert((Migration{Id: "10"}).Less(&Migration{Id: "1"}), Equals, false)         // 10 not less than 1
	c.Assert((Migration{Id: "1_foo"}).Less(&Migration{Id: "10_bar"}), Equals, true)  // 1_foo not less than 1
	c.Assert((Migration{Id: "10_bar"}).Less(&Migration{Id: "1_foo"}), Equals, false) // 10 not less than 1
	// 20160126_1100 less than 20160126_1200
	c.Assert((Migration{Id: "20160126_1100"}).
		Less(&Migration{Id: "20160126_1200"}), Equals, true)
	// 20160126_1200 not less than 20160126_1100
	c.Assert((Migration{Id: "20160126_1200"}).
		Less(&Migration{Id: "20160126_1100"}), Equals, false)

}

func (s *SqliteMigrateSuite) TestPlanMigrationWithUnknownDatabaseMigrationApplied(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: []*Migration{
			&Migration{
				Id:   "1_create_table.sql",
				Up:   []string{"CREATE TABLE people (id int)"},
				Down: []string{"DROP TABLE people"},
			},
			&Migration{
				Id:   "2_alter_table.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN first_name text"},
				Down: []string{"SELECT 0"}, // Not really supported
			},
			&Migration{
				Id:   "10_add_last_name.sql",
				Up:   []string{"ALTER TABLE people ADD COLUMN last_name text"},
				Down: []string{"ALTER TABLE people DROP COLUMN last_name"},
			},
		},
	}
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 3)

	// Note that migration 10_add_last_name.sql is missing from the new migrations source
	// so it is considered an "unknown" migration for the planner.
	migrations.Migrations = append(migrations.Migrations[:2], &Migration{
		Id:   "10_add_middle_name.sql",
		Up:   []string{"ALTER TABLE people ADD COLUMN middle_name text"},
		Down: []string{"ALTER TABLE people DROP COLUMN middle_name"},
	})

	_, _, err = PlanMigration(s.Db, "sqlite3", migrations, Up, 0)
	c.Assert(err, NotNil, Commentf("Up migrations should not have been applied when there "+
		"is an unknown migration in the database"))
	c.Assert(err, FitsTypeOf, &PlanError{})

	_, _, err = PlanMigration(s.Db, "sqlite3", migrations, Down, 0)
	c.Assert(err, NotNil, Commentf("Down migrations should not have been applied when there "+
		"is an unknown migration in the database"))
	c.Assert(err, FitsTypeOf, &PlanError{})
}

// TestExecWithUnknownMigrationInDatabase makes sure that problems found with planning the
// migrations are propagated and returned by Exec.
func (s *SqliteMigrateSuite) TestExecWithUnknownMigrationInDatabase(c *C) {
	migrations := &MemoryMigrationSource{
		Migrations: sqliteMigrations[:2],
	}

	// Executes two migrations
	n, err := Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, IsNil)
	c.Assert(n, Equals, 2)

	// Then create a new migration source with one of the migrations missing
	var newSqliteMigrations = []*Migration{
		&Migration{
			Id:   "124_other",
			Up:   []string{"ALTER TABLE people ADD COLUMN middle_name text"},
			Down: []string{"ALTER TABLE people DROP COLUMN middle_name"},
		},
		&Migration{
			Id:   "125",
			Up:   []string{"ALTER TABLE people ADD COLUMN age int"},
			Down: []string{"ALTER TABLE people DROP COLUMN age"},
		},
	}
	migrations = &MemoryMigrationSource{
		Migrations: append(sqliteMigrations[:1], newSqliteMigrations...),
	}

	n, err = Exec(s.Db, "sqlite3", migrations, Up)
	c.Assert(err, NotNil, Commentf("Migrations should not have been applied when there "+
		"is an unknown migration in the database"))
	c.Assert(err, FitsTypeOf, &PlanError{})
	c.Assert(n, Equals, 0)

	// Make sure the new columns are not actually created
	_, err = s.DbMap.Exec("SELECT middle_name FROM people")
	c.Assert(err, NotNil)
	_, err = s.DbMap.Exec("SELECT age FROM people")
	c.Assert(err, NotNil)
}
