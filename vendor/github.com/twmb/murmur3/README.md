murmur3
=======

Native Go implementation of Austin Appleby's third MurmurHash revision (aka
MurmurHash3).

Includes assembly for amd64 for 64/128 bit hashes, seeding functions,
and string functions to avoid string to slice conversions.

Hand rolled 32 bit assembly was removed during 1.11, but may be reintroduced
if the compiler slows down any more. As is, the compiler generates marginally
slower code (by one instruction in the hot loop).

The reference algorithm has been slightly hacked as to support the streaming mode
required by Go's standard [Hash interface](http://golang.org/pkg/hash/#Hash).

Endianness
==========

Unlike the canonical source, this library **always** reads bytes as little
endian numbers. This makes the hashes portable across architectures, although
does mean that hashing is a bit slower on big endian architectures.

Safety
======

This library used to use `unsafe` to convert four bytes to a `uint32` and eight
bytes to a `uint64`, but Go 1.14 introduced checks around those types of
conversions that flagged that code as erroneous when hashing on unaligned
input. While the code would not be problematic on amd64, it could be
problematic on some architectures.

As of Go 1.14, those conversions were removed at the expense of a very minor
performance hit. This hit affects all cpu architectures on for `Sum32`, and
non-amd64 architectures for `Sum64` and `Sum128`. For 64 and 128, custom
assembly exists for amd64 that preserves performance.

Testing
=======

[![Build Status](https://travis-ci.org/twmb/murmur3.svg?branch=master)](https://travis-ci.org/twmb/murmur3)

Testing includes comparing random inputs against the [canonical
implementation](https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp),
and testing length 0 through 17 inputs to force all branches.

Because this code always reads input as little endian, testing against the
canonical source is skipped for big endian architectures. The canonical source
just converts bytes to numbers, meaning on big endian architectures, it will
use different numbers for its hashing.

Documentation
=============

[![GoDoc](https://godoc.org/github.com/twmb/murmur3?status.svg)](https://godoc.org/github.com/twmb/murmur3)

Full documentation can be found on `godoc`.

Benchmarks
==========

Benchmarks below were run on an amd64 machine with _and_ without the custom
assembly. The following numbers are for Go 1.14.1 and are comparing against
[spaolacci/murmur3](https://github.com/spaolacci/murmur3).

You will notice that at small sizes, the other library is better. This is due
to this library converting to safe code for Go 1.14. At large sizes, this
library is nearly identical to the other. On amd64, the 64 bit and 128 bit
sums come out to ~9% faster.

32 bit sums:

```
32Sizes/32-12     3.00GB/s ± 1%  2.12GB/s ±11%  -29.24%  (p=0.000 n=9+10)
32Sizes/64-12     3.61GB/s ± 3%  2.79GB/s ± 8%  -22.62%  (p=0.000 n=10+10)
32Sizes/128-12    3.47GB/s ± 8%  2.79GB/s ± 4%  -19.47%  (p=0.000 n=10+10)
32Sizes/256-12    3.66GB/s ± 4%  3.25GB/s ± 6%  -11.09%  (p=0.000 n=10+10)
32Sizes/512-12    3.78GB/s ± 3%  3.54GB/s ± 4%   -6.30%  (p=0.000 n=9+9)
32Sizes/1024-12   3.86GB/s ± 3%  3.69GB/s ± 5%   -4.46%  (p=0.000 n=10+10)
32Sizes/2048-12   3.85GB/s ± 3%  3.81GB/s ± 3%     ~     (p=0.079 n=10+9)
32Sizes/4096-12   3.90GB/s ± 3%  3.82GB/s ± 2%   -2.14%  (p=0.029 n=10+10)
32Sizes/8192-12   3.82GB/s ± 3%  3.78GB/s ± 7%     ~     (p=0.529 n=10+10)
```

64/128 bit sums, non-amd64:

```
64Sizes/32-12     2.34GB/s ± 5%  2.64GB/s ± 9%  +12.87%  (p=0.000 n=10+10)
64Sizes/64-12     3.62GB/s ± 5%  3.96GB/s ± 4%   +9.41%  (p=0.000 n=10+10)
64Sizes/128-12    5.12GB/s ± 3%  5.44GB/s ± 4%   +6.09%  (p=0.000 n=10+9)
64Sizes/256-12    6.35GB/s ± 2%  6.27GB/s ± 9%     ~     (p=0.796 n=10+10)
64Sizes/512-12    6.58GB/s ± 7%  6.79GB/s ± 3%     ~     (p=0.075 n=10+10)
64Sizes/1024-12   7.49GB/s ± 3%  7.55GB/s ± 9%     ~     (p=0.393 n=10+10)
64Sizes/2048-12   8.06GB/s ± 2%  7.90GB/s ± 6%     ~     (p=0.156 n=9+10)
64Sizes/4096-12   8.27GB/s ± 6%  8.22GB/s ± 5%     ~     (p=0.631 n=10+10)
64Sizes/8192-12   8.35GB/s ± 4%  8.38GB/s ± 6%     ~     (p=0.631 n=10+10)
128Sizes/32-12    2.27GB/s ± 2%  2.68GB/s ± 5%  +18.00%  (p=0.000 n=10+10)
128Sizes/64-12    3.55GB/s ± 2%  4.00GB/s ± 3%  +12.47%  (p=0.000 n=8+9)
128Sizes/128-12   5.09GB/s ± 1%  5.43GB/s ± 3%   +6.65%  (p=0.000 n=9+9)
128Sizes/256-12   6.33GB/s ± 3%  5.65GB/s ± 4%  -10.79%  (p=0.000 n=9+10)
128Sizes/512-12   6.78GB/s ± 3%  6.74GB/s ± 6%     ~     (p=0.968 n=9+10)
128Sizes/1024-12  7.46GB/s ± 4%  7.56GB/s ± 4%     ~     (p=0.222 n=9+9)
128Sizes/2048-12  7.99GB/s ± 4%  7.96GB/s ± 3%     ~     (p=0.666 n=9+9)
128Sizes/4096-12  8.20GB/s ± 2%  8.25GB/s ± 4%     ~     (p=0.631 n=10+10)
128Sizes/8192-12  8.24GB/s ± 2%  8.26GB/s ± 5%     ~     (p=0.673 n=8+9)
```

64/128 bit sums, amd64:

```
64Sizes/32-12     2.34GB/s ± 5%  4.36GB/s ± 3%  +85.86%  (p=0.000 n=10+10)
64Sizes/64-12     3.62GB/s ± 5%  6.27GB/s ± 3%  +73.37%  (p=0.000 n=10+9)
64Sizes/128-12    5.12GB/s ± 3%  7.70GB/s ± 6%  +50.27%  (p=0.000 n=10+10)
64Sizes/256-12    6.35GB/s ± 2%  8.61GB/s ± 3%  +35.50%  (p=0.000 n=10+10)
64Sizes/512-12    6.58GB/s ± 7%  8.59GB/s ± 4%  +30.48%  (p=0.000 n=10+9)
64Sizes/1024-12   7.49GB/s ± 3%  8.81GB/s ± 2%  +17.66%  (p=0.000 n=10+10)
64Sizes/2048-12   8.06GB/s ± 2%  8.90GB/s ± 4%  +10.49%  (p=0.000 n=9+10)
64Sizes/4096-12   8.27GB/s ± 6%  8.90GB/s ± 4%   +7.54%  (p=0.000 n=10+10)
64Sizes/8192-12   8.35GB/s ± 4%  9.00GB/s ± 3%   +7.80%  (p=0.000 n=10+9)
128Sizes/32-12    2.27GB/s ± 2%  4.29GB/s ± 9%  +88.75%  (p=0.000 n=10+10)
128Sizes/64-12    3.55GB/s ± 2%  6.10GB/s ± 8%  +71.78%  (p=0.000 n=8+10)
128Sizes/128-12   5.09GB/s ± 1%  7.62GB/s ± 9%  +49.63%  (p=0.000 n=9+10)
128Sizes/256-12   6.33GB/s ± 3%  8.65GB/s ± 3%  +36.71%  (p=0.000 n=9+10)
128Sizes/512-12   6.78GB/s ± 3%  8.39GB/s ± 6%  +23.77%  (p=0.000 n=9+10)
128Sizes/1024-12  7.46GB/s ± 4%  8.70GB/s ± 4%  +16.70%  (p=0.000 n=9+10)
128Sizes/2048-12  7.99GB/s ± 4%  8.73GB/s ± 8%   +9.26%  (p=0.003 n=9+10)
128Sizes/4096-12  8.20GB/s ± 2%  8.86GB/s ± 6%   +8.00%  (p=0.000 n=10+10)
128Sizes/8192-12  8.24GB/s ± 2%  9.01GB/s ± 3%   +9.30%  (p=0.000 n=8+10)
```
