import { type DLEQ, hash_e, hashToCurve, createRandomPrivateKey } from './common/index';
import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { bytesToHex, numberToBytesBE } from '@noble/curves/abstract/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToNumber, hexToNumber } from './util/utils';

function arraysEqual(arr1: Uint8Array, arr2: Uint8Array) {
	if (arr1.length !== arr2.length) return false;
	for (let i = 0; i < arr1.length; i++) {
		if (arr1[i] !== arr2[i]) return false;
	}
	return true;
}

export const verifyDLEQProof = (
	dleq: DLEQ,
	B_: ProjPointType<bigint>,
	C_: ProjPointType<bigint>,
	A: ProjPointType<bigint>,
) => {
	const sG = secp256k1.ProjectivePoint.fromPrivateKey(bytesToHex(dleq.s));
	const eA = A.multiply(bytesToNumber(dleq.e));
	const sB_ = B_.multiply(bytesToNumber(dleq.s));
	const eC_ = C_.multiply(bytesToNumber(dleq.e));
	const R_1 = sG.subtract(eA); // R1 = sG - eA
	const R_2 = sB_.subtract(eC_); // R2 = sB' - eC'
	const hash = hash_e([R_1, R_2, A, C_]); // e == hash(R1, R2, A, C')
	return arraysEqual(hash, dleq.e);
};

export const verifyDLEQProof_reblind = (
	secret: Uint8Array, // secret
	dleq: DLEQ,
	C: ProjPointType<bigint>, // unblinded e-cash signature point
	A: ProjPointType<bigint>, // mint public key point
) => {
	if (dleq.r === undefined) throw new Error('verifyDLEQProof_reblind: Undefined blinding factor');
	const Y = hashToCurve(secret);
	const C_ = C.add(A.multiply(dleq.r)); // Re-blind the e-cash signature
	const bG = secp256k1.ProjectivePoint.fromPrivateKey(dleq.r);
	const B_ = Y.add(bG); // Re-blind the message
	return verifyDLEQProof(dleq, B_, C_, A);
};

/**
 * !!! WARNING !!! Not recommended for production use, due to non-constant time operations See:
 * https://github.com/cashubtc/cashu-crypto-ts/pull/2 for more details See:
 * https://en.wikipedia.org/wiki/Timing_attack for information about timing attacks.
 */
export const createDLEQProof = (B_: ProjPointType<bigint>, a: Uint8Array): DLEQ => {
	const r = bytesToHex(createRandomPrivateKey()); // r <- random
	const R_1 = secp256k1.ProjectivePoint.fromPrivateKey(r); // R1 = rG
	const R_2 = B_.multiply(hexToNumber(r)); // R2 = rB_
	const C_ = B_.multiply(bytesToNumber(a)); // C_ = aB_
	const A = secp256k1.ProjectivePoint.fromPrivateKey(bytesToHex(a)); // A = aG
	const e = hash_e([R_1, R_2, A, C_]); // e = hash(R1, R2, A, C_)
	const n_r = hexToNumber(r);
	const n_e = bytesToNumber(e);
	const n_a = bytesToNumber(a);
	// WARNING: NON-CONSTANT TIME OPERATIONS?
	const s = numberToBytesBE((n_r + n_e * n_a) % secp256k1.CURVE.n, 32); // (r + ea) mod n
	return { s, e };
};
