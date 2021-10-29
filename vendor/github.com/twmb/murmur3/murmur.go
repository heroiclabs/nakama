// Copyright 2013, Sébastien Paolacci. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package murmur3 provides an amd64 native (Go generic fallback)
// implementation of the murmur3 hash algorithm for strings and slices.
//
// Assembly is provided for amd64 go1.5+; pull requests are welcome for other
// architectures.
package murmur3

import (
	"reflect"
	"unsafe"
)

type bmixer interface {
	bmix(p []byte) (tail []byte)
	Size() (n int)
	reset()
}

type digest struct {
	clen int      // Digested input cumulative length.
	tail []byte   // 0 to Size()-1 bytes view of `buf'.
	buf  [16]byte // Expected (but not required) to be Size() large.
	bmixer
}

func (d *digest) BlockSize() int { return 1 }

func (d *digest) Write(p []byte) (n int, err error) {
	n = len(p)
	d.clen += n

	if len(d.tail) > 0 {
		// Stick back pending bytes.
		nfree := d.Size() - len(d.tail) // nfree ∈ [1, d.Size()-1].
		if nfree < len(p) {
			// One full block can be formed.
			block := append(d.tail, p[:nfree]...)
			p = p[nfree:]
			_ = d.bmix(block) // No tail.
		} else {
			// Tail's buf is large enough to prevent reallocs.
			p = append(d.tail, p...)
		}
	}

	d.tail = d.bmix(p)

	// Keep own copy of the 0 to Size()-1 pending bytes.
	nn := copy(d.buf[:], d.tail)
	d.tail = d.buf[:nn]

	return n, nil
}

func (d *digest) Reset() {
	d.clen = 0
	d.tail = nil
	d.bmixer.reset()
}

func strslice(slice []byte) string {
	var str string
	slicehdr := ((*reflect.SliceHeader)(unsafe.Pointer(&slice)))
	strhdr := (*reflect.StringHeader)(unsafe.Pointer(&str))
	strhdr.Data = slicehdr.Data
	strhdr.Len = slicehdr.Len
	return str
}
