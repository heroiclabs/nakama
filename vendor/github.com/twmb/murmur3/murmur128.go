package murmur3

import (
	"hash"
	"math/bits"
)

const (
	c1_128 = 0x87c37b91114253d5
	c2_128 = 0x4cf5ad432745937f
)

// Make sure interfaces are correctly implemented.
var (
	_ hash.Hash   = new(digest128)
	_ hash.Cloner = new(digest128)
	_ Hash128     = new(digest128)
	_ bmixer      = new(digest128)
)

// Hash128 provides an interface for a streaming 128 bit hash.
type Hash128 interface {
	hash.Hash
	Sum128() (uint64, uint64)
}

// digest128 represents a partial evaluation of a 128 bites hash.
type digest128 struct {
	digest
	seed1 uint64
	seed2 uint64
	h1    uint64 // Unfinalized running hash part 1.
	h2    uint64 // Unfinalized running hash part 2.
}

// SeedNew128 returns a Hash128 for streaming 128 bit sums with its internal
// digests initialized to seed1 and seed2.
//
// The canonical implementation allows one only uint32 seed; to imitate that
// behavior, use the same, uint32-max seed for seed1 and seed2.
func SeedNew128(seed1, seed2 uint64) Hash128 {
	d := &digest128{seed1: seed1, seed2: seed2}
	d.bmixer = d
	d.Reset()
	return d
}

// New128 returns a Hash128 for streaming 128 bit sums.
func New128() Hash128 {
	return SeedNew128(0, 0)
}

func (d *digest128) Size() int { return 16 }

func (d *digest128) reset() { d.h1, d.h2 = d.seed1, d.seed2 }

func (d *digest128) Sum(b []byte) []byte {
	h1, h2 := d.Sum128()
	return append(b,
		byte(h1>>56), byte(h1>>48), byte(h1>>40), byte(h1>>32),
		byte(h1>>24), byte(h1>>16), byte(h1>>8), byte(h1),

		byte(h2>>56), byte(h2>>48), byte(h2>>40), byte(h2>>32),
		byte(h2>>24), byte(h2>>16), byte(h2>>8), byte(h2),
	)
}

func (d *digest128) bmix(p []byte) (tail []byte) {
	h1, h2 := d.h1, d.h2
	i := 0
	for end := len(p) - 16; i <= end; i += 16 {
		b := p[i : i+16]
		h1, h2 = mix128(h1, h2, load64(b), load64(b[8:]))
	}
	d.h1, d.h2 = h1, h2
	return p[i:]
}

func (d *digest128) Sum128() (h1, h2 uint64) {
	return sum128(d.h1, d.h2, d.tail, d.clen)
}

// Clone returns a copy of the hash. Writes to either copy do not affect the
// other. The returned hash is a Hash128.
func (d *digest128) Clone() (hash.Cloner, error) {
	c := *d
	c.reseat(&c)
	return &c, nil
}

// Sum128 returns the murmur3 sum of data. It is equivalent to the following
// sequence (without the extra burden and the extra allocation):
//
//	hasher := New128()
//	hasher.Write(data)
//	return hasher.Sum128()
func Sum128(data []byte) (h1 uint64, h2 uint64) {
	return sum128(0, 0, data, len(data))
}

// SeedSum128 returns the murmur3 sum of data with digests initialized to seed1
// and seed2.
//
// The canonical implementation allows only one uint32 seed; to imitate that
// behavior, use the same, uint32-max seed for seed1 and seed2.
//
// This reads and processes the data in chunks of little endian uint64s;
// thus, the returned hashes are portable across architectures.
func SeedSum128(seed1, seed2 uint64, data []byte) (h1 uint64, h2 uint64) {
	return sum128(seed1, seed2, data, len(data))
}

// StringSum128 is the string version of Sum128.
func StringSum128(data string) (h1 uint64, h2 uint64) {
	return sum128(0, 0, data, len(data))
}

// SeedStringSum128 is the string version of SeedSum128.
func SeedStringSum128(seed1, seed2 uint64, data string) (h1 uint64, h2 uint64) {
	return sum128(seed1, seed2, data, len(data))
}

// sum128 mixes all of data into the running h1 and h2 and then finalizes
// with clen, the total number of bytes hashed. The one shot sums pass all
// of their input; the streaming digest passes its leftover tail.
func sum128[T bytestring](h1, h2 uint64, data T, clen int) (uint64, uint64) {
	if len(data) >= 16 {
		// With a full block present, the last 16 bytes are always in
		// bounds and the tail is whatever of them the loop will not
		// consume, so read it here with two overlapping loads rather than
		// a switch on its length after the loop: that switch is a jump
		// table, and varying key lengths make it mispredict nearly every
		// time. Before the loop, only k1 and k2 stay live across it, and
		// the loads finish while it runs rather than after it. k1 is the
		// first eight tail bytes, loaded exactly when n >= 8 and otherwise
		// shifted down out of the last eight; k2 is what sits above those.
		// A shift of 64 or more is zero in Go, so k2 is zero for a tail of
		// eight or fewer, and mixing zero changes nothing, so the mixes
		// need no guard.
		n := len(data) & 15
		var k1, k2 uint64
		if n != 0 {
			end := data[len(data)-16:]
			m := max(n, 8)
			k1 = load64(end[16-m:24-m]) >> (8 * uint(8-min(n, 8)))
			k2 = load64(end[8:]) >> (8 * uint(16-n))
		}
		// An index loop rather than a reslicing one: the compiler proves
		// the window from the loop bound, folds the index into the loads,
		// and has one counter to advance instead of a pointer, a length
		// and a capacity. The bound is hoisted by hand because Go 1.26
		// recomputes it every iteration otherwise; 1.27 hoists it itself.
		for i, end := 0, len(data)-16; i <= end; i += 16 {
			b := data[i : i+16]
			h1, h2 = mix128(h1, h2, load64(b), load64(b[8:]))
		}

		if n != 0 {
			k2 *= c2_128
			k2 = bits.RotateLeft64(k2, 33)
			k2 *= c1_128
			h2 ^= k2
			k1 *= c1_128
			k1 = bits.RotateLeft64(k1, 31)
			k1 *= c2_128
			h1 ^= k1
		}
	} else {
		// Every case knows its exact length, so the compiler proves all bounds
		// and each case is two or three word sized loads. This is faster than
		// the canonical byte at a time fallthrough switch.
		var k1, k2 uint64
		switch len(data) {
		case 15:
			k2 = uint64(load32(data[8:])) | uint64(load16(data[12:]))<<32 | uint64(data[14])<<48
			k1 = load64(data)
		case 14:
			k2 = uint64(load32(data[8:])) | uint64(load16(data[12:]))<<32
			k1 = load64(data)
		case 13:
			k2 = uint64(load32(data[8:])) | uint64(data[12])<<32
			k1 = load64(data)
		case 12:
			k2 = uint64(load32(data[8:]))
			k1 = load64(data)
		case 11:
			k2 = uint64(load16(data[8:])) | uint64(data[10])<<16
			k1 = load64(data)
		case 10:
			k2 = uint64(load16(data[8:]))
			k1 = load64(data)
		case 9:
			k2 = uint64(data[8])
			k1 = load64(data)
		case 8:
			k1 = load64(data)
		case 7:
			k1 = uint64(load32(data)) | uint64(load16(data[4:]))<<32 | uint64(data[6])<<48
		case 6:
			k1 = uint64(load32(data)) | uint64(load16(data[4:]))<<32
		case 5:
			k1 = uint64(load32(data)) | uint64(data[4])<<32
		case 4:
			k1 = uint64(load32(data))
		case 3:
			k1 = uint64(load16(data)) | uint64(data[2])<<16
		case 2:
			k1 = uint64(load16(data))
		case 1:
			k1 = uint64(data[0])
		}
		if len(data) > 8 {
			k2 *= c2_128
			k2 = bits.RotateLeft64(k2, 33)
			k2 *= c1_128
			h2 ^= k2
		}
		if len(data) > 0 {
			k1 *= c1_128
			k1 = bits.RotateLeft64(k1, 31)
			k1 *= c2_128
			h1 ^= k1
		}

	}

	h1 ^= uint64(clen)
	h2 ^= uint64(clen)

	h1 += h2
	h2 += h1

	h1 = fmix64(h1)
	h2 = fmix64(h2)

	h1 += h2
	h2 += h1

	return h1, h2
}

// mix128 folds one 16 byte block, already split into k1 and k2, into the
// running hash.
func mix128(h1, h2, k1, k2 uint64) (uint64, uint64) {
	k1 *= c1_128
	k1 = bits.RotateLeft64(k1, 31)
	k1 *= c2_128
	h1 ^= k1

	h1 = bits.RotateLeft64(h1, 27)
	h1 += h2
	h1 = h1*5 + 0x52dce729

	k2 *= c2_128
	k2 = bits.RotateLeft64(k2, 33)
	k2 *= c1_128
	h2 ^= k2

	h2 = bits.RotateLeft64(h2, 31)
	h2 += h1
	h2 = h2*5 + 0x38495ab5

	return h1, h2
}

func fmix64(k uint64) uint64 {
	k ^= k >> 33
	k *= 0xff51afd7ed558ccd
	k ^= k >> 33
	k *= 0xc4ceb9fe1a85ec53
	k ^= k >> 33
	return k
}
