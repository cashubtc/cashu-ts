import { bytesToHex } from '@noble/curves/abstract/utils';
import { randomBytes } from '@noble/hashes/utils';
import { type Secret } from '../common/index';
import { BLAKE2s } from '@noble/hashes/blake2';

/**
 * Order of the prime field.
 */
const P = (1n << 251n) + 17n * (1n << 192n) + 1n;

/**
 * Minimal implementation of a Felt252 type, no operations supported.
 *
 * @link https://www.starknet.io/cairo-book/ch02-02-data-types.html#felt-type
 */
class Felt252 {
	private constructor(private readonly v: bigint) {}

	static fromHex(word: string): Felt252 {
		// handling -0x.. case
		let neg = word.startsWith('-');
		if (neg) word = word.slice(1);

		let n = BigInt(word);
		if (neg) n = -n;

		const x = ((n % P) + P) % P;
		return new Felt252(x);
	}

	// 32-byte little-endian
	toBytesLE(len = 32): Uint8Array {
		const out = new Uint8Array(len);
		let x = this.v;
		for (let i = 0; i < len; i++) {
			out[i] = Number(x & 0xffn);
			x >>= 8n;
		}
		return out;
	}
}

/**
 * @param programHash - The BLAKE2s hash of the Cairo program's bytecode.
 * @returns A JSON string representing the Cairo secret.
 */
export const createCairoSecret = (programHash: string): string => {
	const newSecret: Secret = [
		'Cairo',
		{
			nonce: bytesToHex(randomBytes(32)),
			data: programHash,
		},
	];
	return JSON.stringify(newSecret);
};

/**
 * Computing the BLAKE2s hash of executable bytecode.
 *
 * @param executableBytecode - An array of strings, each representing a 32-bytes value in
 *   hexadecimal format. Allowing for negative values encoded as '-0x...'.
 * @returns The 32-byte BLAKE2s hash of the input bytecode.
 */
export const hashExecutableBytecode = (executableBytecode: string[]): Uint8Array => {
	const WORD_LEN = 32; // bytes per felt
	const bytes = new Uint8Array(executableBytecode.length * WORD_LEN);

	executableBytecode.forEach((hex, i) => {
		const le = Felt252.fromHex(hex).toBytesLE(WORD_LEN);
		bytes.set(le, i * WORD_LEN);
	});

	return hashByteArray(bytes);
};

/**
 * Computes the BLAKE2s hash of the provided bytes.
 *
 * @param a - The input byte array to hash.
 * @returns The 32-byte BLAKE2s hash of the input.
 */
export const hashByteArray = (a: Uint8Array): Uint8Array => {
	let hasher = new BLAKE2s();
	a.forEach((byte) => hasher.update(new Uint8Array([byte])));
	return hasher.digest();
};