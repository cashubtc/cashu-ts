TODO:

# Done

Edited cbor.ts
Fixed map (object) encoding:
Previously the code did encodeUnsigned(keys.length, buffer) then buffer[buffer.length - 1] |= 0xa0. That only works for lengths < 24 (single-byte additional-info). For length >= 24 that OR corrupts the length bytes.
New behavior: write the initial byte for CBOR major type 5 (map) with the correct additional-info encoding (single-byte short form for <24, 0xb8 for 1-byte length, 0xb9 for 2-byte length, 0xba for 4-byte length). Also added a guard that throws if number of keys >= 2\*\*32 (same limit as encodeUnsigned).
Fixed number encoding:
Replaced the previous unconditional encodeUnsigned(value, buffer) with encodeNumber(value, buffer).
encodeNumber:
If integer >= 0: call encodeUnsigned (major type 0).
If integer < 0: call encodeSigned (major type 1) — CBOR encodes negatives as -1 - n under major type 1.
If non-integer: encode as float64 (major type 7, additional info 27, 8-byte IEEE 754 big-endian).
Added helper functions:
encodeSigned(value, buffer): encodes negative integers correctly.
encodeFloat64(value, buffer): encodes float64 big-endian with 0xfb prefix.
encodeNumber(value, buffer): orchestrates integer/float choice.
Re-used existing encodeUnsigned (left behavior intact — it already uses CBOR major type 0 opcodes), and kept the same integer/size limits.
Why these changes

The object/map OR trick silently corrupted CBOR for keys.length >= 24. Fixing it eliminates silent corruption by encoding the full map initial byte properly (and throws on absurdly large maps).
Numbers were always encoded as unsigned previously; negative integers needed major type 1 encoding. Non-integers were not explicitly handled — encoding as float64 is the simplest safe choice.
Guardrails ensure we either properly encode or throw, avoiding silent data corruption.
Edge-cases and assumptions

I preserved the original integer size limit: numbers >= 2**32 (4294967296) are considered unsupported and throw.
Map length is guarded against >= 2**32 for parity with integer size handling.
Non-integer JS numbers (IEEE 754 double) are encoded as 64-bit floats. If you prefer float32 where possible (space optimization), we can add logic to detect float32-representable values and encode with the 32-bit float additional info (0x7a).
We assume map keys are strings as before. If you need to allow other key types, we should adjust both encoder and decoder expectations.
We d
Add unit tests covering:
map with 0..23 keys (short form).
map with 24..255 keys (1-byte length form).
map with >255 keys (2-byte and 4-byte forms).
negative integers (e.g., -1, -10, -1000).
non-integer numbers (e.g., 1.5, NaN, Infinity).
very large counts that should throw (>= 2**32).
Add float32 detection if packing size matters.
Consider BigInt/bignum support for integers outside 2**32 range.
Consider explicitly restricting map key types (if Cashu requires string keys only) and throw earlier when non-string keys are encountered.

# Commit message?

cbor.ts
Fixed map encoding for >= 24 keys, added signed integer and float64 encoding, and map-length guardrails.
cbor.test.ts
Added tests for:
maps with 0..23 keys (short form) — already added previously
maps with 24 and 255 keys (1-byte length form)
maps with 256 (2-byte form) and 65536 (4-byte form)
negative integers: -1, -10, -1000
non-integer numbers: 1.5, NaN, Infinity (encoded as float64)
guardrail test that throws for object length >= 2\*\*32 (uses a safe Object.keys monkeypatch to avoid allocating huge memory)
