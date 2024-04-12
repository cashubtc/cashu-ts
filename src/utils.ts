import { decode } from '@gandlaf21/bolt11-decode';
import { encodeBase64ToJson, encodeJsonToBase64 } from './base64.js';
import {
	AmountPreference,
	InvoiceData,
	MintKeys,
	Proof,
	Token,
	TokenEntry,
	TokenV2
} from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';
import { bytesToHex } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer/';

/**
 * Splits a number into its constituent powers of 2.
 * @param value The number to split
 * @param amountPreference An optional array of preferred amounts
 * @returns An array containing the constituent powers of 2
 */
export function splitAmount(
	value: number,
	amountPreference?: Array<AmountPreference>
): Array<number> {
	const chunks: Array<number> = [];
	if (amountPreference) {
		try {
			chunks.push(...getPreference(value, amountPreference));
		} catch (error) {
			console.error('Error occurred while getting preferences: ', error);
		}
		value =
			value -
			chunks.reduce((curr, acc) => {
				return curr + acc;
			}, 0);
	}
	for (let i = 0; i < 32; i++) {
		const mask: number = 1 << i;
		if ((value & mask) !== 0) {
			chunks.push(Math.pow(2, i));
		}
	}
	return chunks;
}

/**
 * Checks if a number is a power of two.
 * @param number The number to check
 * @returns True if the number is a power of two, false otherwise
 */
function isPowerOfTwo(number: number) {
	return number && !(number & (number - 1));
}

/**
 * Splits an amount into preferred chunks.
 * @param amount The amount to split
 * @param preferredAmounts An array of preferred amounts
 * @returns An array containing the split amounts
 */
function getPreference(amount: number, preferredAmounts: Array<AmountPreference>): Array<number> {
	const chunks: Array<number> = [];
	let accumulator = 0;
	preferredAmounts.forEach((pa) => {
		if (!isPowerOfTwo(pa.amount)) {
			throw new Error(
				'Provided amount preferences contain non-power-of-2 numbers. Use only ^2 numbers'
			);
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

/**
 * Returns the default amount preference for a given amount.
 * @param amount The amount to split
 * @returns An array of AmountPreference objects
 */
export function getDefaultAmountPreference(amount: number): Array<AmountPreference> {
	const amounts = splitAmount(amount);
	return amounts.map((a) => {
		return { amount: a, count: 1 };
	});
}

/**
 * Converts a byte array to a number.
 * @param bytes The byte array to convert
 * @returns The converted number
 */
export function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

/**
 * Converts a hexadecimal string to a number.
 * @param hex The hexadecimal string to convert
 * @returns The converted number
 */
export function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

/**
 * Stringifies a BigInt for JSON serialization.
 * @param _key The key of the value being stringified
 * @param value The value to stringify
 * @returns The stringified value
 */
export function bigIntStringify<T>(_key: unknown, value: T) {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Encodes a cashu token.
 * @param token The token to encode
 * @returns The encoded token
 */
export function getEncodedToken(token: Token): string {
	return TOKEN_PREFIX + TOKEN_VERSION + encodeJsonToBase64(token);
}

/**
 * Helper function to decode cashu tokens into object
 * @param token an encoded cashu token (cashuAey...)
 * @returns cashu token object
 */
export function getDecodedToken(token: string): Token {
	// remove prefixes
	const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:', 'cashuA'];
	uriPrefixes.forEach((prefix) => {
		if (!token.startsWith(prefix)) {
			return;
		}
		token = token.slice(prefix.length);
	});
	return handleTokens(token);
}

/**
 * Handles different versions of cashu tokens.
 * @param token The token to handle
 * @returns The handled token
 */
function handleTokens(token: string): Token {
	const obj = encodeBase64ToJson<TokenV2 | Array<Proof> | Token>(token);

	// check if v3
	if ('token' in obj) {
		return obj;
	}

	// check if v1
	if (Array.isArray(obj)) {
		return { token: [{ proofs: obj, mint: '' }] };
	}

	// if v2 token return v3 format
	return { token: [{ proofs: obj.proofs, mint: obj?.mints[0]?.url ?? '' }] };
}

/**
 * Derives the keyset id from a set of keys.
 * @param keys The keys to derive the keyset id from
 * @returns The derived keyset id
 */
export function deriveKeysetId(keys: MintKeys) {
	const pubkeysConcat = Object.entries(keys)
		.sort((a, b) => +a[0] - +b[0])
		.map(([, pubKey]) => pubKey)
		.join('');
	const hash = sha256(new TextEncoder().encode(pubkeysConcat));
	return Buffer.from(hash).toString('base64').slice(0, 12);
}

/**
 * Cleans a token by merging proofs from the same mint, removing TokenEntrys with no proofs or no mint field, and sorting proofs by id.
 * @param token The token to clean
 * @returns The cleaned token
 */
export function cleanToken(token: Token): Token {
	const tokenEntryMap: { [key: string]: TokenEntry } = {};
	for (const tokenEntry of token.token) {
		if (!tokenEntry?.proofs?.length || !tokenEntry?.mint) {
			continue;
		}
		if (tokenEntryMap[tokenEntry.mint]) {
			tokenEntryMap[tokenEntry.mint].proofs.push(...[...tokenEntry.proofs]);
			continue;
		}
		tokenEntryMap[tokenEntry.mint] = {
			mint: tokenEntry.mint,
			proofs: [...tokenEntry.proofs]
		};
	}
	return {
		memo: token?.memo,
		token: Object.values(tokenEntryMap).map((x) => ({
			...x,
			proofs: sortProofsById(x.proofs)
		}))
	};
}

/**
 * Sorts an array of proofs by id.
 * @param proofs The proofs to sort
 * @returns The sorted proofs
 */
export function sortProofsById(proofs: Array<Proof>) {
	return proofs.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Checks if a value is an object.
 * @param v The value to check
 * @returns True if the value is an object, false otherwise
 */
export function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

/**
 * Checks if a response object has any error fields.
 * Throws an Error if so.
 * @param data The response data to check
 */
export function checkResponse(data: { error?: string; detail?: string }): void {
	if (!isObj(data)) return;
	const message = data.error ?? data.detail;
	if (message) {
		throw new Error(message);
	}
}

export function joinUrls(...parts: Array<string>): string {
	return parts.map((part) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

export function decodeInvoice(bolt11Invoice: string): InvoiceData {
	const invoiceData: InvoiceData = {} as InvoiceData;
	const decodeResult = decode(bolt11Invoice);
	invoiceData.paymentRequest = decodeResult.paymentRequest;
	for (let i = 0; i < decodeResult.sections.length; i++) {
		const decodedSection = decodeResult.sections[i];
		if (decodedSection.name === 'amount') {
			invoiceData.amountInSats = Number(decodedSection.value) / 1000;
			invoiceData.amountInMSats = Number(decodedSection.value);
		}
		if (decodedSection.name === 'timestamp') {
			invoiceData.timestamp = decodedSection.value;
		}
		if (decodedSection.name === 'description') {
			invoiceData.memo = decodedSection.value;
		}
		if (decodedSection.name === 'expiry') {
			invoiceData.expiry = decodedSection.value;
		}
		if (decodedSection.name === 'payment_hash') {
			invoiceData.paymentHash = decodedSection.value.toString('hex');
		}
	}
	return invoiceData;
}

export {
	bigIntStringify,
	bytesToNumber,
	getDecodedToken,
	getEncodedToken,
	hexToNumber,
	splitAmount,
	getDefaultAmountPreference
};
