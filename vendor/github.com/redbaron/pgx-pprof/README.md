# pgx-pprof

`pgxpprof` exports pgx query activity as delta pprof profiles, aggregated by Go call stack.
Exported stacks are trimmed so the leaf frame is the application callsite that issued the query.

It records:

- `db_query_count`
- `db_query_time`
- `db_tx_open_count`
- `db_tx_close_count`

## Integration

Install the pgx tracer before creating connections, pools, or a pgx stdlib `*sql.DB`:

```go
obs := pgxpprof.New()

cfg, err := pgx.ParseConfig(os.Getenv("DATABASE_URL"))
if err != nil {
  return err
}
cfg.Tracer = pgxpprof.QueryTracer(obs)

db := stdlib.OpenDB(*cfg)
```

Expose the delta pprof endpoint from your debug server:

```go
mux := http.NewServeMux()
mux.Handle("/debug/pprof/pgxpprof", pgxpprof.DeltaPprofHandler(obs))
mux.HandleFunc("/debug/pprof/", pprof.Index)
mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

go http.ListenAndServe(":6060", mux)
```

`DeltaPprofHandler` accepts the standard pprof `seconds` query parameter. With `seconds=14`, it waits 14 seconds and returns the delta accumulated for that response.

## Notes

- All queries in a pgx `Batch` are attributed to the `SendBatch` callsite.
- Query and transaction success or error outcomes are not distinguished.
- Transaction closes caused by connection closure are not counted.

## Grafana Alloy

Scrape the endpoint with `profile.custom` and `delta = true`:

```alloy
pyroscope.scrape "app" {
  targets = [
    {"__address__" = "app:6060", "service_name" = "my-go-service"},
  ]

  scrape_interval = "15s"
  forward_to       = [pyroscope.write.default.receiver]

  profiling_config {
    profile.custom "pgxpprof" {
      enabled = true
      path    = "/debug/pprof/pgxpprof"
      delta   = true
    }
  }
}

pyroscope.write "default" {
  endpoint {
    url = "http://pyroscope:4040"
  }
}
```

With a 15 second scrape interval, Alloy requests `/debug/pprof/pgxpprof?seconds=14`.

## Demo

Run against PostgreSQL:

```sh
DATABASE_URL='postgres://localhost/postgres?sslmode=disable' go run ./examples/pgxpprof-demo
```

Run with the pprof HTTP endpoint:

```sh
PPROF_ADDR=':6060' DATABASE_URL='postgres://localhost/postgres?sslmode=disable' go run ./examples/pgxpprof-demo
```

Inspect a profile locally:

```sh
go tool pprof -http=:0 -sample_index=db_query_time http://localhost:6060/debug/pprof/pgxpprof
```

Run the PostgreSQL integration test:

```sh
DATABASE_URL='postgres://localhost/postgres?sslmode=disable' go test . -run TestPostgresDatabaseSQLPoolIntegration -count=1
```

## Options

Use `WithSampleRate` to reduce stack-capture overhead at high query rates. Use `WithSampleRate(0)` to disable profiling.

Use `WithMaxStackDepth` to control captured stack depth.
