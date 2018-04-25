# vellum file format v1

The v1 file format for vellum has been designed by trying to understand the file format used by [BurntSushi/fst](https://github.com/BurntSushi/fst) library.  It should be binary compatible, but no attempt has been made to verify this.

## Overview

The file has 3 sections:
 - header
 - edge/transition data
 - footer

### Header

The header is 16 bytes in total.
 - 8 bytes version, uint64 little-endian
 - 8 bytes type, uint64 little-endian (currently always 0, no meaning assigned)

A side-effect of this header is that when computing transition target addresses at runtime, any address < 16 is invalid.

### State/Transition Data

A state is encoded with the following sections, HOWEVER, many sections are optional and omitted for various combinations of settings.  In the order they occur:

- node final output value (packed integer of the computed output size for this node)
- n transition output values (packed integers, of the computed output size for this node, in REVERSE transition order)
- n transition addresses (delta encoded, relative the lowest byte of this node, packed at the computed transition address size for this node, in REVERSE transition order)
- n transition bytes (1 byte for each transition, in REVERSE transition order)
- pack sizes, 1 byte, high 4 bits transition address size, low 4 bits output size
- number of transitions, 1 byte (ONLY if it didn't fit in the top byte), value of 1 in this byte means 256 (1 would have fit into the top byte)
- single transition byte, 1 byte (ONLY if it didn't fit in the top byte)
- top byte, encodes various flags, and uses remaining bits depending on those flags, broken out separate below

#### State Top Byte

 - high bit
  - 1 means, this edge has just 1 transition
  - 0 means, this edge has multiple transitions

##### 1 transition States

 - second bit flags jump to previous
  - 1 means this transition target is the immediately preceding state
  - 0 means there will transition address in the rest of the data

 - remaining 6 bits attempt to encode the transition byte
  - Obviously this requires 8 bits, but we map the most frequently used bytes into the lowest 6 bits (see common.go). If the byte we need to encode doesn't fit, we encode 0, and read it fully in the following byte. This allows the most common bytes in a single transition edge to fit into just a single byte.

##### Multiple Transition States

 - second bit flags final states
  - 1 means this is a final state
  - 0 means this is not a final state

 - remaining 6 bits attempt to encode the number of transitions
  - Obviously, this can require 8 bits, be we assume that many states have fewer transition, and will fit. If the number won't fit, we encode 0 here, and read it fully in the following byte. Because we could 256 transitions, that full byte still isn't enough, so we reuse the value 1 to mean 256. The value of 1 would never naturally occur in this position, since 1 transition would have fit into the top byte (NOTE: single transition states that are final are encoded as multi-transition states, but the value of 1 would fit in the top 6 bytes).

### Single Transition Jump To Previous

The flag marking that a single transition state should jump to the previous state works because we encode all of the node data backwards (ie, we start processing state date with the last byte).  Since, at runtime, we can always compute the lowest byte of the state we're in, we can trivially compute the start address of the previous node, just by subtracting one.  This allows saving another set of bytes in many cases which would have otherwise been needed to encode that address.

### Delta Addresses

All transition target addresses are delta encoded, relative to the lowest byte in the current state.

### Packed Integer Encoding

For both the output values and transition target addresses, we choose a fixed size number of bytes that will work for encoding all the appropriate values in this state.  Because this length will be recorded (in the pack sizes section), we don't need to use varint encoding, we can instead simply use the minimum number of bytes required.  So, 8-bit values take just 1 byte, etc.  This has the advantage that small values take less space, but the sizes are still fixed, so we can easily navigate without excessive computation.


### Footer

The footer is 16 bytes in total.
- 8 bytes number of keys, uint64 little-endian
- 8 bytes root address (absolute, not delta encoded like other addresses in file), uint64 little-endian

## Encoding Streaming

States are written out to the underlying writer as soon as possible.  This allows us to get an early start on I/O while still building the FST, reducing the overall time to build, and it also allows us to reduce the memory consumed during the build process.

Because of this, the root node will always be the last node written in the file.
