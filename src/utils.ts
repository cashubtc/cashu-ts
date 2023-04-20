import { utils } from '@noble/secp256k1';
import axios from 'axios';
import { encodeBase64ToJson, encodeJsonToBase64 } from './base64.js';
import { Proof } from './model/Proof.js';
import { Token, TokenV2 } from './model/types/index.js';
import { TOKEN_PREFIX, TOKEN_VERSION } from './utils/Constants.js';

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
function getEncodedToken(token: Token): string {
	return TOKEN_PREFIX + TOKEN_VERSION + encodeJsonToBase64(token);
}

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
export function checkResponseError(err: unknown) {
	if (axios.isAxiosError(err) && err?.response?.data) {
		if ('error' in err.response.data) {
			throw new Error(err.response.data.error);
		}
		if ('detail' in err.response.data) {
			throw new Error(err.response.data.detail);
		}
	}
}

function accumulateProofs(
	proofs: Proof[],
	requiredAmount: number,
	strategy: 'middle' | 'ascending' | 'descending'
) {
	const result: Proof[] = [];
	const temp = proofs.slice().sort((a, b) => a.amount - b.amount);
	let total = 0;
	switch (strategy) {
		case 'middle': {
			while (temp.length && total < requiredAmount) {
				const first = temp.shift();
				total += first!.amount;
				result.push(first!);
				if (total >= requiredAmount) {
					break;
				}
				const last = temp.pop();
				total += last!.amount;
				result.push(last!);
			}
			break;
		}
		case 'ascending': {
			for (let i = 0; i < temp.length; i++) {
				total += temp[i].amount;
				result.push(temp[i]);
				if (total >= requiredAmount) {
					break;
				}
			}
			break;
		}
		case 'descending': {
      for (let i = 0; i < temp.length; i++) {
        total += temp[temp.length - (1 + i)].amount;
        result.push(temp[temp.length - (1 + i)]);
        if (total >= requiredAmount) {
          break;
        }
      }
    }
	}
	return {
		base: result.slice(0, -1),
		exceeds: result[result.length - 1],
		excess: total - requiredAmount
	};
}

export {
	hexToNumber,
	splitAmount,
	bytesToNumber,
	bigIntStringify,
	getDecodedToken,
	getEncodedToken,
	accumulateProofs
};
