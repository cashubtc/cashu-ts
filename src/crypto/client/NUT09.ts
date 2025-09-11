import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { getKeysetIdInt } from '../common';
import { HDKey } from '@scure/bip32';
import { Bytes } from '../../utils/Bytes';
import { isBase64String } from '../../base64';

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
	} else if (isBase64String(keysetId)) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.SECRET);
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
	} else if (isBase64String(keysetId)) {
		return derive_deprecated(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
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

	// Step 2: Compute HMAC-SHA256
	return hmac(sha256, seed, message);
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
