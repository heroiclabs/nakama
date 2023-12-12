# sql-migrate

This is a fork of the [sql-migrate](https://github.com/rubenv/sql-migrate/) SQL Schema migration tool for [Go](https://golang.org/). 

The motivation for this fork is to remove the `go-gorp` dependency, simplifying the codebase but making it work with the [pgx](https://github.com/jackc/pgx) db driver exclusively. 

[![Build Status](https://travis-ci.org/rubenv/sql-migrate.svg?branch=master)](https://travis-ci.org/rubenv/sql-migrate) [![GoDoc](https://godoc.org/github.com/rubenv/sql-migrate?status.svg)](https://godoc.org/github.com/rubenv/sql-migrate)

## Features
* Can embed migrations into your application
* Migrations are defined with SQL for full flexibility
* Atomic migrations
* Up/down migrations to allow rollback

## Installation

```bash
go get -v github.com/heroiclabs/nakama/sql-migrate/
```

## Usage

Import sql-migrate into your application:

```go
import "github.com/heroiclabs/nakama/sql-migrate"
```

Set up a source of migrations, this can be from memory, from a set of files, from bindata (more on that later), or from any library that implements [`http.FileSystem`](https://godoc.org/net/http#FileSystem):

```go
// Hardcoded strings in memory:
migrations := &migrate.MemoryMigrationSource{
    Migrations: []*migrate.Migration{
        &migrate.Migration{
            Id:   "123",
            Up:   []string{"CREATE TABLE people (id int)"},
            Down: []string{"DROP TABLE people"},
        },
    },
}

// OR: Read migrations from a folder:
migrations := &migrate.FileMigrationSource{
    Dir: "db/migrations",
}

// OR: Use migrations from a packr box
migrations := &migrate.PackrMigrationSource{
    Box: packr.New("migrations", "./migrations"),
}

// OR: Use pkger which implements `http.FileSystem`
migrationSource := &migrate.HttpFileSystemMigrationSource{
    FileSystem: pkger.Dir("/db/migrations"),
}

// OR: Use migrations from bindata:
migrations := &migrate.AssetMigrationSource{
    Asset:    Asset,
    AssetDir: AssetDir,
    Dir:      "migrations",
}

// OR: Read migrations from a `http.FileSystem`
migrationSource := &migrate.HttpFileSystemMigrationSource{
    FileSystem: httpFS,
}
```

Then use the `Exec` function to upgrade your database:

```go
n, err := migrate.Exec(db, migrations, migrate.Up)
if err != nil {
    // Handle errors!
}
fmt.Printf("Applied %d migrations!\n", n)
```

Note that `n` can be greater than `0` even if there is an error: any migration that succeeded will remain applied even if a later one fails.

## Writing migrations
Migrations are defined in SQL files, which contain a set of SQL statements. Special comments are used to distinguish up and down migrations.

```sql
-- +migrate Up
-- SQL in section 'Up' is executed when this migration is applied
CREATE TABLE people (id int);


-- +migrate Down
-- SQL section 'Down' is executed when this migration is rolled back
DROP TABLE people;
```

You can put multiple statements in each block, as long as you end them with a semicolon (`;`).

You can alternatively set up a separator string that matches an entire line by setting `sqlparse.LineSeparator`. This
can be used to imitate, for example, MS SQL Query Analyzer functionality where commands can be separated by a line with
contents of `GO`. If `sqlparse.LineSeparator` is matched, it will not be included in the resulting migration scripts.

If you have complex statements which contain semicolons, use `StatementBegin` and `StatementEnd` to indicate boundaries:

```sql
-- +migrate Up
CREATE TABLE people (id int);

-- +migrate StatementBegin
CREATE OR REPLACE FUNCTION do_something()
returns void AS $$
DECLARE
  create_query text;
BEGIN
  -- Do something here
END;
$$
language plpgsql;
-- +migrate StatementEnd

-- +migrate Down
DROP FUNCTION do_something();
DROP TABLE people;
```

The order in which migrations are applied is defined through the filename: sql-migrate will sort migrations based on their name. It's recommended to use an increasing version number or a timestamp as the first part of the filename.

Normally each migration is run within a transaction in order to guarantee that it is fully atomic. However some SQL commands (for example creating an index concurrently in PostgreSQL) cannot be executed inside a transaction. In order to execute such a command in a migration, the migration can be run using the `notransaction` option:

```sql
-- +migrate Up notransaction
CREATE UNIQUE INDEX CONCURRENTLY people_unique_id_idx ON people (id);

-- +migrate Down
DROP INDEX people_unique_id_idx;
```

## Embedding migrations with libraries that implement `http.FileSystem`

You can also embed migrations with any library that implements `http.FileSystem`, like [`vfsgen`](https://github.com/shurcooL/vfsgen), [`parcello`](https://github.com/phogolabs/parcello), or [`go-resources`](https://github.com/omeid/go-resources).

```go
migrationSource := &migrate.HttpFileSystemMigrationSource{
    FileSystem: httpFS,
}
```

## Tests

Run the tests by first starting the Postgres docker container.

```bash
docker compose up
go test
```

## Extending

Adding a new migration source means implementing `MigrationSource`.

```go
type MigrationSource interface {
    FindMigrations() ([]*Migration, error)
}
```

The resulting slice of migrations will be executed in the given order, so it should usually be sorted by the `Id` field.

## License

This library is distributed under the [MIT](LICENSE) license.
