import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { type PrivKey, randomBytes, bytesToHex, hexToBytes } from '@noble/curves/utils';

import { Bytes, bytesToNumber, hexToNumber, encodeBase64toUint8 } from '../utils';
import { type P2PKWitness } from '../model/types';
import { getSignedOutput } from './NUT11';

export type BlindSignature = {
	C_: WeierstrassPoint<bigint>;
	amount: number;
	id: string;
};

export type BlindedMessage = {
	B_: WeierstrassPoint<bigint>;
	r: bigint;
	secret: Uint8Array;
	witness?: P2PKWitness;
};

export type DLEQ = {
	s: Uint8Array; // signature
	e: Uint8Array; // challenge
	r?: bigint; // optional: blinding factor
};

export type RawProof = {
	C: WeierstrassPoint<bigint>;
	secret: Uint8Array;
	amount: number;
	id: string;
	witness?: P2PKWitness;
};

export type SerializedProof = {
	C: string;
	secret: string;
	amount: number;
	id: string;
	witness?: string;
};

const DOMAIN_SEPARATOR = hexToBytes('536563703235366b315f48617368546f43757276655f43617368755f');

export function hashToCurve(secret: Uint8Array): WeierstrassPoint<bigint> {
	const msgToHash = sha256(Bytes.concat(DOMAIN_SEPARATOR, secret));
	const counter = new Uint32Array(1);
	const maxIterations = 2 ** 16;
	for (let i = 0; i < maxIterations; i++) {
		const counterBytes = new Uint8Array(counter.buffer);
		const hash = sha256(Bytes.concat(msgToHash, counterBytes));
		try {
			return pointFromHex(bytesToHex(Bytes.concat(new Uint8Array([0x02]), hash)));
		} catch {
			counter[0]++;
		}
	}
	throw new Error('No valid point found');
}

export function hash_e(pubkeys: Array<WeierstrassPoint<bigint>>): Uint8Array {
	const hexStrings = pubkeys.map((p) => p.toHex(false));
	const e_ = hexStrings.join('');
	return sha256(new TextEncoder().encode(e_));
}

export function pointFromBytes(bytes: Uint8Array) {
	return secp256k1.Point.fromHex(bytesToHex(bytes));
}

export function pointFromHex(hex: string) {
	return secp256k1.Point.fromHex(hex);
}

export const getKeysetIdInt = (keysetId: string): bigint => {
	let keysetIdInt: bigint;
	if (/^[a-fA-F0-9]+$/.test(keysetId)) {
		keysetIdInt = hexToNumber(keysetId) % BigInt(2 ** 31 - 1);
	} else {
		//legacy keyset compatibility
		keysetIdInt = bytesToNumber(encodeBase64toUint8(keysetId)) % BigInt(2 ** 31 - 1);
	}
	return keysetIdInt;
};

export function createRandomSecretKey() {
	return secp256k1.utils.randomSecretKey();
}

export function createBlindSignature(
	B_: WeierstrassPoint<bigint>,
	privateKey: Uint8Array,
	amount: number,
	id: string,
): BlindSignature {
	const C_: WeierstrassPoint<bigint> = B_.multiply(bytesToNumber(privateKey));
	return { C_, amount, id };
}

export function createRandomBlindedMessage(privateKey?: PrivKey): BlindedMessage {
	return blindMessage(
		randomBytes(32),
		bytesToNumber(secp256k1.utils.randomSecretKey()),
		privateKey,
	);
}

export function blindMessage(secret: Uint8Array, r?: bigint, privateKey?: PrivKey): BlindedMessage {
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
): RawProof {
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

export const serializeProof = (proof: RawProof): SerializedProof => {
	return {
		amount: proof.amount,
		C: proof.C.toHex(true),
		id: proof.id,
		secret: new TextDecoder().decode(proof.secret),
		witness: JSON.stringify(proof.witness),
	};
};

export const deserializeProof = (proof: SerializedProof): RawProof => {
	return {
		amount: proof.amount,
		C: pointFromHex(proof.C),
		id: proof.id,
		secret: new TextEncoder().encode(proof.secret),
		witness: proof.witness ? (JSON.parse(proof.witness) as P2PKWitness) : undefined,
	};
};
