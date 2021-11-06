// +build go1.5,amd64

package murmur3

//go:noescape

// Sum128 returns the murmur3 sum of data. It is equivalent to the following
// sequence (without the extra burden and the extra allocation):
//     hasher := New128()
//     hasher.Write(data)
//     return hasher.Sum128()
func Sum128(data []byte) (h1 uint64, h2 uint64)

//go:noescape

// SeedSum128 returns the murmur3 sum of data with digests initialized to seed1
// and seed2.
//
// The canonical implementation allows only one uint32 seed; to imitate that
// behavior, use the same, uint32-max seed for seed1 and seed2.
//
// This reads and processes the data in chunks of little endian uint64s;
// thus, the returned hashes are portable across architectures.
func SeedSum128(seed1, seed2 uint64, data []byte) (h1 uint64, h2 uint64)

//go:noescape

// StringSum128 is the string version of Sum128.
func StringSum128(data string) (h1 uint64, h2 uint64)

//go:noescape

// SeedStringSum128 is the string version of SeedSum128.
func SeedStringSum128(seed1, seed2 uint64, data string) (h1 uint64, h2 uint64)
