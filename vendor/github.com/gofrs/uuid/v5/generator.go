// Copyright (C) 2013-2018 by Maxim Bublis <b@codemonkey.ru>
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

package uuid

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// Difference in 100-nanosecond intervals between
// UUID epoch (October 15, 1582) and Unix epoch (January 1, 1970).
const epochStart = 122192928000000000

// V7 carries its monotonic counter in rand_a, the 12 bits sitting between the
// version nibble and the variant.
const maxV7Counter = 0x0fff

// V7 timestamps are an unsigned 48 bit count of milliseconds since the Unix
// epoch, a range that runs from 1970 into the year 10889.
const maxV7Timestamp = 1<<48 - 1

// The counter is seeded with 11 random bits at the start of every timestamp
// tick, as described by RFC 9562 section 6.2 under "Fixed Bit-Length Dedicated
// Counter Seeding". The leading bit is left zero to act as a rollover guard, so
// at least 2048 increments are always available within a tick.
const v7CounterSeedMask = 0x07ff

// EpochFunc is the function type used to provide the current time.
type EpochFunc func() time.Time

// HWAddrFunc is the function type used to provide hardware (MAC) addresses.
type HWAddrFunc func() (net.HardwareAddr, error)

// DefaultGenerator is the default UUID Generator used by this package.
var DefaultGenerator Generator = NewGen()

// NewV1 returns a UUID based on the current timestamp and MAC address.
func NewV1() (UUID, error) {
	return DefaultGenerator.NewV1()
}

// NewV1 returns a UUID based on the provided timestamp and MAC address.
func NewV1AtTime(atTime time.Time) (UUID, error) {
	return DefaultGenerator.NewV1AtTime(atTime)
}

// NewV3 returns a UUID based on the MD5 hash of the namespace UUID and name.
func NewV3(ns UUID, name string) UUID {
	return DefaultGenerator.NewV3(ns, name)
}

// NewV4 returns a randomly generated UUID.
func NewV4() (UUID, error) {
	return DefaultGenerator.NewV4()
}

// NewV5 returns a UUID based on SHA-1 hash of the namespace UUID and name.
func NewV5(ns UUID, name string) UUID {
	return DefaultGenerator.NewV5(ns, name)
}

// NewV6 returns a k-sortable UUID based on the current timestamp and 48 bits of
// pseudorandom data. The timestamp in a V6 UUID is the same as V1, with the bit
// order being adjusted to allow the UUID to be k-sortable.
func NewV6() (UUID, error) {
	return DefaultGenerator.NewV6()
}

// NewV6 returns a k-sortable UUID based on the provided timestamp and 48 bits of
// pseudorandom data. The timestamp in a V6 UUID is the same as V1, with the bit
// order being adjusted to allow the UUID to be k-sortable.
func NewV6AtTime(atTime time.Time) (UUID, error) {
	return DefaultGenerator.NewV6AtTime(atTime)
}

// NewV7 returns a k-sortable UUID based on the current millisecond-precision
// UNIX epoch and 74 bits of pseudorandom data. It supports single-node batch
// generation (multiple UUIDs in the same timestamp) with a 12-bit monotonic
// counter in rand_a, as described by RFC 9562 section 6.2, Method 1.
//
// UUIDs returned by a single generator are strictly increasing: each one sorts
// above the one before it, even within a millisecond and even if the system
// clock moves backwards. The counter is reseeded with each millisecond, leaving
// room for at least 2048 UUIDs within that millisecond. Beyond that the
// embedded timestamp is incremented ahead of the actual time, so generating
// UUIDs faster than roughly two million per second trades timestamp accuracy
// for ordering.
func NewV7() (UUID, error) {
	return DefaultGenerator.NewV7()
}

// NewV7AtTime returns a k-sortable UUID based on the provided
// millisecond-precision UNIX epoch and 74 bits of pseudorandom data. It supports
// single-node batch generation (multiple UUIDs in the same timestamp) with a
// 12-bit monotonic counter in rand_a, as described by RFC 9562 section 6.2,
// Method 1.
//
// The provided timestamp is used as the starting point for generation, so unlike
// NewV7 the ordering guarantee only holds for timestamps that do not move
// backwards. Timestamps that repeat or advance behave as they do for NewV7,
// including the embedded timestamp being incremented once the counter is exhausted.
// Providing a timestamp ahead of the clock therefore holds later NewV7 UUIDs at
// that timestamp, since going back below it would break their ordering. Times
// outside the range the 48-bit millisecond field can represent are pinned to the
// nearest end of it.
func NewV7AtTime(atTime time.Time) (UUID, error) {
	return DefaultGenerator.NewV7AtTime(atTime)
}

// NewV8 returns a custom UUID based on user-provided data as specified in RFC 9562.
// The UUID is constructed from three fields:
//   - customA: exactly 6 bytes (48 bits) - occupies bits 0-47
//   - customB: exactly 2 bytes (only lower 12 bits used) - occupies bits 52-63
//   - customC: exactly 8 bytes (only lower 62 bits used) - occupies bits 66-127
//
// Version (4 bits) and variant (2 bits) are set automatically.
// Returns ErrV8FieldLength if any field is not exactly the required length.
func NewV8(customA []byte, customB []byte, customC []byte) (UUID, error) {
	return DefaultGenerator.NewV8(customA, customB, customC)
}

// Generator provides an interface for generating UUIDs.
type Generator interface {
	NewV1() (UUID, error)
	NewV1AtTime(time.Time) (UUID, error)
	NewV3(ns UUID, name string) UUID
	NewV4() (UUID, error)
	NewV5(ns UUID, name string) UUID
	NewV6() (UUID, error)
	NewV6AtTime(time.Time) (UUID, error)
	NewV7() (UUID, error)
	NewV7AtTime(time.Time) (UUID, error)
	NewV8([]byte, []byte, []byte) (UUID, error)
}

// Gen is a reference UUID generator based on the specifications laid out in
// RFC-9562 and DCE 1.1: Authentication and Security Services. This type
// satisfies the Generator interface as defined in this package.
//
// For consumers who are generating V1 UUIDs, but don't want to expose the MAC
// address of the node generating the UUIDs, the NewGenWithHWAF() function has been
// provided as a convenience. See the function's documentation for more info.
//
// The authors of this package do not feel that the majority of users will need
// to obfuscate their MAC address, and so we recommend using NewGen() to create
// a new generator.
type Gen struct {
	clockSequenceOnce sync.Once
	hardwareAddrOnce  sync.Once
	storageMutex      sync.Mutex

	rand io.Reader

	epochFunc     EpochFunc
	hwAddrFunc    HWAddrFunc
	lastTime      uint64
	clockSequence uint16
	hardwareAddr  [6]byte

	// V7 keeps its own counter state, separate from the V1/V6 clock sequence:
	// the two measure time in different units and the counters have different
	// usable widths.
	v7LastRequestedMs uint64
	v7LastMs          uint64
	v7Counter         uint16
	v7Seeded          bool
}

// GenOption is a function type that can be used to configure a Gen generator.
type GenOption func(*Gen)

// interface check -- build will fail if *Gen doesn't satisfy Generator
var _ Generator = (*Gen)(nil)

// NewGen returns a new instance of Gen with some default values set. Most
// people should use this.
func NewGen() *Gen {
	return NewGenWithHWAF(defaultHWAddrFunc)
}

// NewGenWithHWAF builds a new UUID generator with the HWAddrFunc provided. Most
// consumers should use NewGen() instead.
//
// This is used so that consumers can generate their own MAC addresses, for use
// in the generated UUIDs, if there is some concern about exposing the physical
// address of the machine generating the UUID.
//
// The Gen generator will only invoke the HWAddrFunc once, and cache that MAC
// address for all the future UUIDs generated by it. If you'd like to switch the
// MAC address being used, you'll need to create a new generator using this
// function.
func NewGenWithHWAF(hwaf HWAddrFunc) *Gen {
	return NewGenWithOptions(WithHWAddrFunc(hwaf))
}

// NewGenWithOptions returns a new instance of Gen with the options provided.
// Most people should use NewGen() or NewGenWithHWAF() instead.
//
// To customize the generator, you can pass in one or more GenOption functions.
// For example:
//
//	gen := NewGenWithOptions(
//	    WithHWAddrFunc(myHWAddrFunc),
//	    WithEpochFunc(myEpochFunc),
//	    WithRandomReader(myRandomReader),
//	)
//
// NewGenWithOptions(WithHWAddrFunc(myHWAddrFunc)) is equivalent to calling
// NewGenWithHWAF(myHWAddrFunc)
// NewGenWithOptions() is equivalent to calling NewGen()
func NewGenWithOptions(opts ...GenOption) *Gen {
	gen := &Gen{
		epochFunc:  time.Now,
		hwAddrFunc: defaultHWAddrFunc,
		rand:       rand.Reader,
	}

	for _, opt := range opts {
		opt(gen)
	}

	return gen
}

// WithHWAddrFunc is a GenOption that allows you to provide your own HWAddrFunc
// function.
// When this option is nil, the defaultHWAddrFunc is used.
func WithHWAddrFunc(hwaf HWAddrFunc) GenOption {
	return func(gen *Gen) {
		if hwaf == nil {
			hwaf = defaultHWAddrFunc
		}

		gen.hwAddrFunc = hwaf
	}
}

// WithEpochFunc is a GenOption that allows you to provide your own EpochFunc
// function.
// When this option is nil, time.Now is used.
func WithEpochFunc(epochf EpochFunc) GenOption {
	return func(gen *Gen) {
		if epochf == nil {
			epochf = time.Now
		}

		gen.epochFunc = epochf
	}
}

// WithRandomReader is a GenOption that allows you to provide your own random
// reader.
// When this option is nil, the default rand.Reader is used.
func WithRandomReader(reader io.Reader) GenOption {
	return func(gen *Gen) {
		if reader == nil {
			reader = rand.Reader
		}

		gen.rand = reader
	}
}

// NewV1 returns a UUID based on the current timestamp and MAC address.
func (g *Gen) NewV1() (UUID, error) {
	return g.NewV1AtTime(g.epochFunc())
}

// NewV1AtTime returns a UUID based on the provided timestamp and current MAC address.
func (g *Gen) NewV1AtTime(atTime time.Time) (UUID, error) {
	u := UUID{}

	timeNow, clockSeq, err := g.getClockSequence(atTime)
	if err != nil {
		return Nil, err
	}
	binary.BigEndian.PutUint32(u[0:], uint32(timeNow))
	binary.BigEndian.PutUint16(u[4:], uint16(timeNow>>32))
	binary.BigEndian.PutUint16(u[6:], uint16(timeNow>>48))
	binary.BigEndian.PutUint16(u[8:], clockSeq)

	hardwareAddr, err := g.getHardwareAddr()
	if err != nil {
		return Nil, err
	}
	copy(u[10:], hardwareAddr)

	u.SetVersion(V1)
	u.SetVariant(VariantRFC9562)

	return u, nil
}

// NewV3 returns a UUID based on the MD5 hash of the namespace UUID and name.
func (g *Gen) NewV3(ns UUID, name string) (u UUID) {
	h := md5.New()
	h.Write(ns[:])
	h.Write([]byte(name))
	copy(u[:], h.Sum(make([]byte, 0, md5.Size)))

	u.SetVersion(V3)
	u.SetVariant(VariantRFC9562)

	return u
}

// NewV4 returns a randomly generated UUID.
func (g *Gen) NewV4() (UUID, error) {
	u := UUID{}
	if _, err := io.ReadFull(g.rand, u[:]); err != nil {
		return Nil, err
	}
	u.SetVersion(V4)
	u.SetVariant(VariantRFC9562)

	return u, nil
}

// NewV5 returns a UUID based on SHA-1 hash of the namespace UUID and name.
func (g *Gen) NewV5(ns UUID, name string) (u UUID) {
	h := sha1.New()
	h.Write(ns[:])
	h.Write([]byte(name))
	copy(u[:], h.Sum(make([]byte, 0, sha1.Size)))

	u.SetVersion(V5)
	u.SetVariant(VariantRFC9562)

	return u
}

// NewV6 returns a k-sortable UUID based on the current timestamp and 48 bits of
// pseudorandom data. The timestamp in a V6 UUID is the same as V1, with the bit
// order being adjusted to allow the UUID to be k-sortable.
func (g *Gen) NewV6() (UUID, error) {
	return g.NewV6AtTime(g.epochFunc())
}

// NewV6 returns a k-sortable UUID based on the provided timestamp and 48 bits of
// pseudorandom data. The timestamp in a V6 UUID is the same as V1, with the bit
// order being adjusted to allow the UUID to be k-sortable.
func (g *Gen) NewV6AtTime(atTime time.Time) (UUID, error) {
	/* https://datatracker.ietf.org/doc/html/rfc9562#name-uuid-version-6
	    0                   1                   2                   3
	    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                           time_high                           |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |           time_mid            |  ver  |       time_low        |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |var|         clock_seq         |             node              |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                              node                             |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+ */
	var u UUID

	timeNow, _, err := g.getClockSequence(atTime)
	if err != nil {
		return Nil, err
	}

	binary.BigEndian.PutUint32(u[0:], uint32(timeNow>>28))   // set time_high
	binary.BigEndian.PutUint16(u[4:], uint16(timeNow>>12))   // set time_mid
	binary.BigEndian.PutUint16(u[6:], uint16(timeNow&0xfff)) // set time_low (minus four version bits)

	// Based on the RFC 9562 recommendation that this data be fully random and not a monotonic counter,
	//we do NOT support batching version 6 UUIDs.
	//set clock_seq (14 bits) and node (48 bits) pseudo-random bits (first 2 bits will be overridden)
	if _, err = io.ReadFull(g.rand, u[8:]); err != nil {
		return Nil, err
	}

	u.SetVersion(V6)

	//overwrite first 2 bits of byte[8] for the variant
	u.SetVariant(VariantRFC9562)

	return u, nil
}

// NewV7 returns a k-sortable UUID based on the current millisecond-precision
// UNIX epoch and 74 bits of pseudorandom data. UUIDs returned by a single
// generator are strictly increasing; see the package-level NewV7 for the
// details of that guarantee.
func (g *Gen) NewV7() (UUID, error) {
	return g.newV7(g.epochFunc(), true)
}

// NewV7AtTime returns a k-sortable UUID based on the provided
// millisecond-precision UNIX epoch and 74 bits of pseudorandom data. See the
// package-level NewV7AtTime for how the provided timestamp interacts with the
// monotonic counter.
func (g *Gen) NewV7AtTime(atTime time.Time) (UUID, error) {
	return g.newV7(atTime, false)
}

// newV7 builds a V7 UUID for atTime. When clampBackwards is set, a timestamp
// older than the last one seen is replaced by that last timestamp so a
// backwards-moving clock cannot produce out-of-order UUIDs. Callers that pass a
// timestamp explicitly leave it unset, so that a deliberately older timestamp is
// encoded as given.
func (g *Gen) newV7(atTime time.Time, clampBackwards bool) (UUID, error) {
	var u UUID
	/* https://datatracker.ietf.org/doc/html/rfc9562#name-uuid-version-7
	    0                   1                   2                   3
	    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                           unix_ts_ms                          |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |          unix_ts_ms           |  ver  |       rand_a          |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |var|                        rand_b                             |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                            rand_b                             |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+ */

	// A time outside the range the timestamp field can hold has no
	// representation, so the nearest end of that range stands in for it rather
	// than the unrelated value the field would otherwise wrap to.
	atMs := min(uint64(max(atTime.UnixMilli(), 0)), maxV7Timestamp)

	ms, counter, err := g.nextV7Sequence(atMs, clampBackwards)
	if err != nil {
		return Nil, err
	}
	//UUIDv7 features a 48 bit timestamp. First 32bit (4bytes) represents seconds since 1970, followed by 2 bytes for the ms granularity.
	u[0] = byte(ms >> 40) //1-6 bytes: big-endian unsigned number of Unix epoch timestamp
	u[1] = byte(ms >> 32)
	u[2] = byte(ms >> 24)
	u[3] = byte(ms >> 16)
	u[4] = byte(ms >> 8)
	u[5] = byte(ms)

	//Support batching by using a dedicated counter in rand_a,
	//as described in RFC 9562 section 6.2, Method 1.
	//The 6th byte contains the version and the top 4 bits of rand_a, so the
	//counter is 12 bits wide and fits entirely below the version nibble.
	binary.BigEndian.PutUint16(u[6:8], counter) // set rand_a with the monotonic counter

	//override first 4bits of u[6].
	u.SetVersion(V7)

	//set rand_b 64bits of pseudo-random bits (first 2 will be overridden)
	if _, err = io.ReadFull(g.rand, u[8:16]); err != nil {
		return Nil, err
	}
	//override first 2 bits of byte[8] for the variant
	u.SetVariant(VariantRFC9562)

	return u, nil
}

// NewV8 returns a UUID based on user-provided data as specified in RFC 9562.
// See the package-level NewV8 function for documentation.
func (g *Gen) NewV8(customA []byte, customB []byte, customC []byte) (UUID, error) {
	var u UUID
	/* https://datatracker.ietf.org/doc/html/rfc9562#name-uuid-version-8
	    0                   1                   2                   3
	    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                          custom_a                            |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |          custom_a             |  ver  |       custom_b        |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |var|                        custom_c                          |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
	   |                          custom_c                            |
	   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+ */

	// Validate input lengths
	if len(customA) != 6 {
		return Nil, fmt.Errorf("%w: customA must be exactly 6 bytes (48 bits), got %d", ErrV8FieldLength, len(customA))
	}
	if len(customB) != 2 {
		return Nil, fmt.Errorf("%w: customB must be exactly 2 bytes (16 bits, where 12 bits are used per RFC9562), got %d", ErrV8FieldLength, len(customB))
	}
	if len(customC) != 8 {
		return Nil, fmt.Errorf("%w: customC must be exactly 8 bytes (64 bits, where 62 bits are used per RFC9562), got %d", ErrV8FieldLength, len(customC))
	}

	// Copy customA (48 bits = 6 bytes) into u[0:6]
	copy(u[0:6], customA)

	// Copy customB (16 bits from 2 bytes) into u[6:8]
	// the high 4 bits of u[6] will be overwritten by version
	copy(u[6:8], customB)

	// Copy customC (62 bits from 8 bytes) into u[8:16]
	// The high 2 bits of u[8] will be overwritten by variant
	copy(u[8:16], customC)

	u.SetVersion(V8)
	u.SetVariant(VariantRFC9562)

	return u, nil
}

// nextV7Sequence returns the millisecond timestamp and the 12-bit counter to
// encode into a V7 UUID. The pair strictly increases from one call to the next,
// which is what makes the resulting UUIDs sortable in generation order.
//
// The counter is reseeded whenever the timestamp ticks over and incremented
// otherwise. Once it runs out of room within a tick, the timestamp is
// incremented ahead of the actual time and the counter reseeded, one of the two
// rollover strategies allowed by RFC 9562 section 6.2. The alternative, waiting
// for the clock to catch up, is not open to us: the timestamp can be supplied by
// the caller and is then under no obligation to advance.
func (g *Gen) nextV7Sequence(ms uint64, clampBackwards bool) (uint64, uint16, error) {
	g.storageMutex.Lock()
	defer g.storageMutex.Unlock()

	// The counter starts over on a new tick. A provided timestamp that predates
	// the one provided last also starts it over, since that is a request for an
	// older UUID rather than a clock to be corrected for. The comparison for a
	// new tick is against the timestamp last encoded, which a rollover may have
	// pushed ahead of the one last provided.
	if !g.v7Seeded || ms > g.v7LastMs || (!clampBackwards && ms < g.v7LastRequestedMs) {
		counter, err := g.seedV7Counter()
		if err != nil {
			return 0, 0, err
		}
		g.v7Seeded = true
		g.v7LastMs, g.v7LastRequestedMs, g.v7Counter = ms, ms, counter

		return ms, counter, nil
	}

	// Still within the tick last encoded, either because the timestamp repeats
	// or because it moved backwards and is being held at the last value.
	if g.v7Counter >= maxV7Counter {
		counter, err := g.seedV7Counter()
		if err != nil {
			return 0, 0, err
		}
		g.v7LastMs, g.v7Counter = g.v7LastMs+1, counter
	} else {
		g.v7Counter++
	}
	g.v7LastRequestedMs = ms

	return g.v7LastMs, g.v7Counter, nil
}

// seedV7Counter draws a fresh value for the start of a timestamp tick, leaving
// the counter's leading bit clear as a rollover guard.
func (g *Gen) seedV7Counter() (uint16, error) {
	var buf [2]byte
	if _, err := io.ReadFull(g.rand, buf[:]); err != nil {
		return 0, err
	}

	return binary.BigEndian.Uint16(buf[:]) & v7CounterSeedMask, nil
}

// getClockSequence returns the epoch and clock sequence of the provided time,
// used for generating V1 and V6 UUIDs.
//
// The epoch is the Coordinated Universal Time (UTC) as a count of 100-nanosecond
// intervals since 00:00:00.00, 15 October 1582 (the date of Gregorian reform to
// the Christian calendar).
func (g *Gen) getClockSequence(atTime time.Time) (uint64, uint16, error) {
	var err error
	g.clockSequenceOnce.Do(func() {
		buf := make([]byte, 2)
		if _, err = io.ReadFull(g.rand, buf); err != nil {
			return
		}
		g.clockSequence = binary.BigEndian.Uint16(buf)
	})
	if err != nil {
		return 0, 0, err
	}

	g.storageMutex.Lock()
	defer g.storageMutex.Unlock()

	timeNow := g.getEpoch(atTime)
	// Clock didn't change since last UUID generation.
	// Should increase clock sequence.
	if timeNow <= g.lastTime {
		g.clockSequence++
	}
	g.lastTime = timeNow

	return timeNow, g.clockSequence, nil
}

// Returns the hardware address.
func (g *Gen) getHardwareAddr() ([]byte, error) {
	var err error
	g.hardwareAddrOnce.Do(func() {
		var hwAddr net.HardwareAddr
		if hwAddr, err = g.hwAddrFunc(); err == nil {
			copy(g.hardwareAddr[:], hwAddr)
			return
		}

		// Initialize hardwareAddr randomly in case
		// of real network interfaces absence.
		if _, err = io.ReadFull(g.rand, g.hardwareAddr[:]); err != nil {
			return
		}
		// Set multicast bit as recommended by RFC-9562
		g.hardwareAddr[0] |= 0x01
	})
	if err != nil {
		return []byte{}, err
	}
	return g.hardwareAddr[:], nil
}

// Returns the difference between UUID epoch (October 15, 1582)
// and the provided time in 100-nanosecond intervals.
func (g *Gen) getEpoch(atTime time.Time) uint64 {
	return epochStart + uint64(atTime.UnixNano()/100)
}

var netInterfaces = net.Interfaces

// Returns the hardware address.
func defaultHWAddrFunc() (net.HardwareAddr, error) {
	ifaces, err := netInterfaces()
	if err != nil {
		return []byte{}, err
	}
	for _, iface := range ifaces {
		if len(iface.HardwareAddr) >= 6 {
			return iface.HardwareAddr, nil
		}
	}
	return []byte{}, ErrNoHwAddressFound
}
