/*
 * Lightweight CBOR encoder/decoder (purpose and limitations)
 *
 * Supported
 * - Major types: 0 (unsigned), 1 (negative), 2 (byte string), 3 (text string),
 *   4 (array), 5 (map), 7 (simple values & floats).
 * - Additional-info lengths: short (0..23), 1-, 2- and 4-byte length forms are
 *   encoded by the encoder. The decoder understands 8-byte length fields
 *   (additional-info 27) and will decode them into a JavaScript Number
 *   (hi * 2**32 + lo) but the encoder intentionally does not emit 8-byte
 *   integer forms (see 'Not implemented' below).
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
 * - Big integers / bignum handling: this implementation does not return
 *   BigInt for values outside Number.isSafeInteger nor emit CBOR bignum tags
 *   (tag 2/3). Decode may parse 8-byte unsigned/negative integers into a
 *   Number which can overflow JS precision; callers who need accurate bignum
 *   support should add BigInt decoding and encoder support.
 * - Encoder does not emit float16/float32 or 8-byte integer (additional-info
 *   27) forms. It intentionally limits integer encoding to <= 32-bit and
 *   uses float64 for non-integers to keep the implementation small.
 *
 * Guidance for contributors
 * - To add streaming support, implement indefinite-length decoders that
 *   concatenate chunks until the break byte (0xff) and update decodeItem
 *   accordingly.
 * - To add BigInt/bignum support, change decode paths to return BigInt when
 *   required, add fixture representation for BigInt in tests, and emit proper
 *   tag-2/3 bignum encodings or 8-byte integer forms in the encoder.
 */

/* Reference: CBOR specification (RFC 8949) https://www.rfc-editor.org/rfc/rfc8949.html */

type SimpleValue = boolean | null | undefined;

export type ResultObject = { [key: string]: ResultValue };
export type ResultValue = SimpleValue | number | string | Uint8Array | ResultValue[] | ResultObject;

type ResultKeyType = Extract<ResultValue, number | string>;
export type ValidDecodedType = Extract<ResultValue, ResultObject>;

function isResultKeyType(value: ResultValue): value is ResultKeyType {
	return typeof value === 'number' || typeof value === 'string';
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
		buffer.push(0x19, value >> 8, value & 0xff);
	} else if (value < 4294967296) {
		buffer.push(0x1a, value >> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
	} else {
		throw new Error('Unsupported integer size');
	}
}

function encodeSigned(value: number, buffer: number[]) {
	// CBOR negative integer encoding: store -1 - value as unsigned under major type 1
	const unsigned = -1 - value;
	if (unsigned < 24) {
		buffer.push(0x20 | unsigned);
	} else if (unsigned < 256) {
		buffer.push(0x38, unsigned);
	} else if (unsigned < 65536) {
		buffer.push(0x39, unsigned >> 8, unsigned & 0xff);
	} else if (unsigned < 4294967296) {
		buffer.push(
			0x3a,
			unsigned >> 24,
			(unsigned >> 16) & 0xff,
			(unsigned >> 8) & 0xff,
			unsigned & 0xff,
		);
	} else {
		throw new Error('Unsupported integer size');
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
			(length >> 24) & 0xff,
			(length >> 16) & 0xff,
			(length >> 8) & 0xff,
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
		buffer.push(0x79, (length >> 8) & 0xff, length & 0xff);
	} else if (length < 4294967296) {
		buffer.push(
			0x7a,
			(length >> 24) & 0xff,
			(length >> 16) & 0xff,
			(length >> 8) & 0xff,
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
		buffer.push(0x99, length >> 8, length & 0xff);
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
): DecodeResult<number> {
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
		return { value: hi * 2 ** 32 + lo, offset };
	}
	throw new Error(`Unsupported length: ${additionalInfo}`);
}

function decodeUnsigned(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<number> {
	const { value, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	return { value, offset: newOffset };
}

function decodeSigned(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<number> {
	const { value, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	return { value: -1 - value, offset: newOffset };
}

function decodeByteString(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<Uint8Array> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	if (newOffset + length > view.byteLength) {
		throw new Error('Byte string length exceeds data length');
	}
	const value = new Uint8Array(view.buffer, view.byteOffset + newOffset, length);
	return { value, offset: newOffset + length };
}

function decodeString(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<string> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	if (newOffset + length > view.byteLength) {
		throw new Error('String length exceeds data length');
	}
	const bytes = new Uint8Array(view.buffer, view.byteOffset + newOffset, length);
	const value = new TextDecoder().decode(bytes);
	return { value, offset: newOffset + length };
}

function decodeArray(
	view: DataView,
	offset: number,
	additionalInfo: number,
): DecodeResult<ResultValue[]> {
	const { value: length, offset: newOffset } = decodeLength(view, offset, additionalInfo);
	const array = [];
	let currentOffset = newOffset;
	for (let i = 0; i < length; i++) {
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
	const map: { [key: string]: ResultValue } = {};
	let currentOffset = newOffset;
	for (let i = 0; i < length; i++) {
		const keyResult = decodeItem(view, currentOffset);
		if (!isResultKeyType(keyResult.value)) {
			throw new Error('Invalid key type');
		}
		const valueResult = decodeItem(view, keyResult.offset);
		map[keyResult.value] = valueResult.value;
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
