import {
	encodeBase64ToJson,
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeUint8toBase64,
	encodeUint8toBase64Url
} from './base64.js';
import {
	AmountPreference,
	Keys,
	Proof,
	Token,
	TokenEntry,
	TokenV2,
	TokenV4Template,
	V4InnerToken,
	V4ProofTemplate
} from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { decodeCBOR, encodeCBOR } from './cbor.js';

function splitAmount(
	value: number,
	keyset: Keys,
	amountPreference?: Array<AmountPreference>,
	order?: string
): Array<number> {
	const chunks: Array<number> = [];
	if (amountPreference) {
		chunks.push(...getPreference(value, keyset, amountPreference));
		value =
			value -
			chunks.reduce((curr, acc) => {
				return curr + acc;
			}, 0);
	}
	const sortedKeyAmounts: Array<number> = Object.keys(keyset)
		.map((k) => parseInt(k))
		.sort((a, b) => b - a);
	sortedKeyAmounts.forEach((amt) => {
		let q = Math.floor(value / amt);
		for (let i = 0; i < q; ++i) chunks.push(amt);
		value %= amt;
	});
	return chunks.sort((a, b) => (order === 'desc' ? b - a : a - b));
}

function isPowerOfTwo(number: number) {
	return number && !(number & (number - 1));
}

function hasCorrespondingKey(amount: number, keyset: Keys) {
	return amount in keyset;
}

function getPreference(
	amount: number,
	keyset: Keys,
	preferredAmounts: Array<AmountPreference>
): Array<number> {
	const chunks: Array<number> = [];
	let accumulator = 0;
	preferredAmounts.forEach((pa) => {
		if (!hasCorrespondingKey(pa.amount, keyset)) {
			throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
		}
		for (let i = 1; i <= pa.count; i++) {
			accumulator += pa.amount;
			if (accumulator > amount) {
				return;
			}
			chunks.push(pa.amount);
		}
	});
	return chunks;
}

function getDefaultAmountPreference(amount: number, keyset: Keys): Array<AmountPreference> {
	const amounts = splitAmount(amount, keyset);
	return amounts.map((a) => {
		return { amount: a, count: 1 };
	});
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

function getEncodedTokenV4(token: Token): string {
	const idMap: { [id: string]: Array<Proof> } = {};
	let mint: string | undefined = undefined;
	for (let i = 0; i < token.token.length; i++) {
		if (!mint) {
			mint = token.token[i].mint;
		} else {
			if (mint !== token.token[i].mint) {
				throw new Error('Multimint token can not be encoded as V4 token');
			}
		}
		for (let j = 0; j < token.token[i].proofs.length; j++) {
			const proof = token.token[i].proofs[j];
			if (idMap[proof.id]) {
				idMap[proof.id].push(proof);
			} else {
				idMap[proof.id] = [proof];
			}
		}
	}
	const tokenTemplate: TokenV4Template = {
		m: mint,
		u: token.unit || 'sat',
		t: Object.keys(idMap).map(
			(id): V4InnerToken => ({
				i: hexToBytes(id),
				p: idMap[id].map((p): V4ProofTemplate => ({ a: p.amount, s: p.secret, c: hexToBytes(p.C) }))
			})
		)
	} as TokenV4Template;

	if (token.memo) {
		tokenTemplate.d = token.memo;
	}

	const encodedData = encodeCBOR(tokenTemplate);
	const prefix = 'cashu';
	const version = 'B';
	const base64Data = encodeUint8toBase64Url(encodedData);
	return prefix + version + base64Data;
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
			u: string;
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
		return { token: [mergedTokenEntry], memo: tokenData.d || '', unit: tokenData.u || 'sat' };
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

export {
	bigIntStringify,
	bytesToNumber,
	getDecodedToken,
	getEncodedToken,
	getEncodedTokenV4,
	hexToNumber,
	splitAmount,
	getDefaultAmountPreference
};
