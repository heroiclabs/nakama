package nakamacluster

import (
	"encoding/json"
	"fmt"
	"net"

	sockaddr "github.com/hashicorp/go-sockaddr"
)

// MetaStatus 状态
// 将用于描述微服务的状态
type MetaStatus int

const (
	META_STATUS_WAIT_READY MetaStatus = iota // 等待就绪
	META_STATUS_READYED                      // 节点准备就绪
	META_STATUS_STOPED                       // 节点关闭
)

// NodeMeta 节点参数
type Meta struct {
	Id     string            `json:"id"`
	Name   string            `json:"name"`
	Addr   string            `json:"addr"`
	Type   NodeType          `json:"type"`
	Status MetaStatus        `json:"status"`
	Vars   map[string]string `json:"vars"`
}

// Marshal 创建JSON
func (n *Meta) Marshal() ([]byte, error) {
	return json.Marshal(n)
}

// Clone copy
func (n Meta) Clone() *Meta {
	return &n
}

// NewNodeMetaFromJSON 通过JSON流创建NodeMeta
func NewNodeMetaFromJSON(b []byte) *Meta {
	var m Meta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return &m
}

// NewNodeMeta 创建NodeMeta信息
func NewNodeMeta(id, name, addr string, nodeType NodeType, vars map[string]string) *Meta {
	return &Meta{
		Id:     id,
		Name:   name,
		Addr:   addr,
		Type:   nodeType,
		Vars:   vars,
		Status: META_STATUS_WAIT_READY,
	}
}

// NewNodeMetaFromConfig 通过配置文件创建NodeMeta
func NewNodeMetaFromConfig(id, name string, t NodeType, vars map[string]string, c Config) *Meta {
	addr := c.Domain
	if addr == "" {
		ip, err := net.ResolveIPAddr("ip", c.Addr)
		if err != nil {
			addr, err = sockaddr.GetPrivateIP()
			if err != nil {
				panic(err)
			}
		} else {
			addr = ip.String()
		}
	}

	return NewNodeMeta(id, name, fmt.Sprintf("%s:%d", addr, c.Port), t, vars)
}
