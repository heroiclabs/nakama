package nakamacluster

// 集群配置
type Config struct {
	Addr                         string `yaml:"gossip_bindaddr" json:"gossip_bindaddr" usage:"Interface address to bind Nakama to for discovery. By default listening on all interfaces."`
	Port                         int    `yaml:"gossip_bindport" json:"gossip_bindport" usage:"Port number to bind Nakama to for discovery. Default value is 7352."`
	Domain                       string `yaml:"domain" json:"domain" usage:"Domain"`
	Prefix                       string `yaml:"prefix" json:"prefix" usage:"service prefix"`
	Weight                       int    `yaml:"weight" json:"weight" usage:"Peer weight"`
	PushPullInterval             int    `yaml:"push_pull_interval" json:"push_pull_interval" usage:"push_pull_interval is the interval between complete state syncs, Default value is 60 Second"`
	GossipInterval               int    `yaml:"gossip_interval" json:"gossip_interval" usage:"gossip_interval is the interval after which a node has died that, Default value is 200 Millisecond"`
	TCPTimeout                   int    `yaml:"tcp_timeout" json:"tcp_timeout" usage:"tcp_timeout is the timeout for establishing a stream connection with a remote node for a full state sync, and for stream read and writeoperations, Default value is 10 Second"`
	ProbeTimeout                 int    `yaml:"probe_timeout" json:"probe_timeout" usage:"probe_timeout is the timeout to wait for an ack from a probed node before assuming it is unhealthy. This should be set to 99-percentile of RTT (round-trip time) on your network, Default value is 500 Millisecond"`
	ProbeInterval                int    `yaml:"probe_interval" json:"probe_interval" usage:"probe_interval is the interval between random node probes. Setting this lower (more frequent) will cause the memberlist cluster to detect failed nodes more quickly at the expense of increased bandwidth usage., Default value is 1 Second"`
	RetransmitMult               int    `yaml:"retransmit_mult" json:"retransmit_mult" usage:"retransmit_mult is the multiplier used to determine the maximum number of retransmissions attempted, Default value is 2"`
	MaxGossipPacketSize          int    `yaml:"max_gossip_packet_size" json:"max_gossip_packet_size" usage:"max_gossip_packet_size Maximum number of bytes that memberlist will put in a packet (this will be for UDP packets by default with a NetTransport), Default value is 1400"`
	BroadcastQueueSize           int    `yaml:"broadcast_queue_size" json:"broadcast_queue_size" usage:"broadcast message queue size"`
	GrpcX509Pem                  string `yaml:"grpc_x509_pem" json:"grpc_x509_pem" usage:"ssl pem"`
	GrpcX509Key                  string `yaml:"grpc_x509_key" json:"grpc_x509_key" usage:"ssl key"`
	GrpcToken                    string `yaml:"grpc_token" json:"grpc_token" usage:"token"`
	GrpcPoolMaxIdle              int    `yaml:"grpc_pool_max_idle" json:"grpc_pool_max_idle" usage:"Maximum number of idle connections in the grpc pool"`
	GrpcPoolMaxActive            int    `yaml:"grpc_pool_max_active" json:"grpc_pool_max_active" usage:"Maximum number of connections allocated by the grpc pool at a given time."`
	GrpcPoolMaxConcurrentStreams int    `yaml:"grpc_pool_max_concurrent_streams" json:"grpc_pool_max_concurrent_streams" usage:"MaxConcurrentStreams limit on the number of concurrent grpc streams to each single connection,create a one-time connection to return."`
	GrpcPoolReuse                bool   `yaml:"grpc_pool_reuse" json:"grpc_pool_reuse" usage:"If Reuse is true and the pool is at the GrpcPoolMaxActive limit, then Get() reuse,the connection to return, If Reuse is false and the pool is at the MaxActive limit"`
	GrpcPoolMessageQueueSize     int    `yaml:"grpc_pool_message_queue_size" json:"grpc_pool_message_queue_size" usage:"grpc message queue size"`
}

func NewConfig() *Config {
	c := &Config{
		Addr:                         "0.0.0.0",
		Port:                         7355,
		Prefix:                       "/nakama-cluster/services/",
		Weight:                       1,
		PushPullInterval:             10,
		GossipInterval:               200,
		TCPTimeout:                   10,
		ProbeTimeout:                 500,
		ProbeInterval:                1,
		RetransmitMult:               2,
		MaxGossipPacketSize:          1400,
		BroadcastQueueSize:           32,
		GrpcPoolMaxIdle:              8,
		GrpcPoolMaxActive:            64,
		GrpcPoolMaxConcurrentStreams: 64,
		GrpcPoolReuse:                true,
		GrpcPoolMessageQueueSize:     1,
	}
	return c
}
