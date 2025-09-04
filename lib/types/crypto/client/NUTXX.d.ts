import { Proof } from '../../model/types/index';
/**
 * @param programHash - The BLAKE2s hash of the Cairo program's bytecode.
 * @returns A JSON string representing the Cairo secret.
 */
export declare const createCairoSecret: (programHash: string) => string;
/**
 * Computing the BLAKE2s hash of executable bytecode.
 *
 * @param executableBytecode - An array of strings, each representing a 32-bytes value in
 *   hexadecimal format. Allowing for negative values encoded as '-0x...'.
 * @returns The 32-byte BLAKE2s hash of the input bytecode.
 */
export declare const hashExecutableBytecode: (executableBytecode: string[]) => Uint8Array;
/**
 * Computes the BLAKE2s hash of the provided bytes.
 *
 * @param a - The input byte array to hash.
 * @returns The 32-byte BLAKE2s hash of the input.
 */
export declare const hashByteArray: (a: Uint8Array) => Uint8Array;
/**
 * @param proofs
 * @param executable
 * @param programInputs
 */
export declare const cairoProveProofs: (proofs: Proof[], executable: string, programInputs: bigint[]) => Promise<Proof[]>;
