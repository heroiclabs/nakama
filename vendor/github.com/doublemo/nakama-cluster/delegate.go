package nakamacluster

import (
	"time"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/hashicorp/memberlist"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

type Delegate interface {
	// LocalState 发送本地状态信息
	LocalState(join bool) []byte

	// MergeRemoteState 发送本地状态信息
	MergeRemoteState(buf []byte, join bool)

	// NotifyJoin 接收节点加入通知
	NotifyJoin(node *NodeMeta)

	// NotifyLeave 接收节点离线通知
	NotifyLeave(node *NodeMeta)

	// NotifyUpdate 接收节点更新通知
	NotifyUpdate(node *NodeMeta)

	// NotifyAlive 接收节点活动通知
	NotifyAlive(node *NodeMeta) error

	// NotifyMsg 接收节来至其它节点的信息
	NotifyMsg(msg *api.Envelope)
}

// NodeMeta is used to retrieve meta-data about the current node
// when broadcasting an alive message. It's length is limited to
// the given byte size. This metadata is available in the Node structure.
func (s *NakamaServer) NodeMeta(limit int) []byte {
	s.Lock()
	meta, err := s.meta.Marshal()
	s.Unlock()

	if err != nil {
		s.logger.Fatal("Failed marshal meta", zap.Error(err))
	}

	return meta
}

// NotifyMsg is called when a user-data message is received.
// Care should be taken that this method does not block, since doing
// so would block the entire UDP packet receive loop. Additionally, the byte
// slice may be modified after the call returns, so it should be copied if needed
func (s *NakamaServer) NotifyMsg(msg []byte) {
	if s.metrics != nil {
		s.metrics.RecvBroadcast(int64(len(msg)))
	}

	var envelope api.Envelope
	if err := proto.Unmarshal(msg, &envelope); err != nil {
		s.logger.Warn("NotifyMsg parse failed", zap.Error(err))
		return
	}

	if !s.messageCur.Fire(envelope.Node, envelope.Id) {
		return
	}

	fn, ok := s.delegate.Load().(Delegate)
	if !ok || fn == nil {
		return
	}

	fn.NotifyMsg(&envelope)
}

// GetBroadcasts is called when user data messages can be broadcast.
// It can return a list of buffers to send. Each buffer should assume an
// overhead as provided with a limit on the total byte size allowed.
// The total byte size of the resulting data to send must not exceed
// the limit. Care should be taken that this method does not block,
// since doing so would block the entire UDP packet receive loop.
func (s *NakamaServer) GetBroadcasts(overhead, limit int) [][]byte {
	return s.messageQueue.GetBroadcasts(overhead, limit)
}

// LocalState is used for a TCP Push/Pull. This is sent to
// the remote side in addition to the membership information. ALogger
// data can be sent here. See MergeRemoteState as well. The `join`
// boolean indicates this is for a join instead of a push/pull.
func (s *NakamaServer) LocalState(join bool) []byte {
	fn, ok := s.delegate.Load().(Delegate)
	if ok && fn != nil {
		return fn.LocalState(join)
	}
	return nil
}

// MergeRemoteState is invoked after a TCP Push/Pull. This is the
// state received from the remote side and is the result of the
// remote side's LocalState call. The 'join'
// boolean indicates this is for a join instead of a push/pull.
func (s *NakamaServer) MergeRemoteState(buf []byte, join bool) {
	fn, ok := s.delegate.Load().(Delegate)
	if ok && fn != nil {
		fn.MergeRemoteState(buf, join)
	}
}

// AckPayload is invoked when an ack is being sent; the returned bytes will be appended to the ack
func (s *NakamaServer) AckPayload() []byte {
	return []byte{}
}

// NotifyPing is invoked when an ack for a ping is received
func (s *NakamaServer) NotifyPingComplete(other *memberlist.Node, rtt time.Duration, payload []byte) {
	if s.metrics != nil {
		s.metrics.PingMs(rtt)
	}
}

// NotifyJoin is invoked when a node is detected to have joined.
// The Node argument must not be modified.
func (s *NakamaServer) NotifyJoin(node *memberlist.Node) {
	s.messageCur.Reset(node.Name)

	if s.metrics != nil {
		s.metrics.NodeJoin(1)
	}

	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyJoin(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyLeave is invoked when a node is detected to have left.
// The Node argument must not be modified.
func (s *NakamaServer) NotifyLeave(node *memberlist.Node) {
	s.messageCur.Remove(node.Name)

	if s.metrics != nil {
		s.metrics.NodeLeave(1)
	}

	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyLeave(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyUpdate is invoked when a node is detected to have
// updated, usually involving the meta data. The Node argument
// must not be modified.
func (s *NakamaServer) NotifyUpdate(node *memberlist.Node) {
	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyUpdate(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyAlive implements the memberlist.AliveDelegate interface.
func (s *NakamaServer) NotifyAlive(node *memberlist.Node) error {
	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		return fn.NotifyAlive(NewNodeMetaFromJSON(node.Meta))
	}

	return nil
}
