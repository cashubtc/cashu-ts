import { utils } from '@noble/secp256k1';
import { encodeBase64ToJson, encodeJsonToBase64 } from './base64.js';
import { Proof } from './model/Proof.js';
import { Token } from './model/types/index.js';

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
 * to encode a v2Token, the mints can be passed as a parameter
 * @param proofs
 * @param mints without this, a v1Token will be encoded
 * @returns
 */
function getEncodedProofs(
	proofs: Array<Proof>,
	mints?: Array<{ url: string; ids: Array<string> }>
): string {
	const token = {
		proofs,
		mints: mints ?? []
	};
	return encodeJsonToBase64(token);
}

function getDecodedProofs(token: string): Token {
	const obj = encodeBase64ToJson<Token | Array<Proof>>(token);

	if (Array.isArray(obj)) {
		return { proofs: obj, mints: [] };
	}
	// check if v2
	return { proofs: obj.proofs, mints: obj?.mints ?? [] };
}
export {
	hexToNumber,
	splitAmount,
	bytesToNumber,
	bigIntStringify,
	getDecodedProofs,
	getEncodedProofs
};
