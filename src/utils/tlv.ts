import { bech32 } from '@scure/base';
import type {
	PaymentRequestTransport,
	PaymentRequestTransportType,
} from '../wallet/types/payment-requests';

/**
 * Decoded TLV Payment Request structure.
 */
export type DecodedTLVPaymentRequest = {
	id?: string;
	amount?: bigint;
	unit?: string;
	singleUse?: boolean;
	mints?: string[];
	description?: string;
	transports?: PaymentRequestTransport[];
};

/**
 * TLV Tag definitions for Payment Request (NUT-18 version B).
 *
 * | Tag  | Field       | Type      | Description                                      |
 * | ---- | ----------- | --------- | ------------------------------------------------ |
 * | 0x01 | id          | string    | Payment identifier                               |
 * | 0x02 | amount      | u64       | Amount in base units                             |
 * | 0x03 | unit        | u8/string | Currency unit (0x00 = 'sat')                     |
 * | 0x04 | single_use  | u8        | Single-use flag: 0=false, 1=true                 |
 * | 0x05 | mint        | string    | Mint URL (repeatable)                            |
 * | 0x06 | description | string    | Human-readable description                       |
 * | 0x07 | transport   | sub-TLV   | Transport configuration (repeatable)             |
 * | 0x08 | nut10       | sub-TLV   | NUT-10 spending conditions (not yet implemented) |
 */
const TAG_ID = 0x01;
const TAG_AMOUNT = 0x02;
const TAG_UNIT = 0x03;
const TAG_SINGLE_USE = 0x04;
const TAG_MINT = 0x05;
const TAG_DESCRIPTION = 0x06;
const TAG_TRANSPORT = 0x07;
const TAG_NUT10 = 0x08;

/**
 * Transport Sub-TLV Tag definitions.
 *
 * | Sub-Tag | Field     | Type    | Description                                       |
 * | ------- | --------- | ------- | ------------------------------------------------- |
 * | 0x01    | kind      | u8      | Transport type: 0=nostr, 1=http_post              |
 * | 0x02    | target    | bytes   | Transport target (pubkey for nostr, URL for post) |
 * | 0x03    | tag_tuple | sub-TLV | Generic tag tuple (repeatable)                    |
 */
const TRANSPORT_TAG_KIND = 0x01;
const TRANSPORT_TAG_TARGET = 0x02;
const TRANSPORT_TAG_TAG_TUPLE = 0x03;

const TRANSPORT_KIND_NOSTR = 0;
const TRANSPORT_KIND_HTTP_POST = 1;

type TLVPart = {
	tag: number;
	length: number;
	value: Uint8Array;
};

/**
 * Decodes a TLV-encoded Payment Request.
 *
 * @param data - The TLV-encoded data as Uint8Array.
 * @returns Decoded payment request object.
 */
export function decodeTLV(data: Uint8Array): DecodedTLVPaymentRequest {
	const parts = decodeAllParts(data);
	const result: DecodedTLVPaymentRequest = {};

	for (const part of parts) {
		switch (part.tag) {
			case TAG_ID:
				result.id = parseString(part.value);
				break;
			case TAG_AMOUNT:
				result.amount = parseU64(part.value);
				break;
			case TAG_UNIT:
				if (part.value.length === 1 && part.value[0] === 0) {
					result.unit = 'sat';
				} else {
					result.unit = parseString(part.value);
				}
				break;
			case TAG_SINGLE_USE:
				result.singleUse = parseU8(part.value) === 1;
				break;
			case TAG_MINT:
				if (!result.mints) {
					result.mints = [];
				}
				result.mints.push(parseString(part.value));
				break;
			case TAG_DESCRIPTION:
				result.description = parseString(part.value);
				break;
			case TAG_TRANSPORT:
				if (!result.transports) {
					result.transports = [];
				}
				result.transports.push(parseTransport(part.value));
				break;
			case TAG_NUT10:
				// NUT10 parsing not yet implemented
				break;
			default:
				// Ignore unknown tags for forward compatibility
				break;
		}
	}

	return result;
}

/**
 * Decodes all TLV parts from the data.
 */
function decodeAllParts(data: Uint8Array): TLVPart[] {
	const parts: TLVPart[] = [];
	let offset = 0;

	while (offset < data.length) {
		const part = decodeNextPart(data.subarray(offset));
		parts.push(part);
		// Tag (1 byte) + Length (2 bytes) + Value
		offset += 1 + 2 + part.length;
	}

	return parts;
}

/**
 * Decodes the next TLV part from the data.
 *
 * Wire format:
 *
 * - Tag: 1 byte (uint8)
 * - Length: 2 bytes (uint16, big-endian)
 * - Value: `length` bytes.
 */
function decodeNextPart(data: Uint8Array): TLVPart {
	if (data.length < 3) {
		throw new Error('TLV data too short: need at least 3 bytes for tag and length');
	}

	const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const tag = dataView.getUint8(0);
	const length = dataView.getUint16(1, false); // big-endian

	if (data.length < 3 + length) {
		throw new Error(`TLV data too short: expected ${3 + length} bytes, got ${data.length}`);
	}

	const value = data.subarray(3, 3 + length);
	return { tag, length, value };
}

function parseString(value: Uint8Array): string {
	return new TextDecoder().decode(value);
}

function parseU64(value: Uint8Array): bigint {
	if (value.length !== 8) {
		throw new Error(`Invalid u64: expected 8 bytes, got ${value.length}`);
	}
	return new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0, false);
}

function parseU8(value: Uint8Array): number {
	if (value.length !== 1) {
		throw new Error(`Invalid u8: expected 1 byte, got ${value.length}`);
	}
	return value[0];
}

function transportKindToType(kind: number): PaymentRequestTransportType {
	switch (kind) {
		case TRANSPORT_KIND_NOSTR:
			return 'nostr' as PaymentRequestTransportType;
		case TRANSPORT_KIND_HTTP_POST:
			return 'post' as PaymentRequestTransportType;
		default:
			throw new Error(`Unsupported transport kind: ${kind}`);
	}
}

function parseTransport(value: Uint8Array): PaymentRequestTransport {
	const parts = decodeAllParts(value);

	let kind: number | undefined;
	let targetBytes: Uint8Array | undefined;
	let tags: string[][] | undefined;

	for (const part of parts) {
		switch (part.tag) {
			case TRANSPORT_TAG_KIND:
				kind = parseU8(part.value);
				break;
			case TRANSPORT_TAG_TARGET:
				targetBytes = part.value;
				break;
			case TRANSPORT_TAG_TAG_TUPLE:
				if (!tags) {
					tags = [];
				}
				tags.push(parseTagTuple(part.value));
				break;
		}
	}

	if (kind === undefined) {
		throw new Error('Transport missing required kind field');
	}
	if (targetBytes === undefined) {
		throw new Error('Transport missing required target field');
	}

	// Parse target based on kind
	let target: string;
	if (kind === TRANSPORT_KIND_NOSTR) {
		// For nostr, encode as nprofile with pubkey and relay URLs from tag tuples (key "r")
		const relayUrls =
			tags?.filter((tuple) => tuple[0] === 'r').flatMap((tuple) => tuple.slice(1)) ?? [];
		target = encodeNprofile(targetBytes, relayUrls);
		// Remove relay tags since they're now embedded in the nprofile
		tags = tags?.filter((tuple) => tuple[0] !== 'r');
	} else {
		target = parseString(targetBytes);
	}

	// Return undefined for tags if empty
	const finalTags = tags && tags.length > 0 ? tags : undefined;

	return {
		type: transportKindToType(kind),
		target,
		tags: finalTags,
	};
}

/**
 * Parses a tag tuple from its TLV value.
 *
 * Tag tuple encoding:
 *
 * 1. Key length (1 byte)
 * 2. Key string (UTF-8)
 * 3. For each value:
 *
 *    - Value length (1 byte)
 *    - Value string (UTF-8)
 *
 * @param value - The tag tuple value bytes.
 * @returns Array of strings representing the tuple [key, value1, value2, ...].
 */
function parseTagTuple(value: Uint8Array): string[] {
	const tuple: string[] = [];
	let offset = 0;

	while (offset < value.length) {
		const length = value[offset];
		offset += 1;

		if (value.length - offset < length) {
			throw new Error(
				`Tag tuple data too short: expected ${length} bytes, got ${value.length - offset}`,
			);
		}

		const str = parseString(value.subarray(offset, offset + length));
		tuple.push(str);
		offset += length;
	}

	return tuple;
}

/**
 * Encodes a 32-byte public key and a list of relay URLs into a bech32m encoded string.
 *
 * @param pubkey - 32-byte public key as Uint8Array.
 * @param relays - Array of relay URLs.
 * @returns Bech32m encoded string.
 */
export function encodeNprofile(pubkey: Uint8Array, relays: string[]): string {
	const tlv = encodePubkeyRelaysTLV(pubkey, relays);
	const words = bech32.toWords(tlv);
	return bech32.encode('nprofile', words, 1024);
}

/**
 * Encodes a 32-byte public key and a list of relay URLs into a TLV structure.
 *
 * Wire format (1-byte T, 1-byte L):
 *
 * - T=0x00: 32-byte public key.
 * - T=0x01: relay URL (repeatable)
 *
 * @param pubkey - 32-byte public key as Uint8Array.
 * @param relays - Array of relay URLs.
 * @returns TLV-encoded Uint8Array.
 */
function encodePubkeyRelaysTLV(pubkey: Uint8Array, relays: string[]): Uint8Array {
	if (pubkey.length !== 32) {
		throw new Error(`Invalid pubkey: expected 32 bytes, got ${pubkey.length}`);
	}

	const encoder = new TextEncoder();
	const encodedRelays = relays.map((relay) => encoder.encode(relay));

	// Validate relay lengths fit in 1 byte
	for (let i = 0; i < encodedRelays.length; i++) {
		if (encodedRelays[i].length > 255) {
			throw new Error(`Relay URL too long: ${relays[i]} (max 255 bytes)`);
		}
	}

	// Calculate total size: pubkey (1 + 1 + 32) + relays (1 + 1 + len each)
	const totalSize = 2 + 32 + encodedRelays.reduce((sum, r) => sum + 2 + r.length, 0);
	const result = new Uint8Array(totalSize);

	let offset = 0;

	// Write pubkey: T=0x00, L=32, V=<32 bytes>
	result[offset++] = 0x00;
	result[offset++] = 32;
	result.set(pubkey, offset);
	offset += 32;

	// Write each relay: T=0x01, L=<len>, V=<UTF-8 string>
	for (const relay of encodedRelays) {
		result[offset++] = 0x01;
		result[offset++] = relay.length;
		result.set(relay, offset);
		offset += relay.length;
	}

	return result;
}
