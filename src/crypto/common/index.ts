import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { bytesToNumber, encodeBase64toUint8, hexToNumber } from '../util/utils';
import { Bytes } from '../../utils/Bytes';

export type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
	? Acc[number]
	: Enumerate<N, [...Acc, Acc['length']]>;

export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

export type MintKeys = { [k: string]: Uint8Array };

export type SerializedMintKeys = {
	[k: string]: string;
};

export type Keyset = {
	id: string;
	unit: string;
	active: boolean;
};

export type BlindSignature = {
	C_: ProjPointType<bigint>;
	amount: number;
	id: string;
};

export type SerializedBlindSignature = {
	C_: string;
	amount: number;
	id: string;
};

export type DLEQ = {
	s: Uint8Array; // signature
	e: Uint8Array; // challenge
	r?: bigint; // optional: blinding factor
};

export type Proof = {
	C: ProjPointType<bigint>;
	secret: Uint8Array;
	amount: number;
	id: string;
	witness?: Witness;
};

export type SerializedProof = {
	C: string;
	secret: string;
	amount: number;
	id: string;
	witness?: string;
};

export type SerializedBlindedMessage = {
	B_: string;
	amount: number;
	witness?: string;
};

export type Secret = [WellKnownSecret, SecretData];

export type WellKnownSecret = 'P2PK';

export type SecretData = {
	nonce: string;
	data: string;
	tags?: string[][];
};

export type Witness = {
	signatures: string[];
};

export type Tags = {
	[k: string]: string;
};

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL';

const DOMAIN_SEPARATOR = hexToBytes('536563703235366b315f48617368546f43757276655f43617368755f');

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

export function serializeMintKeys(mintKeys: MintKeys): SerializedMintKeys {
	const serializedMintKeys: SerializedMintKeys = {};
	Object.keys(mintKeys).forEach((p) => {
		serializedMintKeys[p] = bytesToHex(mintKeys[p]);
	});
	return serializedMintKeys;
}

export function deserializeMintKeys(serializedMintKeys: SerializedMintKeys): MintKeys {
	const mintKeys: MintKeys = {};
	Object.keys(serializedMintKeys).forEach((p) => {
		mintKeys[p] = hexToBytes(serializedMintKeys[p]);
	});
	return mintKeys;
}
