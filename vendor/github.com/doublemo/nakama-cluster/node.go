package nakamacluster

// 节点类型
type NodeType int

const (
	NODE_TYPE_NAKAMA        NodeType = iota + 1 // nakama主服务
	NODE_TYPE_MICROSERVICES                     // 微服务
)
