package netcode

const PACKET_QUEUE_SIZE = 256

type PacketQueue struct {
	numPackets int
	startIndex int
	packets    []Packet
	queueSize  int
}

func NewPacketQueue(queueSize int) *PacketQueue {
	q := &PacketQueue{}
	q.queueSize = queueSize
	q.packets = make([]Packet, queueSize)
	return q
}

func (q *PacketQueue) Clear() {
	q.numPackets = 0
	q.startIndex = 0
	q.packets = make([]Packet, q.queueSize)
}

func (q *PacketQueue) Push(packet Packet) int {
	if q.numPackets == q.queueSize {
		return 0
	}

	index := (q.startIndex + q.numPackets) % q.queueSize
	q.packets[index] = packet
	q.numPackets++
	return 1
}

func (q *PacketQueue) Pop() Packet {
	if q.numPackets == 0 {
		return nil
	}

	packet := q.packets[q.startIndex]
	q.startIndex = (q.startIndex + 1) % q.queueSize
	q.numPackets--
	return packet
}
