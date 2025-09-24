import { verifyDLEQProof_reblind } from './crypto/client/NUT12';
import { type DLEQ, pointFromHex } from './crypto/common';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha2';
import {
	encodeBase64ToJson,
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeUint8toBase64Url,
	isBase64String,
} from './base64';
import { decodeCBOR, encodeCBOR } from './cbor';
import { PaymentRequest } from './model/PaymentRequest';
import {
	type DeprecatedToken,
	type Keys,
	type MintKeys,
	type MintKeyset,
	type Proof,
	type SerializedDLEQ,
	type Token,
	type TokenV4Template,
	type V4DLEQTemplate,
	type V4InnerToken,
	type V4ProofTemplate,
} from './model/types';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants';
import { Bytes } from './utils/Bytes';

/**
 * Splits the amount into denominations of the provided @param keyset.
 *
 * @param value Amount to split.
 * @param keyset Keys to look up split amounts.
 * @param split? Optional custom split amounts.
 * @param order? Optional order for split amounts (default: "asc")
 * @returns Array of split amounts.
 * @throws Error if @param split amount is greater than @param value amount.
 */
export function splitAmount(
	value: number,
	keyset: Keys,
	split?: number[],
	order?: 'desc' | 'asc',
): number[] {
	if (split) {
		const totalSplitAmount = sumArray(split);

		// Special case: explicit "zero-total" outputs (restore or NUT-08 blanks)
		if (value === 0 && totalSplitAmount === 0) {
			return split;
		}

		// Normal positive-value paths: ignore zeros for validation and totals
		const positive = split.filter((amt) => amt > 0);
		const totalPositive = sumArray(positive);
		if (totalPositive > value) {
			throw new Error(`Split is greater than total amount: ${totalPositive} > ${value}`);
		}
		if (positive.some((amt) => !hasCorrespondingKey(amt, keyset))) {
			throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
		}

		// if caller supplied an exact custom split, preserve their order
		if (totalPositive === value) {
			return positive;
		}

		// Work only with validated positive amounts from here on
		split = positive;
		value -= totalPositive;
	} else {
		split = [];
	}

	// Denomination fill for the remaining value
	const sortedKeyAmounts = getKeysetAmounts(keyset, 'desc');
	if (!sortedKeyAmounts || sortedKeyAmounts.length === 0) {
		throw new Error('Cannot split amount, keyset is inactive or contains no keys');
	}
	sortedKeyAmounts.forEach((amt: number) => {
		if (value <= 0 || amt <= 0) return;
		const q = Math.floor(value / amt);
		for (let i = 0; i < q; ++i) split.push(amt);
		value %= amt;
	});
	if (value !== 0) {
		throw new Error(`Unable to split remaining amount: ${value}`);
	}

	// Only sort when we performed a fill; exact custom splits returned earlier
	return split.sort((a, b) => (order === 'desc' ? b - a : a - b));
}

/**
 * Creates a list of amounts to keep based on the proofs we have and the proofs we want to reach.
 *
 * @param proofsWeHave Complete set of proofs stored (from current mint)
 * @param amountToKeep Amount to keep.
 * @param keys Keys of current keyset.
 * @param targetCount The target number of proofs to reach.
 * @returns An array of amounts to keep.
 */
export function getKeepAmounts(
	proofsWeHave: Proof[],
	amountToKeep: number,
	keys: Keys,
	targetCount: number,
): number[] {
	// determines amounts we need to reach the targetCount for each amount based on the amounts of the proofs we have
	// it tries to select amounts so that the proofs we have and the proofs we want reach the targetCount
	const amountsWeWant: number[] = [];
	const amountsWeHave = proofsWeHave.map((p: Proof) => p.amount);
	const sortedKeyAmounts = getKeysetAmounts(keys, 'asc');
	sortedKeyAmounts.forEach((amt) => {
		const countWeHave = amountsWeHave.filter((a) => a === amt).length;
		const countWeWant = Math.max(targetCount - countWeHave, 0);
		for (let i = 0; i < countWeWant; ++i) {
			if (amountsWeWant.reduce((a, b) => a + b, 0) + amt > amountToKeep) {
				break;
			}
			amountsWeWant.push(amt);
		}
	});
	// use splitAmount to fill the rest between the sum of amountsWeHave and amountToKeep
	const amountDiff = amountToKeep - amountsWeWant.reduce((a, b) => a + b, 0);
	if (amountDiff) {
		const remainingAmounts = splitAmount(amountDiff, keys);
		remainingAmounts.forEach((amt: number) => {
			amountsWeWant.push(amt);
		});
	}
	return amountsWeWant.sort((a, b) => a - b);
}
/**
 * Returns the amounts in the keyset sorted by the order specified.
 *
 * @param keyset To search in.
 * @param order Order to sort the amounts in.
 * @returns The amounts in the keyset sorted by the order specified.
 */
export function getKeysetAmounts(keyset: Keys, order: 'asc' | 'desc' = 'desc'): number[] {
	if (order == 'desc') {
		return Object.keys(keyset)
			.map((k: string) => parseInt(k))
			.sort((a: number, b: number) => b - a);
	}
	return Object.keys(keyset)
		.map((k: string) => parseInt(k))
		.sort((a: number, b: number) => a - b);
}

/**
 * Checks if the provided amount is in the keyset.
 *
 * @param amount Amount to check.
 * @param keyset To search in.
 * @returns True if the amount is in the keyset, false otherwise.
 */
export function hasCorrespondingKey(amount: number, keyset: Keys): boolean {
	return amount in keyset;
}

/**
 * Converts a bytes array to a number.
 *
 * @param bytes To convert to number.
 * @returns Number.
 */
export function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

/**
 * Converts a hex string to a number.
 *
 * @param hex To convert to number.
 * @returns Number.
 */
export function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

/**
 * Converts a number to a hex string of 64 characters.
 *
 * @param number (bigint) to conver to hex.
 * @returns Hex string start-padded to 64 characters.
 */
export function numberToHexPadded64(number: bigint): string {
	return number.toString(16).padStart(64, '0');
}

function isValidHex(str: string) {
	return /^[a-f0-9]*$/i.test(str);
}

/**
 * Checks wether a proof or a list of proofs contains a non-hex id.
 *
 * @param p Proof or list of proofs.
 * @returns Boolean.
 */
export function hasNonHexId(p: Proof | Proof[]) {
	if (Array.isArray(p)) {
		return p.some((proof) => !isValidHex(proof.id));
	}
	return !isValidHex(p.id);
}

//used for json serialization
export function bigIntStringify<T>(_key: unknown, value: T) {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Helper function to encode a v3 cashu token.
 *
 * @param token To encode.
 * @returns Encoded token.
 */
export function getEncodedTokenV3(token: Token, removeDleq?: boolean): string {
	if (!hasNonHexId(token.proofs)) {
		token.proofs = convertToShortKeysetId(token.proofs);
	}
	if (removeDleq) {
		token.proofs = stripDleq(token.proofs);
	}
	const v3TokenObj: DeprecatedToken = { token: [{ mint: token.mint, proofs: token.proofs }] };
	if (token.unit) {
		v3TokenObj.unit = token.unit;
	}
	if (token.memo) {
		v3TokenObj.memo = token.memo;
	}
	return TOKEN_PREFIX + TOKEN_VERSION + encodeJsonToBase64(v3TokenObj);
}

/*
 * Convert a keyset ID into short form
 */
function convertToShortKeysetId(proofs: Proof[]) {
	return proofs.map((p) => {
		const newP = { ...p };
		newP.id = newP.id.slice(0, 16);
		return newP;
	});
}

/**
 * Helper function to encode a cashu token (defaults to v4 if keyset id allows it)
 *
 * @param token
 * @param [opts]
 */
export function getEncodedToken(
	token: Token,
	opts?: { version?: 3 | 4; removeDleq?: boolean },
): string {
	// Find out if it's a base64 keyset
	const nonHex = hasNonHexId(token.proofs);
	if (nonHex || opts?.version === 3) {
		if (opts?.version === 4) {
			throw new Error('can not encode to v4 token if proofs contain non-hex keyset id');
		}
		return getEncodedTokenV3(token, opts?.removeDleq);
	}
	return getEncodedTokenV4(token, opts?.removeDleq);
}

export function getEncodedTokenV4(token: Token, removeDleq?: boolean): string {
	if (removeDleq) {
		token.proofs = stripDleq(token.proofs);
	}
	// Make sure each DLEQ has its blinding factor
	token.proofs.forEach((p) => {
		if (p.dleq && p.dleq.r == undefined) {
			throw new Error('Missing blinding factor in included DLEQ proof');
		}
	});
	const nonHex = hasNonHexId(token.proofs);
	if (nonHex) {
		throw new Error('can not encode to v4 token if proofs contain non-hex keyset id');
	}
	// Map keyset IDs to short IDs
	token.proofs = convertToShortKeysetId(token.proofs);

	const tokenTemplate = templateFromToken(token);

	const encodedData = encodeCBOR(tokenTemplate);
	const prefix = 'cashu';
	const version = 'B';
	const base64Data = encodeUint8toBase64Url(encodedData);
	return prefix + version + base64Data;
}

function templateFromToken(token: Token): TokenV4Template {
	const idMap: { [id: string]: Proof[] } = {};
	const mint = token.mint;
	for (let i = 0; i < token.proofs.length; i++) {
		const proof = token.proofs[i];
		if (idMap[proof.id]) {
			idMap[proof.id].push(proof);
		} else {
			idMap[proof.id] = [proof];
		}
	}
	const tokenTemplate: TokenV4Template = {
		m: mint,
		u: token.unit || 'sat',
		t: Object.keys(idMap).map(
			(id: string): V4InnerToken => ({
				i: hexToBytes(id),
				p: idMap[id].map(
					(p: Proof): V4ProofTemplate => ({
						a: p.amount,
						s: p.secret,
						c: hexToBytes(p.C),
						...(p.dleq && {
							d: {
								e: hexToBytes(p.dleq.e),
								s: hexToBytes(p.dleq.s),
								r: hexToBytes(p.dleq.r ?? '00'),
							} as V4DLEQTemplate,
						}),
						...(p.witness && {
							w: JSON.stringify(p.witness),
						}),
					}),
				),
			}),
		),
	} as TokenV4Template;
	if (token.memo) {
		tokenTemplate.d = token.memo;
	}
	return tokenTemplate;
}

function tokenFromTemplate(template: TokenV4Template): Token {
	const proofs: Proof[] = [];
	template.t.forEach((t) =>
		t.p.forEach((p) => {
			proofs.push({
				secret: p.s,
				C: bytesToHex(p.c),
				amount: p.a,
				id: bytesToHex(t.i),
				...(p.d && {
					dleq: {
						r: bytesToHex(p.d.r),
						s: bytesToHex(p.d.s),
						e: bytesToHex(p.d.e),
					} as SerializedDLEQ,
				}),
				...(p.w && {
					witness: p.w,
				}),
			});
		}),
	);
	const decodedToken: Token = { mint: template.m, proofs, unit: template.u || 'sat' };
	if (template.d) {
		decodedToken.memo = template.d;
	}
	return decodedToken;
}

/**
 * Helper function to decode cashu tokens into object.
 *
 * @param token An encoded cashu token (cashuAey...)
 * @returns Cashu token object.
 */
export function getDecodedToken(tokenString: string, keysets?: MintKeyset[]) {
	// remove prefixes
	const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:', 'cashu'];
	uriPrefixes.forEach((prefix: string) => {
		if (!tokenString.startsWith(prefix)) {
			return;
		}
		tokenString = tokenString.slice(prefix.length);
	});

	const token = handleTokens(tokenString);
	token.proofs = mapShortKeysetIds(token.proofs, keysets);
	return token;
}

/**
 * Helper function to decode different versions of cashu tokens into an object.
 *
 * @param token An encoded cashu token (cashuAey...)
 * @returns Cashu Token object.
 */
export function handleTokens(token: string): Token {
	const version = token.slice(0, 1);
	const encodedToken = token.slice(1);
	if (version === 'A') {
		const parsedV3Token = encodeBase64ToJson<DeprecatedToken>(encodedToken);
		if (parsedV3Token.token.length > 1) {
			throw new Error('Multi entry token are not supported');
		}
		const entry = parsedV3Token.token[0];
		const tokenObj: Token = {
			mint: entry.mint,
			proofs: entry.proofs,
			unit: parsedV3Token.unit || 'sat',
		};
		if (parsedV3Token.memo) {
			tokenObj.memo = parsedV3Token.memo;
		}
		return tokenObj;
	} else if (version === 'B') {
		const uInt8Token = encodeBase64toUint8(encodedToken);
		const tokenData = decodeCBOR(uInt8Token) as TokenV4Template;
		return tokenFromTemplate(tokenData);
	}
	throw new Error('Token version is not supported');
}

/**
 * Returns the keyset id of a set of keys.
 *
 * @param keys Keys object to derive keyset id from.
 * @param unit (optional) the unit of the keyset.
 * @param expiry (optional) expiry of the keyset.
 * @param versionByte (optional) version of the keyset ID. Default is 0.
 * @param isDeprecatedBase64 (optional) true if the keyset ID should be derived as a deprecated v0
 *   base64 keyset ID.
 * @returns Keyset id of the keys.
 * @throws If keyset versionByte is not valid.
 */
export function deriveKeysetId(
	keys: Keys,
	unit?: string,
	expiry?: number,
	versionByte: number = 0,
	isDeprecatedBase64: boolean = false,
) {
	let pubkeysConcat = Object.entries(keys)
		.sort((a: [string, string], b: [string, string]) => +a[0] - +b[0])
		.map(([, pubKey]: [unknown, string]) => hexToBytes(pubKey))
		.reduce((prev: Uint8Array, curr: Uint8Array) => mergeUInt8Arrays(prev, curr), new Uint8Array());

	if (isDeprecatedBase64) {
		const hash = sha256(pubkeysConcat);
		const b64 = Bytes.toBase64(hash);
		return b64.slice(0, 12);
	}

	let hash;
	let hashHex;
	switch (versionByte) {
		case 0:
			hash = sha256(pubkeysConcat);
			hashHex = Bytes.toHex(hash).slice(0, 14);
			return '00' + hashHex;
		case 1:
			if (!unit) {
				throw new Error('Cannot compute keyset ID version 01: unit is required.');
			}
			pubkeysConcat = mergeUInt8Arrays(pubkeysConcat, Bytes.fromString('unit:' + unit));
			if (expiry) {
				pubkeysConcat = mergeUInt8Arrays(
					pubkeysConcat,
					Bytes.fromString('final_expiry:' + expiry.toString()),
				);
			}
			hash = sha256(pubkeysConcat);
			hashHex = Bytes.toHex(hash);
			return '01' + hashHex;
		default:
			throw new Error(`Unrecognized keyset ID version: ${versionByte}`);
	}
}

export function mergeUInt8Arrays(a1: Uint8Array, a2: Uint8Array): Uint8Array {
	// sum of individual array lengths
	const mergedArray = new Uint8Array(a1.length + a2.length);
	mergedArray.set(a1);
	mergedArray.set(a2, a1.length);
	return mergedArray;
}

export function sortProofsById(proofs: Proof[]) {
	return proofs.sort((a: Proof, b: Proof) => a.id.localeCompare(b.id));
}

export function isObj(v: unknown): v is object {
	return typeof v === 'object';
}

export function checkResponse(data: { error?: string; detail?: string }) {
	if (!isObj(data)) return;
	if ('error' in data && data.error) {
		throw new Error(data.error);
	}
	if ('detail' in data && data.detail) {
		throw new Error(data.detail);
	}
}

export function joinUrls(...parts: string[]): string {
	return parts.map((part: string) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

export function sanitizeUrl(url: string): string {
	return url.replace(/\/$/, '');
}

export function sumProofs(proofs: Proof[]) {
	return proofs.reduce((acc: number, proof: Proof) => acc + proof.amount, 0);
}

export function decodePaymentRequest(paymentRequest: string) {
	return PaymentRequest.fromEncodedRequest(paymentRequest);
}

export class MessageNode {
	private _value: string;
	private _next: MessageNode | null;

	public get value(): string {
		return this._value;
	}
	public set value(message: string) {
		this._value = message;
	}
	public get next(): MessageNode | null {
		return this._next;
	}
	public set next(node: MessageNode | null) {
		this._next = node;
	}

	constructor(message: string) {
		this._value = message;
		this._next = null;
	}
}

export class MessageQueue {
	private _first: MessageNode | null;
	private _last: MessageNode | null;

	public get first(): MessageNode | null {
		return this._first;
	}
	public set first(messageNode: MessageNode | null) {
		this._first = messageNode;
	}
	public get last(): MessageNode | null {
		return this._last;
	}
	public set last(messageNode: MessageNode | null) {
		this._last = messageNode;
	}
	private _size: number;
	public get size(): number {
		return this._size;
	}
	public set size(v: number) {
		this._size = v;
	}

	constructor() {
		this._first = null;
		this._last = null;
		this._size = 0;
	}
	enqueue(message: string): boolean {
		const newNode = new MessageNode(message);
		if (this._size === 0 || !this._last) {
			this._first = newNode;
			this._last = newNode;
		} else {
			this._last.next = newNode;
			this._last = newNode;
		}
		this._size++;
		return true;
	}
	dequeue(): string | null {
		if (this._size === 0 || !this._first) return null;

		const prev = this._first;
		this._first = prev.next;
		prev.next = null;

		this._size--;
		return prev.value;
	}
}
/**
 * Removes all traces of DLEQs from a list of proofs.
 *
 * @param proofs The list of proofs that dleq should be stripped from.
 */
export function stripDleq(proofs: Proof[]): Array<Omit<Proof, 'dleq'>> {
	return proofs.map((p) => {
		const newP = { ...p };
		delete newP['dleq'];
		return newP;
	});
}

/**
 * Check that the keyset hashes to the specified ID.
 *
 * @param keys The keyset to be verified.
 * @returns True if the verification was successful, false otherwise.
 * @throws Error if the keyset ID version is unrecognized.
 */
export function verifyKeysetId(keys: MintKeys): boolean {
	const isBase64 = isBase64String(keys.id);
	const isValidHex = /^[a-fA-F0-9]+$/.test(keys.id);
	const versionByte = isValidHex ? hexToBytes(keys.id)[0] : 0;
	return (
		deriveKeysetId(
			keys.keys,
			keys.unit,
			keys.final_expiry,
			versionByte,
			isBase64 && !isValidHex,
		) === keys.id
	);
}

/**
 * Maps the short keyset IDs stored in the token to actual keyset IDs that were fetched from the
 * Mint.
 */
function mapShortKeysetIds(proofs: Proof[], keysets?: MintKeyset[]): Proof[] {
	const newProofs = [];
	for (const proof of proofs) {
		let idBytes;
		try {
			idBytes = hexToBytes(proof.id);
		} catch {
			// Base64 keysets don't need conversion
			newProofs.push(proof);
			continue;
		}

		if (idBytes[0] === 0x00) {
			newProofs.push(proof);
		} else if (idBytes[0] === 0x01) {
			if (!keysets) {
				throw new Error('A short keyset ID v2 was encountered, but got no keysets to map it to.');
			}
			// Look for a match: prefix(keyset ID) == short ID
			let found = false;
			for (const keyset of keysets) {
				if (proof.id === keyset.id.slice(0, proof.id.length)) {
					proof.id = keyset.id;
					newProofs.push(proof);
					found = true;
					break;
				}
			}
			if (!found) {
				throw new Error(
					`Couldn't map short keyset ID ${proof.id} to any known keysets of the current Mint`,
				);
			}
		} else {
			throw new Error(`Unknown keyset ID version: ${idBytes[0]}`);
		}
	}

	return newProofs;
}

/**
 * Checks that the proof has a valid DLEQ proof according to keyset `keys`
 *
 * @param proof The proof subject to verification.
 * @param keyset The Mint's keyset to be used for verification.
 * @returns True if verification succeeded, false otherwise.
 * @throws Error if @param proof does not match any key in @param keyset.
 */
export function hasValidDleq(proof: Proof, keyset: MintKeys): boolean {
	if (proof.dleq == undefined) {
		return false;
	}
	const dleq = {
		e: hexToBytes(proof.dleq.e),
		s: hexToBytes(proof.dleq.s),
		r: hexToNumber(proof.dleq.r ?? '00'),
	} as DLEQ;
	if (!hasCorrespondingKey(proof.amount, keyset.keys)) {
		throw new Error(`undefined key for amount ${proof.amount}`);
	}
	const key = keyset.keys[proof.amount];
	return verifyDLEQProof_reblind(
		new TextEncoder().encode(proof.secret),
		dleq,
		pointFromHex(proof.C),
		pointFromHex(key),
	);
}

/**
 * Helper function to encode a cashu auth token authA.
 *
 * @param proof
 */
export function getEncodedAuthToken(proof: Proof): string {
	const token = {
		id: proof.id,
		secret: proof.secret,
		C: proof.C,
	};
	const base64Data = encodeJsonToBase64(token);
	const prefix = 'auth';
	const version = 'A';
	return prefix + version + base64Data;
}

function concatByteArrays(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((a, c) => a + c.length, 0);
	const byteArray = new Uint8Array(totalLength);
	let pointer = 0;
	for (let i = 0; i < arrays.length; i++) {
		byteArray.set(arrays[i], pointer);
		pointer = pointer + arrays[i].length;
	}
	return byteArray;
}

export function getEncodedTokenBinary(token: Token): Uint8Array {
	const utf8Encoder = new TextEncoder();
	const template = templateFromToken(token);
	const binaryTemplate = encodeCBOR(template);
	const prefix = utf8Encoder.encode('craw');
	const version = utf8Encoder.encode('B');
	return concatByteArrays(prefix, version, binaryTemplate);
}

export function getDecodedTokenBinary(bytes: Uint8Array): Token {
	const utfDecoder = new TextDecoder();
	const prefix = utfDecoder.decode(bytes.slice(0, 4));
	const version = utfDecoder.decode(new Uint8Array([bytes[4]]));
	if (prefix !== 'craw' || version !== 'B') {
		throw new Error('not a valid binary token');
	}
	const binaryToken = bytes.slice(5);
	const decoded = decodeCBOR(binaryToken) as TokenV4Template;
	return tokenFromTemplate(decoded);
}

function sumArray(arr: number[]) {
	return arr.reduce((a, c) => a + c, 0);
}
