import {
	encodeBase64ToJson,
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeUint8toBase64Url
} from './base64.js';
import {
	Keys,
	Proof,
	RawPaymentRequest,
	RawTransport,
	Token,
	TokenEntry,
	TokenV4Template,
	V4InnerToken,
	V4ProofTemplate
} from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { decodeCBOR, encodeCBOR } from './cbor.js';
import { PaymentRequest } from './model/PaymentRequest.js';

function splitAmount(
	value: number,
	keyset: Keys,
	split?: Array<number>,
	order?: string
): Array<number> {
	const chunks: Array<number> = [];
	if (split) {
		if (split.reduce((a: number, b: number) => a + b, 0) > value) {
			throw new Error(
				`Split is greater than total amount: ${split.reduce(
					(a: number, b: number) => a + b,
					0
				)} > ${value}`
			);
		}
		chunks.push(...getPreference(value, keyset, split));
		value =
			value -
			chunks.reduce((curr: number, acc: number) => {
				return curr + acc;
			}, 0);
	}
	const sortedKeyAmounts = getKeysetAmounts(keyset);
	sortedKeyAmounts.forEach((amt: number) => {
		const q = Math.floor(value / amt);
		for (let i = 0; i < q; ++i) chunks.push(amt);
		value %= amt;
	});
	return chunks.sort((a, b) => (order === 'desc' ? b - a : a - b));
}

function getKeepAmounts(
	proofsWeHave: Array<Proof>,
	amountToKeep: number,
	keys: Keys,
	targetCount: number
): Array<number> {
	// determines amounts we need to reach the targetCount for each amount based on the amounts of the proofs we have
	// it tries to select amounts so that the proofs we have and the proofs we want reach the targetCount
	const amountsWeWant: Array<number> = [];
	const amountsWeHave = proofsWeHave.map((p: Proof) => p.amount);
	const sortedKeyAmounts = getKeysetAmounts(keys, 'asc');
	sortedKeyAmounts.forEach((amt) => {
		const countWeHave = amountsWeHave.filter((a) => a === amt).length;
		const countWeWant = Math.floor(targetCount - countWeHave);
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
	const sortedAmountsWeWant = amountsWeWant.sort((a, b) => a - b);
	// console.log(`# getKeepAmounts: amountToKeep: ${amountToKeep}`);
	// console.log(`# getKeepAmounts: amountsWeHave: ${amountsWeHave}`);
	// console.log(`# getKeepAmounts: amountsWeWant: ${sortedAmountsWeWant}`);
	return sortedAmountsWeWant;
}

// function isPowerOfTwo(number: number) {
// 	return number && !(number & (number - 1));
// }
function getKeysetAmounts(keyset: Keys, order = 'desc'): Array<number> {
	if (order == 'desc') {
		return Object.keys(keyset)
			.map((k: string) => parseInt(k))
			.sort((a: number, b: number) => b - a);
	}
	return Object.keys(keyset)
		.map((k: string) => parseInt(k))
		.sort((a: number, b: number) => a - b);
}

function hasCorrespondingKey(amount: number, keyset: Keys) {
	return amount in keyset;
}

function getPreference(amount: number, keyset: Keys, split: Array<number>): Array<number> {
	const chunks: Array<number> = [];
	split.forEach((splitAmount: number) => {
		if (!hasCorrespondingKey(splitAmount, keyset)) {
			throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
		}
		chunks.push(splitAmount);
	});
	return chunks;
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
			(id: string): V4InnerToken => ({
				i: hexToBytes(id),
				p: idMap[id].map(
					(p: Proof): V4ProofTemplate => ({ a: p.amount, s: p.secret, c: hexToBytes(p.C) })
				)
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
	uriPrefixes.forEach((prefix: string) => {
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
		tokenData.t.forEach((tokenEntry: V4InnerToken) =>
			tokenEntry.p.forEach((p: V4ProofTemplate) => {
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
		.sort((a: [string, string], b: [string, string]) => +a[0] - +b[0])
		.map(([, pubKey]: [unknown, string]) => hexToBytes(pubKey))
		.reduce((prev: Uint8Array, curr: Uint8Array) => mergeUInt8Arrays(prev, curr), new Uint8Array());
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

export function joinUrls(...parts: Array<string>): string {
	return parts.map((part: string) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

export function sanitizeUrl(url: string): string {
	return url.replace(/\/$/, '');
}

export function sumProofs(proofs: Array<Proof>) {
	return proofs.reduce((acc: number, proof: Proof) => acc + proof.amount, 0);
}

function decodePaymentRequest(paymentRequest: string) {
	return PaymentRequest.fromEncodedRequest(paymentRequest);
}

export {
	bigIntStringify,
	bytesToNumber,
	getDecodedToken,
	getEncodedToken,
	getEncodedTokenV4,
	hexToNumber,
	splitAmount,
	getKeepAmounts,
	decodePaymentRequest
};
