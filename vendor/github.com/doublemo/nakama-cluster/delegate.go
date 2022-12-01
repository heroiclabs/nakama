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
	NotifyJoin(node *Meta)

	// NotifyLeave 接收节点离线通知
	NotifyLeave(node *Meta)

	// NotifyUpdate 接收节点更新通知
	NotifyUpdate(node *Meta)

	// NotifyAlive 接收节点活动通知
	NotifyAlive(node *Meta) error

	// NotifyMsg 接收节来至其它节点的信息
	NotifyMsg(node string, msg *api.Envelope) (*api.Envelope, error)
}

// NodeMeta is used to retrieve meta-data about the current node
// when broadcasting an alive message. It's length is limited to
// the given byte size. This metadata is available in the Node structure.
func (s *Client) NodeMeta(limit int) []byte {
	meta := s.GetMeta()
	if meta == nil {
		return nil
	}

	metaBytes, err := meta.Marshal()
	if err != nil {
		s.logger.Warn("Failed marshal meta", zap.Error(err))
		return nil
	}

	return metaBytes
}

// NotifyMsg is called when a user-data message is received.
// Care should be taken that this method does not block, since doing
// so would block the entire UDP packet receive loop. Additionally, the byte
// slice may be modified after the call returns, so it should be copied if needed
func (s *Client) NotifyMsg(msg []byte) {
	var frame api.Frame
	if err := proto.Unmarshal(msg, &frame); err != nil {
		s.logger.Warn("NotifyMsg parse failed", zap.Error(err))
		return
	}

	if frame.Direct == api.Frame_Broadcast && !s.messageCursor.Fire(frame.Node, frame.SeqID) {
		return
	}

	if frame.Direct == api.Frame_Reply {
		s.recvReplyMessage(&frame)
		return
	}

	fn, ok := s.delegate.Load().(Delegate)
	if !ok || fn == nil {
		return
	}

	reply, err := fn.NotifyMsg(frame.Node, frame.GetEnvelope())
	if (reply == nil && err == nil) || frame.Direct == api.Frame_Broadcast {
		return
	}

	s.sendReplyMessage(&frame, reply, err)
}

// GetBroadcasts is called when user data messages can be broadcast.
// It can return a list of buffers to send. Each buffer should assume an
// overhead as provided with a limit on the total byte size allowed.
// The total byte size of the resulting data to send must not exceed
// the limit. Care should be taken that this method does not block,
// since doing so would block the entire UDP packet receive loop.
func (s *Client) GetBroadcasts(overhead, limit int) [][]byte {
	return s.messageQueue.GetBroadcasts(overhead, limit)
}

// LocalState is used for a TCP Push/Pull. This is sent to
// the remote side in addition to the membership information. ALogger
// data can be sent here. See MergeRemoteState as well. The `join`
// boolean indicates this is for a join instead of a push/pull.
func (s *Client) LocalState(join bool) []byte {
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
func (s *Client) MergeRemoteState(buf []byte, join bool) {
	fn, ok := s.delegate.Load().(Delegate)
	if ok && fn != nil {
		fn.MergeRemoteState(buf, join)
	}
}

// AckPayload is invoked when an ack is being sent; the returned bytes will be appended to the ack
func (s *Client) AckPayload() []byte {
	return []byte{}
}

// NotifyPing is invoked when an ack for a ping is received
func (s *Client) NotifyPingComplete(other *memberlist.Node, rtt time.Duration, payload []byte) {
}

// NotifyJoin is invoked when a node is detected to have joined.
// The Node argument must not be modified.
func (s *Client) NotifyJoin(node *memberlist.Node) {
	s.Lock()
	s.nodes[node.Name] = node
	s.Unlock()

	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyJoin(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyLeave is invoked when a node is detected to have left.
// The Node argument must not be modified.
func (s *Client) NotifyLeave(node *memberlist.Node) {
	s.Lock()
	delete(s.nodes, node.Name)
	s.Unlock()

	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyLeave(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyUpdate is invoked when a node is detected to have
// updated, usually involving the meta data. The Node argument
// must not be modified.
func (s *Client) NotifyUpdate(node *memberlist.Node) {
	s.Lock()
	s.nodes[node.Name] = node
	s.Unlock()

	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		fn.NotifyUpdate(NewNodeMetaFromJSON(node.Meta))
	}
}

// NotifyAlive implements the memberlist.AliveDelegate interface.
func (s *Client) NotifyAlive(node *memberlist.Node) error {
	if fn, ok := s.delegate.Load().(Delegate); ok && fn != nil {
		return fn.NotifyAlive(NewNodeMetaFromJSON(node.Meta))
	}

	return nil
}

func (s *Client) recvReplyMessage(frame *api.Frame) {
	m, ok := s.messageWaitQueue.Load(frame.Id)
	if !ok {
		return
	}

	message, ok := m.(*Message)
	if !ok {
		return
	}

	if err := message.Send(frame.GetEnvelope()); err != nil {
		s.logger.Warn("Failed send message to reply", zap.Error(err))
		message.SendErr(err)
		return
	}
}

func (s *Client) sendReplyMessage(frame *api.Frame, reply *api.Envelope, err error) {
	replyFrame := api.Frame{
		Id:     frame.Id,
		Node:   s.GetLocalNode().Name,
		SeqID:  s.messageSeq.NextID(frame.Node),
		Direct: api.Frame_Reply,
	}

	if err != nil {
		replyFrame.Envelope = &api.Envelope{Payload: &api.Envelope_Error{
			Error: &api.Error{
				Code:    500,
				Message: err.Error(),
			},
		}}
	} else {
		replyFrame.Envelope = reply
	}

	bytes, _ := proto.Marshal(&replyFrame)
	s.Lock()
	node, ok := s.nodes[frame.Node]
	s.Unlock()
	if !ok {
		s.logger.Warn("Failed send message to node", zap.String("node", frame.Node))
		return
	}

	if err := s.memberlist.SendReliable(node, bytes); err != nil {
		s.logger.Warn("Failed send message to node", zap.Error(err), zap.String("node", frame.Node))
	}
}
