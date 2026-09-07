package murmur3

import (
	"hash"
	"math/bits"
)

// Make sure interfaces are correctly implemented.
var (
	_ hash.Hash   = new(digest32)
	_ hash.Hash32 = new(digest32)
	_ hash.Cloner = new(digest32)
)

const (
	c1_32 uint32 = 0xcc9e2d51
	c2_32 uint32 = 0x1b873593
)

// digest32 represents a partial evaluation of a 32 bites hash.
type digest32 struct {
	digest
	seed uint32
	h1   uint32 // Unfinalized running hash.
}

// SeedNew32 returns a hash.Hash32 for streaming 32 bit sums with its internal
// digest initialized to seed.
//
// This reads and processes the data in chunks of little endian uint32s;
// thus, the returned hash is portable across architectures.
func SeedNew32(seed uint32) hash.Hash32 {
	d := &digest32{seed: seed}
	d.bmixer = d
	d.Reset()
	return d
}

// New32 returns a hash.Hash32 for streaming 32 bit sums.
func New32() hash.Hash32 {
	return SeedNew32(0)
}

func (d *digest32) Size() int { return 4 }

func (d *digest32) reset() { d.h1 = d.seed }

func (d *digest32) Sum(b []byte) []byte {
	h := d.Sum32()
	return append(b, byte(h>>24), byte(h>>16), byte(h>>8), byte(h))
}

// Digest as many blocks as possible.
func (d *digest32) bmix(p []byte) (tail []byte) {
	h1 := d.h1
	i := 0
	for end := len(p) - 4; i <= end; i += 4 {
		h1 = mix32(h1, load32(p[i:i+4]))
	}
	d.h1 = h1
	return p[i:]
}

func (d *digest32) Sum32() (h1 uint32) {
	return sum32(d.h1, d.tail, d.clen)
}

// Clone returns a copy of the hash. Writes to either copy do not affect the
// other. The returned hash is a hash.Hash32.
func (d *digest32) Clone() (hash.Cloner, error) {
	c := *d
	c.reseat(&c)
	return &c, nil
}

// Sum32 returns the murmur3 sum of data. It is equivalent to the following
// sequence (without the extra burden and the extra allocation):
//
//	hasher := New32()
//	hasher.Write(data)
//	return hasher.Sum32()
func Sum32(data []byte) uint32 {
	return sum32(0, data, len(data))
}

// SeedSum32 returns the murmur3 sum of data with the digest initialized to
// seed.
//
// This reads and processes the data in chunks of little endian uint32s;
// thus, the returned hash is portable across architectures.
func SeedSum32(seed uint32, data []byte) (h1 uint32) {
	return sum32(seed, data, len(data))
}

// StringSum32 is the string version of Sum32.
func StringSum32(data string) uint32 {
	return sum32(0, data, len(data))
}

// SeedStringSum32 is the string version of SeedSum32.
func SeedStringSum32(seed uint32, data string) (h1 uint32) {
	return sum32(seed, data, len(data))
}

// sum32 mixes all of data into the running h1 and then finalizes with clen,
// the total number of bytes hashed. The one shot sums pass all of their
// input; the streaming digest passes its leftover tail.
func sum32[T bytestring](h1 uint32, data T, clen int) uint32 {
	if len(data) >= 4 {
		// See sum128: the last four bytes are in bounds, so shift the tail
		// out of them before the loop rather than branch on its length
		// after it.
		n := len(data) & 3
		var k1 uint32
		if n != 0 {
			end := data[len(data)-4:]
			k1 = load32(end[:4]) >> (8 * uint(4-n))
		}
		// An index loop with a hoisted bound, as in sum128.
		for i, end := 0, len(data)-4; i <= end; i += 4 {
			h1 = mix32(h1, load32(data[i:i+4]))
		}

		if n != 0 {
			k1 *= c1_32
			k1 = bits.RotateLeft32(k1, 15)
			k1 *= c2_32
			h1 ^= k1
		}
	} else {
		var k1 uint32
		switch len(data) {
		case 3:
			k1 ^= uint32(data[2]) << 16
			fallthrough
		case 2:
			k1 ^= uint32(data[1]) << 8
			fallthrough
		case 1:
			k1 ^= uint32(data[0])
			k1 *= c1_32
			k1 = bits.RotateLeft32(k1, 15)
			k1 *= c2_32
			h1 ^= k1
		}

	}

	h1 ^= uint32(clen)

	h1 ^= h1 >> 16
	h1 *= 0x85ebca6b
	h1 ^= h1 >> 13
	h1 *= 0xc2b2ae35
	h1 ^= h1 >> 16

	return h1
}

// mix32 folds one 4 byte block into the running hash.
func mix32(h1, k1 uint32) uint32 {
	k1 *= c1_32
	k1 = bits.RotateLeft32(k1, 15)
	k1 *= c2_32

	h1 ^= k1
	h1 = bits.RotateLeft32(h1, 13)
	return h1*5 + 0xe6546b64
}
