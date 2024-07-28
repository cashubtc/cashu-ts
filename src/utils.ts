import { encodeBase64ToJson, encodeBase64toUint8, encodeJsonToBase64 } from './base64.js';
import {
	AmountPreference,
	Keys,
	OutputAmounts,
	Proof,
	Token,
	TokenEntry,
	TokenV2
} from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { decodeCBOR } from './cbor.js';

function splitAmount(
	value: number,
	keyset: Keys,
	split?: Array<number>,
	order?: string
): Array<number> {
	const chunks: Array<number> = [];
	if (split) {
		if (split.reduce((a, b) => a + b, 0) > value) {
			throw new Error(
				`Split is greater than total amount: ${split.reduce((a, b) => a + b, 0)} > ${value}`
			);
		}
		chunks.push(...getPreference(value, keyset, split));
		value =
			value -
			chunks.reduce((curr, acc) => {
				return curr + acc;
			}, 0);
	}
	const sortedKeyAmounts = getKeysetAmounts(keyset);
	sortedKeyAmounts.forEach((amt) => {
		const q = Math.floor(value / amt);
		for (let i = 0; i < q; ++i) chunks.push(amt);
		value %= amt;
	});
	return chunks.sort((a, b) => (order === 'desc' ? b - a : a - b));
}

function getKeepAmounts(
	proofsWeHave: Array<Proof>,
	amountToKeep: number,
	keyset: Keys,
	targetCount: number
): Array<number> {
	// determines amounts we need to reach the targetCount for each amount based on the amounts of the proofs we have
	// it tries to select amounts so that the proofs we have and the proofs we want reach the targetCount
	const amountWeWant: Array<number> = [];
	const amountsWeHave = proofsWeHave.map((p) => p.amount);
	const sortedKeyAmounts = getKeysetAmounts(keyset);
	sortedKeyAmounts.forEach((amt) => {
		const count = amountsWeHave.filter((a) => a === amt).length;
		const q = Math.floor(targetCount - count);
		for (let i = 0; i < q; ++i) amountWeWant.push(amt);
	});
	return amountWeWant;
}

function isPowerOfTwo(number: number) {
	return number && !(number & (number - 1));
}
function getKeysetAmounts(keyset: Keys): Array<number> {
	return Object.keys(keyset)
		.map((k) => parseInt(k))
		.sort((a, b) => b - a);
}

function hasCorrespondingKey(amount: number, keyset: Keys) {
	return amount in keyset;
}

function getPreference(amount: number, keyset: Keys, split: Array<number>): Array<number> {
	const chunks: Array<number> = [];
	split.forEach((splitAmount) => {
		if (!hasCorrespondingKey(splitAmount, keyset)) {
			throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
		}
		chunks.push(splitAmount);
	});
	return chunks;
}

function deprecatedPreferenceToOutputAmounts(preference?: Array<AmountPreference>): OutputAmounts {
	const sendAmounts: Array<number> = [];
	preference?.forEach(({ count, amount }) => {
		for (let i = 0; i < count; i++) {
			sendAmounts.push(amount);
		}
	});
	return { sendAmounts };
}
function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

//used for json serialization
function bigIntStringify<T>(_key: unknown, value: T) {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Helper function to encode a v3 cashu token
 * @param token
 * @returns
 */
function getEncodedToken(token: Token): string {
	return TOKEN_PREFIX + TOKEN_VERSION + encodeJsonToBase64(token);
}

/**
 * Helper function to decode cashu tokens into object
 * @param token an encoded cashu token (cashuAey...)
 * @returns cashu token object
 */
function getDecodedToken(token: string) {
	// remove prefixes
	const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:', 'cashu'];
	uriPrefixes.forEach((prefix) => {
		if (!token.startsWith(prefix)) {
			return;
		}
		token = token.slice(prefix.length);
	});
	return handleTokens(token);
}

/**
 * @param token
 * @returns
 */
function handleTokens(token: string): Token {
	const version = token.slice(0, 1);
	const encodedToken = token.slice(1);
	if (version === 'A') {
		return encodeBase64ToJson<Token>(encodedToken);
	} else if (version === 'B') {
		const uInt8Token = encodeBase64toUint8(encodedToken);
		const tokenData = decodeCBOR(uInt8Token) as {
			t: Array<{ p: Array<{ a: number; s: string; c: Uint8Array }>; i: Uint8Array }>;
			m: string;
			d: string;
		};
		const mergedTokenEntry: TokenEntry = { mint: tokenData.m, proofs: [] };
		tokenData.t.forEach((tokenEntry) =>
			tokenEntry.p.forEach((p) => {
				mergedTokenEntry.proofs.push({
					secret: p.s,
					C: bytesToHex(p.c),
					amount: p.a,
					id: bytesToHex(tokenEntry.i)
				});
			})
		);
		return { token: [mergedTokenEntry], memo: tokenData.d || '' };
	}
	throw new Error('Token version is not supported');
}
/**
 * Returns the keyset id of a set of keys
 * @param keys keys object to derive keyset id from
 * @returns
 */
export function deriveKeysetId(keys: Keys) {
	const pubkeysConcat = Object.entries(keys)
		.sort((a, b) => +a[0] - +b[0])
		.map(([, pubKey]) => hexToBytes(pubKey))
		.reduce((prev, curr) => mergeUInt8Arrays(prev, curr), new Uint8Array());
	const hash = sha256(pubkeysConcat);
	const hashHex = Buffer.from(hash).toString('hex').slice(0, 14);
	return '00' + hashHex;
}

function mergeUInt8Arrays(a1: Uint8Array, a2: Uint8Array): Uint8Array {
	// sum of individual array lengths
	const mergedArray = new Uint8Array(a1.length + a2.length);
	mergedArray.set(a1);
	mergedArray.set(a2, a1.length);
	return mergedArray;
}

export function sortProofsById(proofs: Array<Proof>) {
	return proofs.sort((a, b) => a.id.localeCompare(b.id));
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

export function joinUrls(...parts: Array<string>): string {
	return parts.map((part) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

export function sanitizeUrl(url: string): string {
	return url.replace(/\/$/, '');
}

export function sumProofs(proofs: Array<Proof>) {
	return proofs.reduce((acc, proof) => acc + proof.amount, 0);
}

export {
	bigIntStringify,
	bytesToNumber,
	getDecodedToken,
	getEncodedToken,
	hexToNumber,
	splitAmount,
	deprecatedPreferenceToOutputAmounts,
	getKeepAmounts
};
