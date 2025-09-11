import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { type PrivKey, randomBytes, bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';

import { Bytes } from '../utils';
import { type P2PKWitness } from '../model/types';
import { getSignedOutput } from './NUT11';

export type BlindSignature = {
	C_: ProjPointType<bigint>;
	amount: number;
	id: string;
};

export type BlindedMessage = {
	B_: ProjPointType<bigint>;
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
	C: ProjPointType<bigint>;
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

export function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

export function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

export function encodeBase64toUint8(base64String: string): Uint8Array {
	return Bytes.fromBase64(base64String);
}

export function hashToCurve(secret: Uint8Array): ProjPointType<bigint> {
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

export function hash_e(pubkeys: Array<ProjPointType<bigint>>): Uint8Array {
	const hexStrings = pubkeys.map((p) => p.toHex(false));
	const e_ = hexStrings.join('');
	return sha256(new TextEncoder().encode(e_));
}

export function pointFromBytes(bytes: Uint8Array) {
	return secp256k1.ProjectivePoint.fromHex(bytesToHex(bytes));
}

export function pointFromHex(hex: string) {
	return secp256k1.ProjectivePoint.fromHex(hex);
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

export function createRandomPrivateKey() {
	return secp256k1.utils.randomPrivateKey();
}

export function createBlindSignature(
	B_: ProjPointType<bigint>,
	privateKey: Uint8Array,
	amount: number,
	id: string,
): BlindSignature {
	const C_: ProjPointType<bigint> = B_.multiply(bytesToNumber(privateKey));
	return { C_, amount, id };
}

export function createRandomBlindedMessage(privateKey?: PrivKey): BlindedMessage {
	return blindMessage(
		randomBytes(32),
		bytesToNumber(secp256k1.utils.randomPrivateKey()),
		privateKey,
	);
}

export function blindMessage(secret: Uint8Array, r?: bigint, privateKey?: PrivKey): BlindedMessage {
	const Y = hashToCurve(secret);
	if (!r) {
		r = bytesToNumber(secp256k1.utils.randomPrivateKey());
	}
	const rG = secp256k1.ProjectivePoint.BASE.multiply(r);
	const B_ = Y.add(rG);
	if (privateKey !== undefined) {
		return getSignedOutput({ B_, r, secret }, privateKey);
	}
	return { B_, r, secret };
}

export function unblindSignature(
	C_: ProjPointType<bigint>,
	r: bigint,
	A: ProjPointType<bigint>,
): ProjPointType<bigint> {
	const C = C_.subtract(A.multiply(r));
	return C;
}

export function constructProofFromPromise(
	promise: BlindSignature,
	r: bigint,
	secret: Uint8Array,
	key: ProjPointType<bigint>,
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
