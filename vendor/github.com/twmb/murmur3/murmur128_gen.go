//go:build !go1.5 || !amd64 || gccgo
// +build !go1.5 !amd64 gccgo

package murmur3

import "math/bits"

// Sum128 returns the murmur3 sum of data. It is equivalent to the following
// sequence (without the extra burden and the extra allocation):
//
//	hasher := New128()
//	hasher.Write(data)
//	return hasher.Sum128()
func Sum128(data []byte) (h1 uint64, h2 uint64) {
	return SeedSum128(0, 0, data)
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
	h1, h2 = seed1, seed2
	clen := len(data)
	for len(data) >= 16 {
		// yes, this is faster than using binary.LittleEndian.Uint64
		k1 := uint64(data[0]) | uint64(data[1])<<8 | uint64(data[2])<<16 | uint64(data[3])<<24 | uint64(data[4])<<32 | uint64(data[5])<<40 | uint64(data[6])<<48 | uint64(data[7])<<56
		k2 := uint64(data[8]) | uint64(data[9])<<8 | uint64(data[10])<<16 | uint64(data[11])<<24 | uint64(data[12])<<32 | uint64(data[13])<<40 | uint64(data[14])<<48 | uint64(data[15])<<56

		data = data[16:]

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
	}

	var k1, k2 uint64
	switch len(data) {
	case 15:
		k2 ^= uint64(data[14]) << 48
		fallthrough
	case 14:
		k2 ^= uint64(data[13]) << 40
		fallthrough
	case 13:
		k2 ^= uint64(data[12]) << 32
		fallthrough
	case 12:
		k2 ^= uint64(data[11]) << 24
		fallthrough
	case 11:
		k2 ^= uint64(data[10]) << 16
		fallthrough
	case 10:
		k2 ^= uint64(data[9]) << 8
		fallthrough
	case 9:
		k2 ^= uint64(data[8]) << 0

		k2 *= c2_128
		k2 = bits.RotateLeft64(k2, 33)
		k2 *= c1_128
		h2 ^= k2

		fallthrough

	case 8:
		k1 ^= uint64(data[7]) << 56
		fallthrough
	case 7:
		k1 ^= uint64(data[6]) << 48
		fallthrough
	case 6:
		k1 ^= uint64(data[5]) << 40
		fallthrough
	case 5:
		k1 ^= uint64(data[4]) << 32
		fallthrough
	case 4:
		k1 ^= uint64(data[3]) << 24
		fallthrough
	case 3:
		k1 ^= uint64(data[2]) << 16
		fallthrough
	case 2:
		k1 ^= uint64(data[1]) << 8
		fallthrough
	case 1:
		k1 ^= uint64(data[0]) << 0
		k1 *= c1_128
		k1 = bits.RotateLeft64(k1, 31)
		k1 *= c2_128
		h1 ^= k1
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

// StringSum128 is the string version of Sum128.
func StringSum128(data string) (h1 uint64, h2 uint64) {
	return SeedStringSum128(0, 0, data)
}

// SeedStringSum128 is the string version of SeedSum128.
func SeedStringSum128(seed1, seed2 uint64, data string) (h1 uint64, h2 uint64) {
	h1, h2 = seed1, seed2
	clen := len(data)
	for len(data) >= 16 {
		// yes, this is faster than using binary.LittleEndian.Uint64
		k1 := uint64(data[0]) | uint64(data[1])<<8 | uint64(data[2])<<16 | uint64(data[3])<<24 | uint64(data[4])<<32 | uint64(data[5])<<40 | uint64(data[6])<<48 | uint64(data[7])<<56
		k2 := uint64(data[8]) | uint64(data[9])<<8 | uint64(data[10])<<16 | uint64(data[11])<<24 | uint64(data[12])<<32 | uint64(data[13])<<40 | uint64(data[14])<<48 | uint64(data[15])<<56

		data = data[16:]

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
	}

	var k1, k2 uint64
	switch len(data) {
	case 15:
		k2 ^= uint64(data[14]) << 48
		fallthrough
	case 14:
		k2 ^= uint64(data[13]) << 40
		fallthrough
	case 13:
		k2 ^= uint64(data[12]) << 32
		fallthrough
	case 12:
		k2 ^= uint64(data[11]) << 24
		fallthrough
	case 11:
		k2 ^= uint64(data[10]) << 16
		fallthrough
	case 10:
		k2 ^= uint64(data[9]) << 8
		fallthrough
	case 9:
		k2 ^= uint64(data[8]) << 0

		k2 *= c2_128
		k2 = bits.RotateLeft64(k2, 33)
		k2 *= c1_128
		h2 ^= k2

		fallthrough

	case 8:
		k1 ^= uint64(data[7]) << 56
		fallthrough
	case 7:
		k1 ^= uint64(data[6]) << 48
		fallthrough
	case 6:
		k1 ^= uint64(data[5]) << 40
		fallthrough
	case 5:
		k1 ^= uint64(data[4]) << 32
		fallthrough
	case 4:
		k1 ^= uint64(data[3]) << 24
		fallthrough
	case 3:
		k1 ^= uint64(data[2]) << 16
		fallthrough
	case 2:
		k1 ^= uint64(data[1]) << 8
		fallthrough
	case 1:
		k1 ^= uint64(data[0]) << 0
		k1 *= c1_128
		k1 = bits.RotateLeft64(k1, 31)
		k1 *= c2_128
		h1 ^= k1
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
