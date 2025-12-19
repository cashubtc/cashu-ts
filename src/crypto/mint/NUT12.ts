import { hash_e, createRandomPrivateKey, type DLEQ } from '../common/index';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

/**
 * !!! WARNING !!! Not recommended for production use, due to non-constant time operations See:
 * https://github.com/cashubtc/cashu-crypto-ts/pull/2 for more details See:
 * https://en.wikipedia.org/wiki/Timing_attack for information about timing attacks.
 */
export const createDLEQProof = (B_: WeierstrassPoint<bigint>, a: Uint8Array): DLEQ => {
	const r = secp256k1.Point.Fn.fromBytes(createRandomPrivateKey()); // r <- random (Uint8Array)
	const R_1 = secp256k1.Point.BASE.multiply(r); // R1 = rG
	const R_2 = B_.multiply(r); // R2 = rB_
	const scalar_a = secp256k1.Point.Fn.fromBytes(a);
	const C_ = B_.multiply(scalar_a); // C_ = aB_
	const A = secp256k1.Point.BASE.multiply(scalar_a); // A = aG
	const e = hash_e([R_1, R_2, A, C_]); // e = hash(R1, R2, A, C_)
	const scalar_e = secp256k1.Point.Fn.fromBytes(e);
	// Use field operations for constant-time addition and multiplication
	const s_scalar = secp256k1.Point.Fn.add(r, secp256k1.Point.Fn.mul(scalar_e, scalar_a));
	const s = numberToBytesBE(s_scalar, 32); // s = (r + e * a) mod n
	return { s, e };
};
