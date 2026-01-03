import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getKeysetIdInt } from './core';
import { HDKey } from '@scure/bip32';
import { Bytes, isBase64String } from '../utils';

const STANDARD_DERIVATION_PATH = `m/129372'/0'`;

const SECP256K1_N = BigInt(
	'0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

enum DerivationType {
	SECRET = 0,
	BLINDING_FACTOR = 1,
}

export const deriveSecret = (seed: Uint8Array, keysetId: string, counter: number): Uint8Array => {
	const isValidHex = /^[a-fA-F0-9]+$/.test(keysetId);
	if (!isValidHex && isBase64String(keysetId)) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.SECRET);
	}

	if (isValidHex && keysetId.startsWith('00')) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.SECRET);
	} else if (isValidHex && keysetId.startsWith('01')) {
		return derive(seed, keysetId, counter, DerivationType.SECRET);
	}
	throw new Error(`Unrecognized keyset ID version ${keysetId.slice(0, 2)}`);
};

export const deriveBlindingFactor = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
): Uint8Array => {
	const isValidHex = /^[a-fA-F0-9]+$/.test(keysetId);
	if (!isValidHex && isBase64String(keysetId)) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
	}

	if (isValidHex && keysetId.startsWith('00')) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
	} else if (isValidHex && keysetId.startsWith('01')) {
		return derive(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
	}
	throw new Error(`Unrecognized keyset ID version ${keysetId.slice(0, 2)}`);
};

const derive = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
	secretOrBlinding: DerivationType,
): Uint8Array => {
	let message = Bytes.concat(
		Bytes.fromString('Cashu_KDF_HMAC_SHA256'),
		Bytes.fromHex(keysetId),
		Bytes.writeBigUint64BE(BigInt(counter)),
	);

	switch (secretOrBlinding) {
		case DerivationType.SECRET:
			message = Bytes.concat(message, Bytes.fromHex('00'));
			break;
		case DerivationType.BLINDING_FACTOR:
			message = Bytes.concat(message, Bytes.fromHex('01'));
	}

	const hmacDigest = hmac(sha256, seed, message);

	if (secretOrBlinding === DerivationType.BLINDING_FACTOR) {
		const x = Bytes.toBigInt(hmacDigest);
		// Optimization: single subtraction instead of modulo
		// Probability of HMAC >= SECP256K1_N is ~2^-128
		if (x >= SECP256K1_N) {
			return Bytes.fromBigInt(x - SECP256K1_N);
		}
		if (x === 0n) {
			throw new Error('Derived invalid blinding scalar r == 0');
		}
		return hmacDigest;
	}

	return hmacDigest;
};

const derive_deprecated = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
	secretOrBlinding: DerivationType,
): Uint8Array => {
	const hdkey = HDKey.fromMasterSeed(seed);
	const keysetIdInt = getKeysetIdInt(keysetId);
	const derivationPath = `${STANDARD_DERIVATION_PATH}/${keysetIdInt}'/${counter}'/${secretOrBlinding}`;
	const derived = hdkey.derive(derivationPath);
	if (derived.privateKey === null) {
		throw new Error('Could not derive private key');
	}
	return derived.privateKey;
};
