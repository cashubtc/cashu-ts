import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { type RawProof, createRandomSecretKey, hashToCurve } from './core';
import { HDKey } from '@scure/bip32';
import { deriveKeysetId } from '../utils';

const DERIVATION_PATH = "m/0'/0'/0'";

export type RawMintKeys = { [k: string]: Uint8Array };

export type SerializedMintKeys = {
	[k: string]: string;
};

export type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
	? Acc[number]
	: Enumerate<N, [...Acc, Acc['length']]>;

export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

export type KeysetPair = {
	keysetId: string;
	pubKeys: RawMintKeys;
	privKeys: RawMintKeys;
};

export function serializeMintKeys(mintKeys: RawMintKeys): SerializedMintKeys {
	const serializedMintKeys: SerializedMintKeys = {};
	Object.keys(mintKeys).forEach((p) => {
		serializedMintKeys[p] = bytesToHex(mintKeys[p]);
	});
	return serializedMintKeys;
}

export function deserializeMintKeys(serializedMintKeys: SerializedMintKeys): RawMintKeys {
	const mintKeys: RawMintKeys = {};
	Object.keys(serializedMintKeys).forEach((p) => {
		mintKeys[p] = hexToBytes(serializedMintKeys[p]);
	});
	return mintKeys;
}

export function getPubKeyFromPrivKey(privKey: Uint8Array) {
	return secp256k1.getPublicKey(privKey, true);
}

/**
 * Creates new mint keys.
 *
 * @param pow2height Number of powers of 2 to create (Max 65).
 * @param seed (Optional). Seed for key derivation.
 * @param options.expiry (optional) expiry of the keyset.
 * @param options.input_fee_ppk (optional) Input fee for keyset (in ppk)
 * @param options.unit (optional) the unit of the keyset. Default: sat.
 * @param options.versionByte (optional) version of the keyset ID. Default: 1.
 * @returns KeysetPair object.
 * @throws If keyset versionByte is not valid.
 */
export function createNewMintKeys(
	pow2height: IntRange<0, 65>,
	seed?: Uint8Array,
	options?: {
		expiry?: number;
		input_fee_ppk?: number;
		unit?: string;
		versionByte: number;
	},
): KeysetPair {
	const { expiry, input_fee_ppk, unit = 'sat', versionByte = 1 } = options || {};
	let counter = 0n;
	const pubKeys: RawMintKeys = {};
	const privKeys: RawMintKeys = {};
	let masterKey;
	if (seed) {
		masterKey = HDKey.fromMasterSeed(seed);
	}
	while (counter < pow2height) {
		const index: string = (2n ** counter).toString();
		if (masterKey) {
			const k = masterKey.derive(`${DERIVATION_PATH}/${counter}`).privateKey;
			if (k) {
				privKeys[index] = k;
			} else {
				throw new Error(`Could not derive Private key from: ${DERIVATION_PATH}/${counter}`);
			}
		} else {
			privKeys[index] = createRandomSecretKey();
		}

		pubKeys[index] = getPubKeyFromPrivKey(privKeys[index]);
		counter++;
	}
	const keysetId = deriveKeysetId(serializeMintKeys(pubKeys), {
		expiry,
		input_fee_ppk,
		unit,
		versionByte,
	});
	return { pubKeys, privKeys, keysetId };
}

export function verifyProof(proof: RawProof, privKey: Uint8Array): boolean {
	const Y: WeierstrassPoint<bigint> = hashToCurve(proof.secret);
	const a = secp256k1.Point.Fn.fromBytes(privKey);
	const aY: WeierstrassPoint<bigint> = Y.multiply(a);
	return aY.equals(proof.C);
}
