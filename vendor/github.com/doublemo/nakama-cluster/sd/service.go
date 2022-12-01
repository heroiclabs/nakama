package sd

type Service struct {
	Key   string // unique key, e.g. "/service/foobar/1.2.3.4:8080"
	Value string // returned to subscribers
	TTL   *TTLOption
}
