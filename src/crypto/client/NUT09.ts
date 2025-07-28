import * as crypto from 'crypto';
import { getKeysetIdInt } from '../common/index.js';
import { HDKey } from '@scure/bip32';

const STANDARD_DERIVATION_PATH = `m/129372'/0'`;

enum DerivationType {
	SECRET = 0,
	BLINDING_FACTOR = 1
}

export const deriveSecret = (seed: Uint8Array, keysetId: string, counter: number): Uint8Array => {
	return derive(seed, keysetId, counter, DerivationType.SECRET);
};

export const deriveBlindingFactor = (
	seed: Uint8Array,
	keysetId: string,
	counter: number
): Uint8Array => {
	return derive(seed, keysetId, counter, DerivationType.BLINDING_FACTOR);
};

const derive = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
	secretOrBlinding: DerivationType
): Uint8Array => {
	const message = Buffer.concat([
		Buffer.from('Cashu_KDF_HMAC_SHA512'),
		Buffer.from(keysetId, 'utf-8'),
		Buffer.from(counter.toString(), 'utf-8')
	]);

	// Step 2: Compute HMAC-SHA512
	const hmac = crypto.createHmac('sha512', seed);
	hmac.update(message);
	const hmacDigest: Uint8Array = hmac.digest();

	// Step 3: Derive secret and blinding factor
	const secret = hmacDigest.slice(0, 32); // First 32 bytes for secret
	const r = hmacDigest.slice(32); // Remaining bytes for blinding factor

	switch (secretOrBlinding) {
		case DerivationType.SECRET:
			return secret;
		case DerivationType.BLINDING_FACTOR:
			return r;
		default:
			throw new Error(`Unknown derivation type: ${secretOrBlinding}`);
	}
};

const derive_deprecated = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
	secretOrBlinding: DerivationType
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
