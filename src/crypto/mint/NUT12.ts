import { hash_e, createRandomPrivateKey, type DLEQ } from '../common/index';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bytesToHex, numberToBytesBE } from '@noble/curves/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumber, hexToNumber } from '../util/utils';

/**
 * !!! WARNING !!! Not recommended for production use, due to non-constant time operations See:
 * https://github.com/cashubtc/cashu-crypto-ts/pull/2 for more details See:
 * https://en.wikipedia.org/wiki/Timing_attack for information about timing attacks.
 */
export const createDLEQProof = (B_: WeierstrassPoint<bigint>, a: Uint8Array): DLEQ => {
	const r = bytesToHex(createRandomPrivateKey()); // r <- random
	const n_r = hexToNumber(r);
	const R_1 = secp256k1.Point.BASE.multiply(n_r); // R1 = rG
	const R_2 = B_.multiply(n_r); // R2 = rB_
	const C_ = B_.multiply(bytesToNumber(a)); // C_ = aB_
	const n_a = bytesToNumber(a);
	const A = secp256k1.Point.BASE.multiply(n_a); // A = aG
	const e = hash_e([R_1, R_2, A, C_]); // e = hash(R1, R2, A, C_)
	const n_e = bytesToNumber(e);
	// WARNING: NON-CONSTANT TIME OPERATIONS?
	const s = numberToBytesBE((n_r + n_e * n_a) % secp256k1.Point.CURVE().n, 32); // (r + ea) mod n
	return { s, e };
};
