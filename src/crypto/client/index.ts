import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { bytesToNumber } from '../util/utils';
import {
	type BlindSignature,
	type Proof,
	type SerializedBlindedMessage,
	type SerializedProof,
	hashToCurve,
	pointFromHex,
	type Witness,
} from '../common/index.js';
import { getSignedOutput } from './NUT11';

export type BlindedMessage = {
	B_: WeierstrassPoint<bigint>;
	r: bigint;
	secret: Uint8Array;
	witness?: Witness;
};

export function createRandomBlindedMessage(privateKey?: Uint8Array): BlindedMessage {
	return blindMessage(
		randomBytes(32),
		bytesToNumber(secp256k1.utils.randomSecretKey()),
		privateKey,
	);
}

export function blindMessage(secret: Uint8Array, r?: bigint, privateKey?: Uint8Array): BlindedMessage {
	const Y = hashToCurve(secret);
	if (!r) {
		r = bytesToNumber(secp256k1.utils.randomSecretKey());
	}
	const rG = secp256k1.Point.BASE.multiply(r);
	const B_ = Y.add(rG);
	if (privateKey !== undefined) {
		return getSignedOutput({ B_, r, secret }, privateKey);
	}
	return { B_, r, secret };
}

export function unblindSignature(
	C_: WeierstrassPoint<bigint>,
	r: bigint,
	A: WeierstrassPoint<bigint>,
): WeierstrassPoint<bigint> {
	const C = C_.subtract(A.multiply(r));
	return C;
}

export function constructProofFromPromise(
	promise: BlindSignature,
	r: bigint,
	secret: Uint8Array,
	key: WeierstrassPoint<bigint>,
): Proof {
	const A = key;
	const C = unblindSignature(promise.C_, r, A);
	const proof = {
		id: promise.id,
		amount: promise.amount,
		secret,
		C,
	};
	return proof;
}

export const serializeProof = (proof: Proof): SerializedProof => {
	return {
		amount: proof.amount,
		C: proof.C.toHex(true),
		id: proof.id,
		secret: new TextDecoder().decode(proof.secret),
		witness: JSON.stringify(proof.witness),
	};
};

export const deserializeProof = (proof: SerializedProof): Proof => {
	return {
		amount: proof.amount,
		C: pointFromHex(proof.C),
		id: proof.id,
		secret: new TextEncoder().encode(proof.secret),
		witness: proof.witness ? (JSON.parse(proof.witness) as Witness) : undefined,
	};
};
export const serializeBlindedMessage = (
	bm: BlindedMessage,
	amount: number,
): SerializedBlindedMessage => {
	return {
		B_: bm.B_.toHex(true),
		amount: amount,
	};
};
