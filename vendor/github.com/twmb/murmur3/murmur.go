// Copyright 2013, Sébastien Paolacci. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package murmur3 implements Austin Appleby's MurmurHash3 for strings and
// byte slices.
//
// Input is always read as little endian, so the sums are portable across
// architectures and match the canonical implementation on little endian
// machines.
package murmur3

// NOTE: sum32 and sum128 take a string rather than being generic. The
// compiler inlines an exported sum into a caller in another package, and the
// caller then calls sum32 or sum128 directly. When sum32 and sum128 were
// generic, the compiler moved a caller's input to the heap (issue #15). The
// []byte sums call unsafe.String themselves rather than through a helper,
// because a helper call puts Sum128 and SeedSum128 over the compiler's inline
// budget, and the compiler then emits a call for each Sum128 and SeedSum128.
// The sums only read the string from unsafe.String, and the string does not
// outlive the sum.

// bytestring lets one set of loads read both the streaming digests' []byte
// blocks and the one shot sums' string input.
type bytestring interface{ string | []byte }

// The compiler turns the shift and or chains below into a single unaligned
// load on architectures that support them, and the callers arrange for the
// bounds to already be proven so no checks remain in the loops.

func load64[T bytestring](b T) uint64 {
	return uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
		uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
}

func load32[T bytestring](b T) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24
}

func load16[T bytestring](b T) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8
}

// NOTE: digest holds no pointer into itself. The compiler moves a hasher
// that points to itself, or that keeps a slice of its own buf, to the heap,
// even when you create and use the hasher in one function.
type digest struct {
	clen  int      // Digested input cumulative length.
	ntail int      // Pending bytes at the front of buf, less than one block.
	buf   [16]byte // One digest128 block; digest32 uses the first 4 bytes.
}

func (d *digest) BlockSize() int { return 1 }
