murmur3
=======

[![Go Reference](https://pkg.go.dev/badge/github.com/twmb/murmur3.svg)](https://pkg.go.dev/github.com/twmb/murmur3)
[![ci](https://github.com/twmb/murmur3/actions/workflows/ci.yml/badge.svg)](https://github.com/twmb/murmur3/actions/workflows/ci.yml)

Native Go implementation of Austin Appleby's third MurmurHash revision (aka
MurmurHash3).

Includes 32, 64, and 128 bit sums, seeding functions, string functions that
hash without converting to a slice, and streaming hashes implementing Go's
standard [Hash](https://pkg.go.dev/hash#Hash) and
[Cloner](https://pkg.go.dev/hash#Cloner) interfaces.

This library started as a fork of [spaolacci/murmur3](https://github.com/spaolacci/murmur3).
The reference algorithm has been slightly hacked as to support the streaming
mode required by Go's standard Hash interface.

Endianness
==========

Unlike the canonical source, this library **always** reads bytes as little
endian numbers. This makes the hashes portable across architectures, although
does mean that hashing is a bit slower on big endian architectures.

Safety
======

This library uses no `unsafe`. Bytes are read with plain indexing, which the
compiler turns into single word sized loads on architectures that allow
unaligned access, and the loops are shaped so that the compiler proves every
index in bounds. Strings are hashed through one implementation generic over
`string | []byte`, so hashing a string does not copy it and does not
allocate.

Assembly
========

Earlier versions shipped hand rolled amd64 assembly for the 64 and 128 bit
sums. That assembly was removed once the compiler's output caught up: as of
Go 1.27, the pure Go code is faster than the old assembly for every input
under 64 bytes, for keys of varying length, and for every 32 bit sum, and 1
to 7 percent slower on fixed inputs of 64 bytes and more. The 32 bit assembly
was removed for the same reason back in Go 1.11. See the benchmarks below.

Testing
=======

Testing includes comparing random inputs against the [canonical
implementation](https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp),
and testing length 0 through 100 inputs to force the block loop, the trailing
block, and all tail lengths.

Because this code always reads input as little endian, testing against the
canonical source is skipped for big endian architectures. The canonical source
just converts bytes to numbers, meaning on big endian architectures, it will
use different numbers for its hashing.

Benchmarks
==========

Cycles per call from perf (`cycles:u` at a fixed iteration count, minimum of
three runs) on a Comet Lake i7-10710U, so CPU frequency and thermal
throttling drop out. `asm` is the amd64 assembly this library shipped through
v1.1.8; the other columns are this code built by that Go release. Go 1.26
is the minimum this module declares. `Sizes`
rows exercise the block loop, `Branches` rows the 0 to 16 byte tail, and
`RandomLengths` rows draw an xorshift length in [0, 64) on every call.

```
benchmark              asm  go1.26  go1.27   1.26/asm 1.27/asm
128Branches/3           25      21      21     -16.7%   -16.7%
128Branches/7           26      21      21     -18.6%   -18.5%
128Branches/13          25      22      22     -12.5%   -14.5%
128Branches/16          27      26      26      -1.4%    -1.3%
128Sizes/32             35      34      34      -2.3%    -2.2%
128Sizes/64             48      48      49      +1.2%    +1.2%
128Sizes/256           140     149     149      +6.9%    +6.8%
128Sizes/1024          534     567     557      +6.2%    +4.3%
128Sizes/8192         4215    4361    4363      +3.5%    +3.5%
64Sizes/32              35      34      34      -3.7%    -3.5%
64Sizes/1024           535     575     557      +7.4%    +4.1%
64Sizes/8192          4221    4360    4366      +3.3%    +3.4%
32Branches/3            15      16      16      +5.2%    +5.6%
32Sizes/32              50      41      41     -18.2%   -18.0%
32Sizes/64              89      77      77     -13.6%   -13.6%
32Sizes/256            322     296     302      -7.9%    -6.2%
32Sizes/1024          1284    1243    1211      -3.2%    -5.7%
32Sizes/8192         10080    9896    9582      -1.8%    -4.9%
RandomLengths128       110      91      90     -18.0%   -18.2%
RandomLengths32         96      83      85     -13.5%   -11.4%
```
