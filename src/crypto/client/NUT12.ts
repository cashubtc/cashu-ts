import { type DLEQ, hash_e, hashToCurve } from '../common/index';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumber } from '../util/utils';

function arraysEqual(arr1: Uint8Array, arr2: Uint8Array) {
	if (arr1.length !== arr2.length) return false;
	for (let i = 0; i < arr1.length; i++) {
		if (arr1[i] !== arr2[i]) return false;
	}
	return true;
}

export const verifyDLEQProof = (
	dleq: DLEQ,
	B_: WeierstrassPoint<bigint>,
	C_: WeierstrassPoint<bigint>,
	A: WeierstrassPoint<bigint>,
) => {
	const sG = secp256k1.Point.BASE.multiply(bytesToNumber(dleq.s));
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
	C: WeierstrassPoint<bigint>, // unblinded e-cash signature point
	A: WeierstrassPoint<bigint>, // mint public key point
) => {
	if (dleq.r === undefined) throw new Error('verifyDLEQProof_reblind: Undefined blinding factor');
	const Y = hashToCurve(secret);
	const C_ = C.add(A.multiply(dleq.r)); // Re-blind the e-cash signature
	const bG = secp256k1.Point.BASE.multiply(dleq.r);
	const B_ = Y.add(bG); // Re-blind the message
	return verifyDLEQProof(dleq, B_, C_, A);
};
