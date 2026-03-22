/*
 * Lightweight CBOR encoder/decoder (purpose and limitations)
 *
 * Supported
 * - Major types: 0 (unsigned), 1 (negative), 2 (byte string), 3 (text string),
 *   4 (array), 5 (map), 7 (simple values & floats).
 * - Additional-info lengths: short (0..23), 1-, 2- and 4-byte length forms are
 *   encoded by the encoder. The decoder understands 8-byte length fields
 *   (additional-info 27) and will decode them into a JavaScript Number
 *   (hi * 2**32 + lo). The encoder emits 8-byte integer forms for bigint
 *   values and for number values >= 2^32 (delegated to the bigint path).
 * - Floating point: decoder supports float16/float32/float64. Encoder emits
 *   float64 for non-integers.
 * - Guardrails: explicit throws for unsupported types and sizes (e.g. huge
 *   strings/byte arrays/arrays/maps > 2**32-1, integers larger than 32-bit for
 *   encoding). DataView out-of-bounds reads are normalized to
 *   "Unexpected end of data" for clearer errors.
 *
 * Not implemented / intentionally out of scope
 * - Indefinite-length (streaming) containers (indefinite-length arrays,
 *   maps, byte/text strings) are not supported. Test vectors with streaming
 *   markers are skipped in the test harness.
 * - Semantic tags (major type 6) are not interpreted; tagged values are
 *   skipped in encode-roundtrip tests. Implementing tags should return a
 *   wrapper object or otherwise surface the tag + value.
 * - Big integers: the encoder handles bigint values by emitting the
 *   8-byte uint64 form (additional-info 27). The decoder returns bigint
 *   when an 8-byte unsigned/negative integer exceeds Number.MAX_SAFE_INTEGER.
 *   CBOR bignum tags (tag 2/3) are not supported.
 * - Encoder does not emit float16/float32. It uses float64 for
 *   non-integers to keep the implementation small.
 *
 * Guidance for contributors
 * - To add streaming support, implement indefinite-length decoders that
 *   concatenate chunks until the break byte (0xff) and update decodeItem
 *   accordingly.
 * - To add CBOR bignum tag support (tag 2/3), implement semantic tag
 *   handling in the decoder and emit the appropriate tags in the encoder.
 */

/* Reference: CBOR specification (RFC 8949) https://www.rfc-editor.org/rfc/rfc8949.html */

type SimpleValue = boolean | null | undefined;

export type ResultObject = { [key: string]: ResultValue };
export type ResultValue =
	| SimpleValue
	| number
	| bigint
	| string
	| Uint8Array
	| ResultValue[]
	| ResultObject;

type ResultKeyType = Extract<ResultValue, number | bigint | string>;
export type ValidDecodedType = Extract<ResultValue, ResultObject>;

function isResultKeyType(value: ResultValue): value is ResultKeyType {
	return typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string';
}

type DecodeResult<T extends ResultValue> = {
	value: T;
	offset: number;
};

export function encodeCBOR(value: unknown): Uint8Array {
	const buffer: number[] = [];
	encodeItem(value, buffer);
	return new Uint8Array(buffer);
}

function encodeItem(value: unknown, buffer: number[]) {
	if (value === null) {
		buffer.push(0xf6);
	} else if (value === undefined) {
		buffer.push(0xf7);
	} else if (typeof value === 'boolean') {
		buffer.push(value ? 0xf5 : 0xf4);
	} else if (typeof value === 'number') {
		encodeNumber(value, buffer);
	} else if (typeof value === 'bigint') {
		encodeBigInt(value, buffer);
	} else if (typeof value === 'string') {
		encodeString(value, buffer);
	} else if (Array.isArray(value)) {
		encodeArray(value, buffer);
	} else if (value instanceof Uint8Array) {
		encodeByteString(value, buffer);
	} else if (
		// Defensive: POJO only (null/array handled above)
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value)
	) {
		encodeObject(value as Record<string, unknown>, buffer);
	} else {
		throw new Error('Unsupported type');
	}
}

function encodeUnsigned(value: number, buffer: number[]) {
	if (value < 24) {
		buffer.push(value);
	} else if (value < 256) {
		buffer.push(0x18, value);
	} else if (value < 65536) {
		buffer.push(0x19, (value >>> 8) & 0xff, value & 0xff);
	} else if (value < 4294967296) {
		buffer.push(
			0x1a,
			(value >>> 24) & 0xff,
			(value >>> 16) & 0xff,
			(value >>> 8) & 0xff,
			value & 0xff,
		);
	} else {
		// Safe integers >= 2^32: delegate to bigint path for 8-byte encoding
		encodeBigInt(BigInt(value), buffer);
	}
}

function encodeBigInt(value: bigint, buffer: number[]) {
	if (value >= 0n) {
		encodeUnsignedBigInt(0, value, buffer);
	} else {
		encodeUnsignedBigInt(1, -1n - value, buffer);
	}
}

function encodeUnsignedBigInt(majorType: number, value: bigint, buffer: number[]) {
	const prefix = majorType << 5;
	if (value < 24n) {
		buffer.push(prefix | Number(value));
	} else if (value < 0x100n) {
		buffer.push(prefix | 24, Number(value));
	} else if (value < 0x10000n) {
		const n = Number(value);
		buffer.push(prefix | 25, (n >>> 8) & 0xff, n & 0xff);
	} else if (value < 0x100000000n) {
		const n = Number(value);
		buffer.push(prefix | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
	} else if (value < 0x10000000000000000n) {
		const hi = Number(value >> 32n);
		const lo = Number(value & 0xffffffffn);
		buffer.push(
			prefix | 27,
			(hi >>> 24) & 0xff,
			(hi >>> 16) & 0xff,
			(hi >>> 8) & 0xff,
			hi & 0xff,
			(lo >>> 24) & 0xff,
			(lo >>> 16) & 0xff,
			(lo >>> 8) & 0xff,
			lo & 0xff,
		);
	} else {
		throw new Error('BigInt value out of uint64 range');
	}
}

function encodeSigned(value: number, buffer: number[]) {
	// CBOR negative integer encoding: store -1 - value as unsigned under major type 1
	const unsigned = -1 - value;
	if (unsigned < 24) {
		buffer.push(0x20 | unsigned);
	} else if (unsigned < 256) {
		buffer.push(0x38, unsigned & 0xff);
	} else if (unsigned < 65536) {
		buffer.push(0x39, (unsigned >>> 8) & 0xff, unsigned & 0xff);
	} else if (unsigned < 4294967296) {
		buffer.push(
			0x3a,
			(unsigned >>> 24) & 0xff,
			(unsigned >>> 16) & 0xff,
			(unsigned >>> 8) & 0xff,
			unsigned & 0xff,
		);
	} else {
		// Safe integers >= 2^32: delegate to bigint path for 8-byte encoding
		encodeBigInt(BigInt(value), buffer);
	}
}

function encodeFloat64(value: number, buffer: number[]) {
	// major type 7, additional info 27 (0xfb) followed by 8 bytes IEEE 754 big-endian
	const ab = new ArrayBuffer(8);
	const dv = new DataView(ab);
	dv.setFloat64(0, value, false);
	buffer.push(0xfb);
	for (let i = 0; i < 8; i++) buffer.push(dv.getUint8(i));
}

function encodeNumber(value: number, buffer: number[]) {
	if (Number.isInteger(value)) {
		if (value >= 0) {
			// unsigned
			encodeUnsigned(value, buffer);
		} else {
			// negative integer
			encodeSigned(value, buffer);
		}
	} else {
		// encode non-integer numbers as float64 for simplicity
		encodeFloat64(value, buffer);
	}
}

function encodeByteString(value: Uint8Array, buffer: number[]) {
	const length = value.length;

	if (length < 24) {
		buffer.push(0x40 + length);
	} else if (length < 256) {
		buffer.push(0x58, length);
	} else if (length < 65536) {
		buffer.push(0x59, (length >> 8) & 0xff, length & 0xff);
	} else if (length < 4294967296) {
		buffer.push(
			0x5a,
			(length >>> 24) & 0xff,
			(length >>> 16) & 0xff,
			(length >>> 8) & 0xff,
			length & 0xff,
		);
	} else {
		throw new Error('Byte string too long to encode');
	}

	for (let i = 0; i < value.length; i++) {
		buffer.push(value[i]);
	}
}

function encodeString(value: string, buffer: number[]) {
	const utf8 = new TextEncoder().encode(value);
	const length = utf8.length;

	if (length < 24) {
		buffer.push(0x60 + length);
	} else if (length < 256) {
		buffer.push(0x78, length);
	} else if (length < 65536) {
		buffer.push(0x79, (length >>> 8) & 0xff, length & 0xff);
	} else if (length < 4294967296) {
		buffer.push(
			0x7a,
			(length >>> 24) & 0xff,
			(length >>> 16) & 0xff,
			(length >>> 8) & 0xff,
			length & 0xff,
		);
	} else {
		throw new Error('String too long to encode');
	}

	for (let i = 0; i < utf8.length; i++) {
		buffer.push(utf8[i]);
	}
}

function encodeArray(value: unknown[], buffer: number[]) {
	const length = value.length;
	if (length < 24) {
		buffer.push(0x80 | length);
	} else if (length < 256) {
		buffer.push(0x98, length);
	} else if (length < 65536) {
		buffer.push(0x99, (length >>> 8) & 0xff, length & 0xff);
	} else {
		throw new Error('Unsupported array length');
	}

	for (const item of value) {
		encodeItem(item, buffer);
	}
}

function encodeObject(value: Record<string, unknown>, buffer: number[]) {
	const keys = Object.keys(value);
	const length = keys.length;

	// Guardrail: we only support map lengths up to 2^32-1 (same as encodeUnsigned max)
	if (length >= 4294967296) {
		throw new Error('Object has too many keys to encode');
	}

	// Write initial byte for major type 5 (map) and additional info based on length
	if (length < 24) {
		buffer.push(0xa0 | length);
	} else if (length < 256) {
		buffer.push(0xb8, length);
	} else if (length < 65536) {
		buffer.push(0xb9, (length >> 8) & 0xff, length & 0xff);
	} else {
		buffer.push(
			0xba,
			(length >> 24) & 0xff,
			(length >> 16) & 0xff,
			(length >> 8) & 0xff,
			length & 0xff,
		);
	}
	for (const key of keys) {
		encodeString(key, buffer);
		encodeItem(value[key], buffer);
	}
}

export function decodeCBOR(data: Uint8Array): ResultValue {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const result = decodeItem(view, 0);
	return result.value;
}

function decodeItem(view: DataView, offset: number): DecodeResult<ResultValue> {
	if (offset >= view.byteLength) {
		throw new Error('Unexpected end of data');
	}
	const initialByte = view.getUint8(offset++);
	const majorType = initialByte >> 5;
	const additionalInfo = initialByte & 0x1f;

	switch (majorType) {
		case 0:
			return decodeUnsigned(view, offset, additionalInfo);
		case 1:
			return decodeSigned(view, offset, additionalInfo);
		case 2:
			return decodeByteString(view, offset, additionalInfo);
		case 3:
			return decodeString(view, offset, additionalInfo);
		case 4:
			return decodeArray(view, offset, additionalInfo);
		case 5:
			return decodeMap(view, offset, additionalInfo);
		case 7:
			return decodeSimpleAndFloat(view, offset, additionalInfo);
		default:
			throw new Error(`Unsupported major type: ${majorType}`);
	}
}

function ensureAvailable(view: DataView, offset: number, needed: number) {
	if (offset + needed > view.byteLength) {
		throw new Error('Unexpected end of data');
	}
}

function decodeLength(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<number | bigint> {
	if (additionalInfo < 24) return { value: additionalInfo, offset };
	if (additionalInfo === 24) {
		ensureAvailable(view, offset, 1);
		return { value: view.getUint8(offset++), offset };
	}
	if (additionalInfo === 25) {
		ensureAvailable(view, offset, 2);
		const value = view.getUint16(offset, false);
		offset += 2;
		return { value, offset };
	}
	if (additionalInfo === 26) {
		ensureAvailable(view, offset, 4);
		const value = view.getUint32(offset, false);
		offset += 4;
		return { value, offset };
	}
	if (additionalInfo === 27) {
		ensureAvailable(view, offset, 8);
		const hi = view.getUint32(offset, false);
		const lo = view.getUint32(offset + 4, false);
		offset += 8;
		const value = hi * 2 ** 32 + lo;
		if (value > Number.MAX_SAFE_INTEGER) {
			return { value: (BigInt(hi) << 32n) | BigInt(lo), offset };
		}
		return { value, offset };
	}
	throw new Error(`Unsupported length: ${additionalInfo}`);
}

function decodeUnsigned(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<number | bigint> {
	const { value, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	return { value, offset: newOffset };
}

function decodeSigned(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<number | bigint> {
	const { value, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	if (typeof value === 'bigint') {
		return { value: -1n - value, offset: newOffset };
	}
	const signed = -1 - value;
	if (!Number.isSafeInteger(signed)) {
		return { value: -1n - BigInt(value), offset: newOffset };
	}
	return { value: signed, offset: newOffset };
}

function decodeByteString(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<Uint8Array> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	const len = Number(length);
	if (newOffset + len > view.byteLength) {
		throw new Error('Byte string length exceeds data length');
	}
	const value = new Uint8Array(view.buffer, view.byteOffset + newOffset, len);
	return { value, offset: newOffset + len };
}

function decodeString(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<string> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	const len = Number(length);
	if (newOffset + len > view.byteLength) {
		throw new Error('String length exceeds data length');
	}
	const bytes = new Uint8Array(view.buffer, view.byteOffset + newOffset, len);
	const value = new TextDecoder().decode(bytes);
	return { value, offset: newOffset + len };
}

function decodeArray(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<ResultValue[]> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	const len = Number(length);
	const array = [];
	let currentOffset = newOffset;
	for (let i = 0; i < len; i++) {
		const result = decodeItem(view, currentOffset);
		array.push(result.value);
		currentOffset = result.offset;
	}
	return { value: array, offset: currentOffset };
}

function decodeMap(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<Record<string, ResultValue>> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	const len = Number(length);
	const map: { [key: string]: ResultValue } = {};
	let currentOffset = newOffset;
	for (let i = 0; i < len; i++) {
		const keyResult = decodeItem(view, currentOffset);
		if (!isResultKeyType(keyResult.value)) {
			throw new Error('Invalid key type');
		}
		const valueResult = decodeItem(view, keyResult.offset);
		map[String(keyResult.value)] = valueResult.value;
		currentOffset = valueResult.offset;
	}
	return { value: map, offset: currentOffset };
}

function decodeFloat16(uint16: number): number {
	const exponent = (uint16 & 0x7c00) >> 10;
	const fraction = uint16 & 0x03ff;
	const sign = uint16 & 0x8000 ? -1 : 1;

	if (exponent === 0) {
		return sign * 2 ** -14 * (fraction / 1024);
	} else if (exponent === 0x1f) {
		return fraction ? NaN : sign * Infinity;
	}
	return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function decodeSimpleAndFloat(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<SimpleValue | number> {
	if (additionalInfo < 24) {
		switch (additionalInfo) {
			case 20:
				return { value: false, offset };
			case 21:
				return { value: true, offset };
			case 22:
				return { value: null, offset };
			case 23:
				return { value: undefined, offset };
			default:
				throw new Error(`Unknown simple value: ${additionalInfo}`);
		}
	}
	if (additionalInfo === 24) {
		ensureAvailable(view, offset, 1);
		return { value: view.getUint8(offset++), offset };
	}
	if (additionalInfo === 25) {
		ensureAvailable(view, offset, 2);
		const value = decodeFloat16(view.getUint16(offset, false));
		offset += 2;
		return { value, offset };
	}
	if (additionalInfo === 26) {
		ensureAvailable(view, offset, 4);
		const value = view.getFloat32(offset, false);
		offset += 4;
		return { value, offset };
	}
	if (additionalInfo === 27) {
		ensureAvailable(view, offset, 8);
		const value = view.getFloat64(offset, false);
		offset += 8;
		return { value, offset };
	}
	throw new Error(`Unknown simple or float value: ${additionalInfo}`);
}
