package sd

import "time"

const minHeartBeatTime = 500 * time.Millisecond

// TTLOption allow setting a key with a TTL. This option will be used by a loop
// goroutine which regularly refreshes the lease of the key.
type TTLOption struct {
	heartbeat time.Duration // e.g. time.Second * 3
	ttl       time.Duration // e.g. time.Second * 10
}

// NewTTLOption returns a TTLOption that contains proper TTL settings. Heartbeat
// is used to refresh the lease of the key periodically; its value should be at
// least 500ms. TTL defines the lease of the key; its value should be
// significantly greater than heartbeat.
//
// Good default values might be 3s heartbeat, 10s TTL.
func NewTTLOption(heartbeat, ttl time.Duration) *TTLOption {
	if heartbeat <= minHeartBeatTime {
		heartbeat = minHeartBeatTime
	}
	if ttl <= heartbeat {
		ttl = 3 * heartbeat
	}
	return &TTLOption{
		heartbeat: heartbeat,
		ttl:       ttl,
	}
}
