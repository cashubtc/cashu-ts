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

/**
 * Splits the amount into denominations of the provided @param keyset
 * @param value amount to split
 * @param keyset keys to look up split amounts
 * @param split? optional custom split amounts 
 * @param order? optional order for split amounts (default: "asc")
 * @returns Array of split amounts
 * @throws Error if @param split amount is greater than @param value amount
 */
export function splitAmount(
	value: number,
	keyset: Keys,
	split?: Array<number>,
	order?: "desc" | "asc"
): Array<number> {
	if (split) {
		if (split.reduce((a: number, b: number) => a + b, 0) > value) {
			throw new Error(
				`Split is greater than total amount: ${split.reduce(
					(a: number, b: number) => a + b,
					0
				)} > ${value}`
			);
		}
		split.forEach((amt: number)  => {
			if (!hasCorrespondingKey(amt, keyset)) {
				throw new Error('Provided amount preferences do not match the amounts of the mint keyset.');
			}
		})
		value =
			value -
			split.reduce((curr: number, acc: number) => {
				return curr + acc;
			}, 0);
	}
	else {
		split = [];
	}
	const sortedKeyAmounts = getKeysetAmounts(keyset);
	sortedKeyAmounts.forEach((amt: number) => {
		const q = Math.floor(value / amt);
		for (let i = 0; i < q; ++i) split?.push(amt);
		value %= amt;
	});
	return split.sort((a, b) => (order === 'desc' ? b - a : a - b));
}

/**
 * Creates a list of amounts to keep based on the proofs we have and the proofs we want to reach.
 * @param proofsWeHave complete set of proofs stored (from current mint)
 * @param amountToKeep amount to keep
 * @param keys keys of current keyset
 * @param targetCount the target number of proofs to reach
 * @returns an array of amounts to keep
 */
export function getKeepAmounts(
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
	return sortedAmountsWeWant;
}
/**
 * returns the amounts in the keyset sorted by the order specified
 * @param keyset to search in
 * @param order order to sort the amounts in
 * @returns the amounts in the keyset sorted by the order specified
 */
export function getKeysetAmounts(keyset: Keys, order: "asc" | "desc" = 'desc'): Array<number> {
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
 * @param amount amount to check
 * @param keyset to search in
 * @returns true if the amount is in the keyset, false otherwise
 */
export function hasCorrespondingKey(amount: number, keyset: Keys): boolean {
	return amount in keyset;
}

/**
 * Converts a bytes array to a number.
 * @param bytes to convert to number
 * @returns  number
 */
export function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

/**
 * Converts a hex string to a number.
 * @param hex to convert to number
 * @returns number
 */
export function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

/**
  * Helper function to stringify a bigint
  * @param _key 
  * @param value to stringify
  * @returns stringified bigint
  */
export function bigIntStringify<T>(_key: unknown, value: T): string | T {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Helper function to encode a v3 cashu token
 * @param token to encode
 * @returns encoded token
 */
export function getEncodedToken(token: Token): string {
	return TOKEN_PREFIX + TOKEN_VERSION + encodeJsonToBase64(token);
}

/**
  * Helper function to encode a v4 cashu token
  * @param token to encode
  * @returns encoded token
  */
export function getEncodedTokenV4(token: Token): string {
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
export function getDecodedToken(token: string) {
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
 * Helper function to decode different versions of cashu tokens into an object
 * @param token an encoded cashu token (cashuAey...)
 * @returns cashu Token object
 */
export function handleTokens(token: string): Token {
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

export function mergeUInt8Arrays(a1: Uint8Array, a2: Uint8Array): Uint8Array {
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

export function decodePaymentRequest(paymentRequest: string) {
	return PaymentRequest.fromEncodedRequest(paymentRequest);
}
