import { utils } from '@noble/secp256k1';
import { encodeBase64ToJson, encodeJsonToBase64 } from './base64.js';
import { Proof } from './model/Proof.js';
import { Token, TokenV2 } from './model/types/index.js';

function splitAmount(value: number): Array<number> {
	const chunks: Array<number> = [];
	for (let i = 0; i < 32; i++) {
		const mask: number = 1 << i;
		if ((value & mask) !== 0) {
			chunks.push(Math.pow(2, i));
		}
	}
	return chunks;
}

function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(utils.bytesToHex(bytes));
}

function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

//used for json serialization
function bigIntStringify<T>(_key: unknown, value: T) {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * to encode a v3 token
 * @param proofs
 * @param mints
 * @returns
 */
function getEncodedProofs(proofs: Array<Proof>, mint: string, memo?: string): string {
	let token = {
		token: [mint, proofs]
	};

	//add memo if exist
	token = {
		...token,
		...(memo && { memo })
	};

	return encodeJsonToBase64(token);
}

function getDecodedProofs(token: string): Token {
	if (token.startsWith('cashu')) {
		return getDecodedV3Token(token);
	}
	return handleLegacyTokens(token);
}

function getDecodedV3Token(token: string): Token {
	const version = token.slice(5, 5);
	token = token.slice(6);
	return encodeBase64ToJson<Token>(token);
}

/**
 * deprecated
 * @param token
 * @returns
 */
function handleLegacyTokens(token: string): Token {
	const obj = encodeBase64ToJson<TokenV2 | Array<Proof>>(token);

	// check if v1
	if (Array.isArray(obj)) {
		return { token: [{ proofs: obj, mint: '' }] };
	}

	// if v2 token return v3 format
	return { token: [{ proofs: obj.proofs, mint: obj?.mints[0].url ?? '' }] };
}

export {
	hexToNumber,
	splitAmount,
	bytesToNumber,
	bigIntStringify,
	getDecodedProofs,
	getEncodedProofs
};
