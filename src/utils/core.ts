import { type DLEQ, pointFromHex, verifyDLEQProof_reblind } from '../crypto';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encodeBase64ToJson, encodeBase64toUint8, encodeUint8toBase64Url } from './base64';
import { decodeCBOR, encodeCBOR } from './cbor';
import { JSONInt } from './JSONInt';
import { PaymentRequest } from '../model/PaymentRequest';
import { Amount, type AmountLike } from '../model/Amount';
import type {
	TokenMetadata,
	DeprecatedToken,
	Keys,
	Proof,
	SerializedDLEQ,
	Token,
	TokenV4Template,
	V4DLEQTemplate,
	V4InnerToken,
	V4ProofTemplate,
	HasKeysetKeys,
} from '../model/types';
import { Bytes } from './Bytes';

/**
 * Splits the amount into denominations of the provided keyset.
 *
 * @remarks
 * Partial splits will be filled up to value using minimum splits required. Sorting is only applied
 * if a fill was made - exact custom splits are always returned in the same order.
 * @param value Amount to split.
 * @param keyset Keys to look up split amounts.
 * @param split? Optional custom split amounts.
 * @param order? Optional order for split amounts (if fill was required)
 * @returns Array of split amounts.
 * @throws Error if split sum is greater than value or mint does not have keys for requested split.
 */
export function splitAmount(
	value: AmountLike,
	keyset: Keys,
	split?: AmountLike[],
	order?: 'desc' | 'asc',
): Amount[] {
	let remainingValue = toAmount(value, 'splitAmount.value', true);
	let normalizedSplit = split?.map((amt) => toAmount(amt, 'splitAmount.split', true));

	if (normalizedSplit) {
		const totalSplitAmount = Amount.sum(normalizedSplit);

		// Special case: explicit "zero-total" outputs (restore or NUT-08 blanks)
		if (remainingValue.isZero() && totalSplitAmount.isZero()) {
			return normalizedSplit;
		}

		// Normal positive-value paths: ignore zeros for validation and totals
		const positive = normalizedSplit.filter((amt) => !amt.isZero());
		const totalPositive = Amount.sum(positive);
		if (totalPositive.greaterThan(remainingValue)) {
			throw new Error(
				`Split is greater than total amount: ${totalPositive.toString()} > ${remainingValue.toString()}`,
			);
		}
		if (positive.some((amt) => !hasCorrespondingKey(amt, keyset))) {
			throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
		}

		// if caller supplied an exact custom split, preserve their order
		if (totalPositive.equals(remainingValue)) {
			return positive;
		}

		// Work only with validated positive amounts from here on
		normalizedSplit = positive;
		remainingValue = remainingValue.subtract(totalPositive);
	} else {
		normalizedSplit = [];
	}

	// Denomination fill for the remaining value
	const sortedKeyAmounts = getKeysetAmountsAsAmount(keyset, 'desc');
	if (sortedKeyAmounts.length === 0) {
		throw new Error('Cannot split amount, keyset is inactive or contains no keys');
	}
	for (const amtAsAmount of sortedKeyAmounts) {
		if (amtAsAmount.isZero()) continue;
		// Calculate how many of this denomination fit into the remaining value
		const requireCount = remainingValue.divideBy(amtAsAmount).toNumber();
		// Add them to the split and reduce the target value by added amounts
		normalizedSplit.push(...Array<Amount>(requireCount).fill(amtAsAmount));
		remainingValue = remainingValue.subtract(amtAsAmount.multiplyBy(requireCount));
		// Break early once target is satisfied
		if (remainingValue.isZero()) break;
	}
	if (!remainingValue.isZero()) {
		throw new Error(`Unable to split remaining amount: ${remainingValue.toString()}`);
	}

	// Only sort when we performed a fill and it was requested
	// Exact custom splits were returned unsorted earlier
	if (order) {
		normalizedSplit = normalizedSplit.sort((a, b) =>
			order === 'desc' ? b.compareTo(a) : a.compareTo(b),
		);
	}
	return normalizedSplit;
}

/**
 * Returns the amounts in the keyset sorted by the order specified.
 *
 * @param keyset To search in.
 * @param order Order to sort the amounts in.
 * @returns The amounts in the keyset sorted by the order specified.
 */
export function getKeysetAmounts(keyset: Keys, order: 'asc' | 'desc' = 'desc'): Amount[] {
	return getKeysetAmountsAsAmount(keyset, order);
}

function getKeysetAmountsAsAmount(keyset: Keys, order: 'asc' | 'desc'): Amount[] {
	const amounts = Object.keys(keyset).map((k: string) => Amount.from(k));
	amounts.sort((a, b) => (order === 'desc' ? b.compareTo(a) : a.compareTo(b)));
	return amounts;
}

/**
 * Checks if the provided amount is in the keyset.
 *
 * @param amount Amount to check.
 * @param keyset To search in.
 * @returns True if the amount is in the keyset, false otherwise.
 */
export function hasCorrespondingKey(amount: AmountLike, keyset: Keys): boolean {
	return toAmount(amount, 'hasCorrespondingKey.amount', true).toString() in keyset;
}

function toAmount(amount: AmountLike, op: string, allowZero = false): Amount {
	const parsed = Amount.from(amount);
	if (!allowZero && parsed.isZero()) {
		throw new Error(`Amount must be positive: ${parsed.toString()}, op: ${op}`);
	}
	return parsed;
}

/**
 * Converts a hex string to a bigint scalar. Returns `0n` for empty/falsy input.
 *
 * @internal
 */
export function hexToNumber(hex: string): bigint {
	return hex ? BigInt(`0x${hex}`) : 0n;
}

/**
 * Converts a bigint scalar to a zero-padded 64-character hex string (32 bytes).
 *
 * @internal
 */
export function numberToHexPadded64(scalar: bigint): string {
	return scalar.toString(16).padStart(64, '0');
}

/**
 * Returns `true` if the string contains only hexadecimal characters (case-insensitive).
 *
 * @internal
 */
export function isValidHex(str: string) {
	return /^[a-f0-9]+$/i.test(str);
}

function hasNonHexId(p: Proof | Proof[]) {
	if (Array.isArray(p)) {
		return p.some((proof) => !isValidHex(proof.id));
	}
	return !isValidHex(p.id);
}

/**
 * `JSON.stringify` replacer that converts `bigint` values to strings.
 *
 * @internal
 */
export function bigIntStringify<T>(_key: unknown, value: T) {
	return typeof value === 'bigint' ? value.toString() : value;
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
 * Encodes a {@link Token} as a cashu token string.
 */
export function getEncodedToken(token: Token, opts?: { removeDleq?: boolean }): string {
	if (hasNonHexId(token.proofs)) {
		throw new Error(
			'Proofs contain a legacy keyset ID and cannot be encoded. Swap them at the mint first.',
		);
	}
	return getEncodedTokenV4(token, opts?.removeDleq);
}

/**
 * Encodes a {@link Token} as a v4 CBOR cashu token string (`cashuB…`).
 *
 * @internal Use {@link getEncodedToken} instead.
 */
function getEncodedTokenV4(token: Token, removeDleq?: boolean): string {
	let proofs = token.proofs;
	if (removeDleq) {
		proofs = stripDleq(proofs);
	}
	// Make sure each DLEQ has its blinding factor
	proofs.forEach((p) => {
		if (p.dleq && p.dleq.r == undefined) {
			throw new Error('Missing blinding factor in included DLEQ proof');
		}
	});
	const nonHex = hasNonHexId(proofs);
	if (nonHex) {
		throw new Error('can not encode to v4 token if proofs contain non-hex keyset id');
	}
	// Map keyset IDs to short IDs
	proofs = convertToShortKeysetId(proofs);

	const tokenTemplate = templateFromToken({ ...token, proofs });

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
						...(p.p2pk_e && {
							pe: hexToBytes(p.p2pk_e),
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
				amount: Amount.from(p.a).toBigInt(),
				id: bytesToHex(t.i),
				...(p.d && {
					dleq: {
						r: bytesToHex(p.d.r),
						s: bytesToHex(p.d.s),
						e: bytesToHex(p.d.e),
					} as SerializedDLEQ,
				}),
				...(p.pe && {
					p2pk_e: bytesToHex(p.pe),
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
 * Helper function to decode cashu tokens into an object.
 *
 * @param token An encoded cashu token (cashuB...)
 * @param keysets Array of full keyset ID strings, eg: from `KeyChain.getAllKeysetIds()`
 * @returns Cashu token object.
 */
export function getDecodedToken(tokenString: string, keysetIds: readonly string[]): Token {
	const tokenStr = removePrefix(tokenString);
	const token: Token = handleTokens(tokenStr);
	token.proofs = mapShortKeysetIds(token.proofs, keysetIds);
	return token;
}

/**
 * Returns the metadata of a cashu token.
 *
 * @param token An encoded cashu token (cashuB...)
 * @returns Token metadata.
 */
export function getTokenMetadata(token: string): TokenMetadata {
	token = removePrefix(token);
	const tokenObj = handleTokens(token);
	return {
		unit: tokenObj.unit || 'sat',
		mint: tokenObj.mint,
		amount: sumProofs(tokenObj.proofs),
		...(tokenObj.memo && { memo: tokenObj.memo }),
		incompleteProofs: tokenObj.proofs.map((p) => {
			const { id, ...rest } = p;
			void id;
			return rest;
		}),
	};
}

/**
 * Private helper function to decode different versions of cashu tokens into an object.
 *
 * @remarks
 * Callers should use {@link getDecodedToken} or {@link getTokenMetadata}
 * @param token An encoded cashu token (cashuB...)
 * @returns Cashu Token object.
 */
function handleTokens(token: string): Token {
	const version = token.slice(0, 1);
	const encodedToken = token.slice(1);
	if (version === 'A') {
		const parsedV3Token = encodeBase64ToJson<DeprecatedToken>(encodedToken);
		if (parsedV3Token.token.length > 1) {
			throw new Error('Multi entry token are not supported');
		}
		const entry = parsedV3Token.token[0];
		const proofs = entry.proofs.map((p) => ({
			...p,
			amount: Amount.from(p.amount as AmountLike).toBigInt(),
		}));
		const tokenObj: Token = {
			mint: entry.mint,
			proofs,
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

export type DeriveKeysetIdOptions = {
	expiry?: number;
	input_fee_ppk?: number;
	unit?: string;
	versionByte?: number;
	isDeprecatedBase64?: boolean;
};

/**
 * Returns the keyset id of a set of keys.
 *
 * @param keys Keys object to derive keyset id from.
 * @param options.expiry (optional) expiry of the keyset.
 * @param options.input_fee_ppk (optional) Input fee for keyset (in ppk)
 * @param options.unit (optional) the unit of the keyset. Default: sat.
 * @param options.versionByte (optional) version of the keyset ID. Default: 1.
 * @param options.isDeprecatedBase64 (optional) version of the keyset ID. Default: false.
 * @returns Keyset id of the keys.
 * @throws If keyset versionByte is not valid.
 */
export function deriveKeysetId(keys: Keys, options?: DeriveKeysetIdOptions): string {
	const unit = options?.unit ?? 'sat'; // default: sat
	const expiry = options?.expiry;
	const versionByte = options?.versionByte ?? 1; // default: 1
	const input_fee_ppk = options?.input_fee_ppk;
	const isDeprecatedBase64 = options?.isDeprecatedBase64 ?? false; // default: false

	if (isDeprecatedBase64) {
		const pubkeysConcat = Object.entries(keys)
			.sort(([amountA], [amountB]) => Amount.from(amountA).compareTo(amountB))
			.map(([, pubKey]) => pubKey)
			.reduce((prev: string, curr: string) => prev + curr, '');
		const hash = sha256(Bytes.fromString(pubkeysConcat));
		const b64 = Bytes.toBase64(hash);
		return b64.slice(0, 12);
	}

	switch (versionByte) {
		case 0: {
			const pubkeysConcat = mergeUInt8Arrays(
				...Object.entries(keys)
					.sort(([amountA], [amountB]) => Amount.from(amountA).compareTo(amountB))
					.map(([, pubKey]) => hexToBytes(pubKey)),
			);
			const hash = sha256(pubkeysConcat);
			const hashHex = Bytes.toHex(hash).slice(0, 14);
			return '00' + hashHex;
		}
		case 1: {
			if (!unit) {
				throw new Error('Cannot compute keyset ID version 01: unit is required.');
			}
			const sortedEntries = Object.entries(keys).sort(([amountA], [amountB]) =>
				Amount.from(amountA).compareTo(amountB),
			);
			let preimage = sortedEntries.map(([amount, pubkey]) => `${amount}:${pubkey}`).join(',');
			preimage += `|unit:${unit}`;
			// Per NUT-02: input_fee_ppk and expiry must be specified AND non-zero (truthy)
			if (input_fee_ppk) {
				preimage += `|input_fee_ppk:${input_fee_ppk}`;
			}
			if (expiry) {
				preimage += `|final_expiry:${expiry}`;
			}
			const hash = sha256(Bytes.fromString(preimage));
			const hashHex = Bytes.toHex(hash);
			return '01' + hashHex;
		}
		default:
			throw new Error(`Unrecognized keyset ID version: ${versionByte}`);
	}
}

function mergeUInt8Arrays(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((a, c) => a + c.length, 0);
	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		merged.set(arr, offset);
		offset += arr.length;
	}
	return merged;
}

/**
 * Returns a copy of `proofs` sorted by keyset id (lexicographic).
 */
export function sortProofsById(proofs: Proof[]) {
	return [...proofs].sort((a: Proof, b: Proof) => a.id.localeCompare(b.id));
}

/**
 * Type guard: returns `true` if `v` is a non-null object.
 *
 * @internal
 */
export function isObj(v: unknown): v is object {
	return v != null && typeof v === 'object';
}

/**
 * Joins URL path segments, stripping leading/trailing slashes from each part.
 *
 * @internal
 */
export function joinUrls(...parts: string[]): string {
	return parts.map((part: string) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

/**
 * Strips a trailing slash from a URL.
 *
 * @internal
 */
export function sanitizeUrl(url: string): string {
	return url.replace(/\/$/, '');
}

/**
 * Sums the `amount` field of the given proofs.
 */
export function sumProofs(proofs: Array<Pick<Proof, 'amount'>>): Amount {
	return Amount.sum(proofs.map((proof) => proof.amount));
}

/**
 * Normalizes raw proof objects (e.g. from a database query) into typed {@link Proof} objects by
 * converting `amount` to `bigint`. Use {@link deserializeProofs} if your proofs are stored as JSON.
 *
 * @example
 *
 *     const proofs = normalizeProofAmounts(db.query('SELECT * FROM proofs'));
 */
export function normalizeProofAmounts(
	raw: Array<Omit<Proof, 'amount'> & { amount: AmountLike }>,
): Proof[] {
	return raw.map((p) => ({ ...p, amount: Amount.from(p.amount).toBigInt() }));
}

/**
 * Serializes an array of {@link Proof} objects to a JSON string. BigInt `amount` fields are emitted
 * as plain JSON numbers.
 *
 * @example
 *
 *     localStorage.setItem('proofs', serializeProofs(proofs));
 */
export function serializeProofs(proofs: Proof[]): string {
	return JSONInt.stringify(proofs) as string;
}

/**
 * Deserializes a JSON string produced by {@link serializeProofs} back into typed {@link Proof}
 * objects, restoring `amount` as `bigint` without silent precision loss.
 *
 * @example
 *
 *     const proofs = deserializeProofs(localStorage.getItem('proofs') ?? '[]');
 */
export function deserializeProofs(json: string): Proof[] {
	return normalizeProofAmounts(
		JSONInt.parse(json) as Array<Omit<Proof, 'amount'> & { amount: AmountLike }>,
	);
}

/**
 * Decodes an encoded cashu payment request string into a {@link PaymentRequest}.
 */
export function decodePaymentRequest(paymentRequest: string) {
	return PaymentRequest.fromEncodedRequest(paymentRequest);
}

/**
 * Removes all traces of DLEQs from a list of proofs.
 *
 * @param proofs The list of proofs that dleq should be stripped from.
 */
export function stripDleq(proofs: Proof[]): Array<Omit<Proof, 'dleq'>> {
	return proofs.map((p) => {
		const { dleq, ...rest } = p;
		void dleq;
		return rest;
	});
}

/**
 * Maps the short keyset IDs stored in the token to actual keyset IDs that were fetched from the
 * Mint.
 *
 * @param proofs Array of Proofs.
 * @param keysets Array of full keyset ID strings, eg: from `KeyChain.getAllKeysetIds()`
 * @returns Array of Proofs with full keyset IDs.
 */
function mapShortKeysetIds(proofs: Proof[], keysetIds: readonly string[]): Proof[] {
	const uniqueIds = [...new Set(keysetIds.map((id) => id.toLowerCase()))];
	const newProofs: Proof[] = [];
	for (const proof of proofs) {
		let idBytes: Uint8Array;
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
			if (!uniqueIds.length) {
				throw new Error('A short keyset ID v2 was encountered, but got no keysets to map it to.');
			}
			// Look for a match: prefix(keyset ID) == short ID
			const shortId = proof.id.toLowerCase();
			const matches = uniqueIds.filter((id) => shortId === id.slice(0, shortId.length));
			if (matches.length > 1) {
				throw new Error(`Short keyset ID ${proof.id} is ambiguous.`);
			}
			if (matches.length === 0) {
				throw new Error(
					`Couldn't map short keyset ID ${proof.id} to any known keysets of the current Mint`,
				);
			}
			proof.id = matches[0];
			newProofs.push(proof);
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
 * @param keyset Object containing keyset keys (eg: Keyset, MintKeys, KeysetCache)
 * @returns True if verification succeeded, false otherwise.
 * @throws Throws if the proof amount does not match any key in the provided keyset.
 */
export function hasValidDleq(proof: Proof, keyset: HasKeysetKeys): boolean {
	if (proof.dleq == undefined) {
		return false;
	}
	const dleq = {
		e: hexToBytes(proof.dleq.e),
		s: hexToBytes(proof.dleq.s),
		r: hexToNumber(proof.dleq.r ?? '00'),
	} as DLEQ;
	if (!hasCorrespondingKey(proof.amount, keyset.keys)) {
		throw new Error(`Undefined key for amount ${proof.amount} in keyset ${keyset.id}`);
	}
	const key = keyset.keys[proof.amount.toString()];
	return verifyDLEQProof_reblind(
		new TextEncoder().encode(proof.secret),
		dleq,
		pointFromHex(proof.C),
		pointFromHex(key),
	);
}

/**
 * Encodes a {@link Token} as a raw binary token (`craw` + `B` + CBOR).
 */
export function getEncodedTokenBinary(token: Token): Uint8Array {
	const utf8Encoder = new TextEncoder();
	const template = templateFromToken(token);
	const binaryTemplate = encodeCBOR(template);
	const prefix = utf8Encoder.encode('craw');
	const version = utf8Encoder.encode('B');
	return mergeUInt8Arrays(prefix, version, binaryTemplate);
}

/**
 * Decodes a raw binary token (`craw` + `B` + CBOR) into a {@link Token}.
 */
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

function removePrefix(token: string): string {
	// Strip optional URI scheme first, then the required "cashu" token prefix
	const uriSchemes = ['web+cashu://', 'cashu://', 'cashu:'];
	for (const scheme of uriSchemes) {
		if (token.startsWith(scheme)) {
			token = token.slice(scheme.length);
			break;
		}
	}
	if (token.startsWith('cashu')) {
		token = token.slice('cashu'.length);
	}
	return token;
}

/**
 * Detects whether a BOLT-11 Lightning invoice encodes a non-zero amount in the Human-Readable Part
 * (HRP).
 *
 * @internal
 */
export function invoiceHasAmountInHRP(invoice: string): boolean {
	return /^ln[a-z]{2,}[1-9][0-9]*(?:[mun]|0p)?1/i.test(invoice);
}
