import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/curves/utils.js';

/**
 * Private key type - can be hex string or Uint8Array.
 */
export type PrivKey = Uint8Array | string;
export type DigestInput = Uint8Array | string; // hex string or bytes
import { Bytes, hexToNumber, encodeBase64toUint8 } from '../utils';
export type BlindSignature = {
	C_: WeierstrassPoint<bigint>;
	id: string;
};

export type RawBlindedMessage = {
	B_: WeierstrassPoint<bigint>;
	r: bigint;
	secret: Uint8Array;
};

export type DLEQ = {
	s: Uint8Array; // signature
	e: Uint8Array; // challenge
	r?: bigint; // optional: blinding factor
};

export type UnblindedSignature = {
	C: WeierstrassPoint<bigint>;
	secret: Uint8Array;
	id: string;
};

const DOMAIN_SEPARATOR = utf8ToBytes('Secp256k1_HashToCurve_Cashu_');

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
		keysetIdInt = Bytes.toBigInt(encodeBase64toUint8(keysetId)) % BigInt(2 ** 31 - 1);
	}
	return keysetIdInt;
};

export function createRandomSecretKey() {
	return secp256k1.utils.randomSecretKey();
}

export function createBlindSignature(
	B_: WeierstrassPoint<bigint>,
	privateKey: Uint8Array,
	id: string,
): BlindSignature {
	const a = secp256k1.Point.Fn.fromBytes(privateKey);
	const C_: WeierstrassPoint<bigint> = B_.multiply(a);
	return { C_, id };
}

/**
 * Creates a random blinded message.
 *
 * @remarks
 * The secret is a UTF-8 encoded 64-character lowercase hex string, generated from 32 random bytes
 * as recommended by NUT-00.
 * @returns A RawBlindedMessage: {B_, r, secret}
 */
export function createRandomRawBlindedMessage(): RawBlindedMessage {
	const secretStr = bytesToHex(randomBytes(32)); // 64 char ASCII hex string
	const secretBytes = new TextEncoder().encode(secretStr); // UTF-8 of the hex
	return blindMessage(secretBytes);
}

/**
 * Blind a secret message.
 *
 * @param secret A UTF-8 byte encoded string.
 * @param r Optional. Deterministic blinding scalar to use (eg: for testing / seeded)
 * @returns A RawBlindedMessage: {B_, r, secret}
 */
export function blindMessage(secret: Uint8Array, r?: bigint): RawBlindedMessage {
	const Y = hashToCurve(secret);
	if (r === undefined) {
		r = secp256k1.Point.Fn.fromBytes(createRandomSecretKey());
	} else if (r === 0n) {
		throw new Error('Blinding factor r must be non-zero');
	}
	const rG = secp256k1.Point.BASE.multiply(r);
	const B_ = Y.add(rG);
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

export function constructUnblindedSignature(
	blindSig: BlindSignature,
	r: bigint,
	secret: Uint8Array,
	key: WeierstrassPoint<bigint>,
): UnblindedSignature {
	const C = unblindSignature(blindSig.C_, r, key);
	return { id: blindSig.id, secret, C };
}

// ------------------------------
// Schnorr Signing / Verification
// ------------------------------

/**
 * Computes the SHA-256 hash of a UTF-8 message string.
 *
 * @param message To hash (UTF-8 encoded before hashing).
 * @param asHex Optional: True returns a hex-encoded hash string; otherwise returns raw bytes.
 * @returns SHA-256 hash as raw bytes or hex string, depending on `asHex`.
 */
export function computeMessageDigest(message: string): Uint8Array;
export function computeMessageDigest(message: string, asHex: false): Uint8Array;
export function computeMessageDigest(message: string, asHex: true): string;
export function computeMessageDigest(message: string, asHex = false): string | Uint8Array {
	const hashBytes = sha256(new TextEncoder().encode(message));
	return asHex ? bytesToHex(hashBytes) : hashBytes;
}

/**
 * Signs a message digest using Schnorr.
 *
 * @remarks
 * Signatures are non-deterministic because schnorr.sign() generates a new random auxiliary value
 * (auxRand) each time it is called.
 * @param msghash The SHA-256 digest to sign (hex string or Uint8Array).
 * @param privateKey The private key to sign with (hex string or Uint8Array).
 * @returns The signature in hex format.
 */
export const schnorrSignDigest = (digest: DigestInput, privateKey: PrivKey): string => {
	const digestBytes = typeof digest === 'string' ? hexToBytes(digest) : digest;
	const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
	const sig = schnorr.sign(digestBytes, privKeyBytes);
	return bytesToHex(sig);
};

/**
 * Signs a message string using Schnorr.
 *
 * @remarks
 * Signatures are non-deterministic because schnorr.sign() generates a new random auxiliary value
 * (auxRand) each time it is called.
 * @param message - The message to sign.
 * @param privateKey - The private key to sign with (hex string or Uint8Array).
 * @returns The signature in hex format.
 */
export const schnorrSignMessage = (message: string, privateKey: PrivKey): string => {
	const msghash = computeMessageDigest(message);
	return schnorrSignDigest(msghash, privateKey);
};

/**
 * Verifies a Schnorr signature on a message.
 *
 * @remarks
 * This function swallows Schnorr verification errors (eg invalid signature / pubkey format) and
 * treats them as false. If you want to throw such errors, use the throws param.
 * @param signature - The Schnorr signature (hex-encoded).
 * @param message - The message to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param throws - True: throws on error, False: swallows errors and returns false.
 * @returns True if the signature is valid, false otherwise.
 * @throws If throws param is true and error is encountered.
 */
export const schnorrVerifyMessage = (
	signature: string,
	message: string,
	pubkey: string,
	throws: boolean = false,
): boolean => {
	try {
		const msghash = computeMessageDigest(message);
		// Use X-only pubkey: strip 02/03 prefix if pubkey is 66 hex chars (33 bytes)
		const pubkeyX = pubkey.length === 66 ? pubkey.slice(2) : pubkey;
		return schnorr.verify(hexToBytes(signature), msghash, hexToBytes(pubkeyX));
	} catch (e) {
		if (throws) {
			throw e;
		}
	}
	return false; // default fail
};

/**
 * Returns the set of unique public keys that have produced a valid Schnorr signature for a given
 * message.
 *
 * @param signatures - The Schnorr signature(s) (hex-encoded).
 * @param message - The message to verify.
 * @param pubkeys - The Cashu P2PK public key(s) (hex-encoded, X-only or with 02/03 prefix) to
 *   check.
 * @returns Array of public keys who validly signed, duplicates removed.
 */
export function getValidSigners(
	signatures: string[],
	message: string,
	pubkeys: string[],
): string[] {
	const uniquePubs = Array.from(new Set(pubkeys));
	return uniquePubs.filter((pubkey) =>
		signatures.some((sig) => schnorrVerifyMessage(sig, message, pubkey)),
	);
}

/**
 * Checks enough unique pubkeys have signed a message.
 *
 * @param signatures - The Schnorr signature(s) (hex-encoded).
 * @param message - The message to verify.
 * @param pubkeys - The Cashu P2PK public key(s) (hex-encoded, X-only or with 02/03 prefix) to
 *   check.
 * @param threshold - The minimum number of unique witnesses required.
 * @returns True if the witness threshold was reached, false otherwise.
 */
export const meetsSignerThreshold = (
	signatures: string[],
	message: string,
	pubkeys: string[],
	threshold: number = 1,
): boolean => {
	const validSigners = getValidSigners(signatures, message, pubkeys);
	return validSigners.length >= threshold;
};
