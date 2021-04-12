module github.com/heroiclabs/nakama/v3

go 1.16

require (
	github.com/blevesearch/bleve/v2 v2.0.3
	github.com/blevesearch/upsidedown_store_api v1.0.1
	github.com/dgrijalva/jwt-go v3.2.1-0.20200107013213-dc14462fd587+incompatible
	github.com/dop251/goja v0.0.0-20210406175830-1b11a6af686d
	github.com/glycerine/go-unsnap-stream v0.0.0-20190901134440-81cf024a9e0a // indirect
	github.com/gofrs/uuid v4.0.0+incompatible
	github.com/gorilla/handlers v1.5.1
	github.com/gorilla/mux v1.8.0
	github.com/gorilla/websocket v1.4.2
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.3.0
	github.com/heroiclabs/nakama-common v1.14.0
	github.com/jackc/pgconn v1.8.1
	github.com/jackc/pgerrcode v0.0.0-20201024163028-a0d42d470451
	github.com/jackc/pgtype v1.7.0
	github.com/jackc/pgx/v4 v4.11.0
	github.com/m3db/prometheus_client_golang v0.8.1 // indirect
	github.com/m3db/prometheus_client_model v0.1.0 // indirect
	github.com/m3db/prometheus_common v0.1.0 // indirect
	github.com/m3db/prometheus_procfs v0.8.1 // indirect
	github.com/rubenv/sql-migrate v0.0.0-20210408115534-a32ed26c37ea
	github.com/steveyen/gtreap v0.1.0
	github.com/stretchr/testify v1.7.0
	github.com/tinylib/msgp v1.1.2 // indirect
	github.com/uber-go/tally v3.3.17+incompatible
	github.com/ziutek/mymysql v1.5.4 // indirect
	go.uber.org/atomic v1.7.0
	go.uber.org/zap v1.16.0
	golang.org/x/crypto v0.0.0-20210506145944-38f3c27a63bf
	google.golang.org/genproto v0.0.0-20210224155714-063164c882e6
	google.golang.org/grpc v1.37.0
	google.golang.org/grpc/cmd/protoc-gen-go-grpc v1.1.0
	google.golang.org/protobuf v1.26.0
	gopkg.in/natefinch/lumberjack.v2 v2.0.0-20190411184413-94d9e492cc53
	gopkg.in/yaml.v2 v2.4.0
)

replace github.com/heroiclabs/nakama-common => /Users/smn/code/nakama-common
