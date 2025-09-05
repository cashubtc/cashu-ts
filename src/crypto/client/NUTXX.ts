import { bytesToHex } from '@noble/curves/abstract/utils';
import { randomBytes } from '@noble/hashes/utils';
import { BLAKE2s } from '@noble/hashes/blake2';
import { type CairoWitness, type Proof } from '../../model/types/index';
import { type Secret } from '../common/index';
import { parseSecret } from '../common/NUT10';
import {
	init,
	execute as stwoExecute,
	prove as stwoProve,
	containsPedersenBuiltin,
} from 'stwo-cairo';

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
 * Helper function to create cairoSend object from executable and expected output.
 * 
 * @param cairoExecutable - JSON string representing the Cairo executable
 * @param cairoExpectedOutput - Expected output as a number or bigint
 * @returns Object with programHash and outputHash for use in wallet.send
 */
export const createCairoDataPayload = (
	cairoExecutable: string,
	cairoExpectedOutput: number | bigint
): { programHash: string; outputHash: string } => {
	const executable = JSON.parse(cairoExecutable);
	const bytecode = executable.program.bytecode;
	const programHash = bytesToHex(hashExecutableBytecode(bytecode));
	const outputBigInt = BigInt(cairoExpectedOutput);
	const outputBytes = new Uint8Array(32);
	let temp = outputBigInt;

	for (let i = 0; i < 32; i++) {
		outputBytes[i] = Number(temp & 0xffn);
		temp >>= 8n;
	}
	const outputHash = bytesToHex(hashByteArray(outputBytes));
	
	return { programHash, outputHash };
};

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

/**
 * @param proofs
 * @param executable
 * @param programInputs
 */
export const cairoProveProofs = async (
	proofs: Proof[],
	executable: string,
	programInputs: bigint[],
): Promise<Proof[]> => {
	init();
	let time = Date.now();
	console.log('Executing cairo program...');
	const proverInput = await stwoExecute(executable, ...programInputs);
	console.log('Execution complete in', Date.now() - time, 'ms');
	const withPedersen = containsPedersenBuiltin(proverInput);
	time = Date.now();
	console.log('Proving cairo execution...');
	const cairoProof = await stwoProve(proverInput);
	console.log('Proving complete in', Date.now() - time, 'ms');

	proofs.forEach((p) => {
		try {
			console.log('adding cairo witness to proof with amount:', p.amount);
			const secret = parseSecret(p.secret);
			if (secret[0] !== 'Cairo') {
				throw new Error('not a Cairo secret');
			}
			const cairoWitness: CairoWitness = {
				cairo_proof_json: cairoProof,
				with_pedersen: withPedersen,
				with_bootloader: false,
			};
			p.witness = JSON.stringify(cairoWitness);
		} catch (e) {
			console.error('Failed to attach Cairo witness:', e);
			throw e;
		}
	});

	return proofs;
};
