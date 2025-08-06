import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { getKeysetIdInt } from '../common/index';
import { HDKey } from '@scure/bip32';
import { Buffer } from 'buffer';

const STANDARD_DERIVATION_PATH = `m/129372'/0'`;

enum DerivationType {
	SECRET = 0,
	BLINDING_FACTOR = 1,
}

export const deriveSecret = (seed: Uint8Array, keysetId: string, counter: number): Uint8Array => {
	if (keysetId.startsWith('00')) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.SECRET);
	} else if (keysetId.startsWith('01')) {
		return derive(seed, keysetId, counter, DerivationType.SECRET);
	}
	throw new Error(`Unrecognized keyset ID version ${keysetId.slice(0, 2)}`);
};

export const deriveBlindingFactor = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
): Uint8Array => {
	if (keysetId.startsWith('00')) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
	} else if (keysetId.startsWith('01')) {
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
	const counterBuffer = Buffer.alloc(8);
	counterBuffer.writeBigUInt64BE(BigInt(counter));
	let message = Buffer.concat([
		Buffer.from('Cashu_KDF_HMAC_SHA512'),
		Buffer.from(keysetId, 'hex'),
		counterBuffer,
	]);

	switch (secretOrBlinding) {
		case DerivationType.SECRET:
			message = Buffer.concat([message, Buffer.from([0])]);
			break;
		case DerivationType.BLINDING_FACTOR:
			message = Buffer.concat([message, Buffer.from([1])]);
	}

	// Step 2: Compute HMAC-SHA512
	const hmacDigest = hmac(sha512, seed, message);

	// Step 3: Derive secret or blinding factor
	return hmacDigest.slice(0, 32);
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
