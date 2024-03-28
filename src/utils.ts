import { decode } from '@gandlaf21/bolt11-decode';
import { encodeBase64ToJson, encodeJsonToBase64 } from './base64.js';
import {
	AmountPreference,
	InvoiceData,
	Keys,
	Proof,
	Token,
	TokenEntry,
	TokenV2
} from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';
import { bytesToHex } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';

function splitAmount(value: number, amountPreference?: Array<AmountPreference>): Array<number> {
	const chunks: Array<number> = [];
	if (amountPreference) {
		chunks.push(...getPreference(value, amountPreference));
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

function isPowerOfTwo(number: number) {
	return number && !(number & (number - 1));
}

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

function getDefaultAmountPreference(amount: number): Array<AmountPreference> {
	const amounts = splitAmount(amount);
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

/**
 * Helper function to decode cashu tokens into object
 * @param token an encoded cashu token (cashuAey...)
 * @returns cashu token object
 */
function getDecodedToken(token: string): Token {
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
 * @param token
 * @returns
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
 * Returns the keyset id of a set of keys
 * @param keys keys object to derive keyset id from
 * @returns
 */
export function deriveKeysetId(keys: Keys) {
	const pubkeysConcat = Object.entries(keys)
		.sort((a, b) => +a[0] - +b[0])
		.map(([, pubKey]) => pubKey)
		.join('');
	const hash = sha256(new TextEncoder().encode(pubkeysConcat));
	const hashHex = bytesToHex(hash);
	return '00' + hashHex.slice(0, 14);
}

/**
 * merge proofs from same mint,
 * removes TokenEntrys with no proofs or no mint field
 * and sorts proofs by id
 *
 * @export
 * @param {Token} token
 * @return {*}  {Token}
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

export {
	bigIntStringify,
	bytesToNumber,
	getDecodedToken,
	getEncodedToken,
	hexToNumber,
	splitAmount,
	getDefaultAmountPreference
};
