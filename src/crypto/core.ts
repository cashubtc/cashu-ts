import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/curves/utils.js';

/**
 * Private key type - can be hex string or Uint8Array.
 */
export type PrivKey = Uint8Array | string;
import { Bytes, bytesToNumber, hexToNumber, encodeBase64toUint8 } from '../utils';
import { type P2PKWitness } from '../model/types';

export type BlindSignature = {
	C_: WeierstrassPoint<bigint>;
	amount: number;
	id: string;
};

export type RawBlindedMessage = {
	B_: WeierstrassPoint<bigint>;
	r: bigint;
	secret: Uint8Array;
};

/**
 * @deprecated - Use RawBlindedMessage.
 */
export type BlindedMessage = RawBlindedMessage;

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

/**
 * @deprecated - Use createRandomRawBlindedMessage()
 */
export function createRandomBlindedMessage(_deprecated?: PrivKey): RawBlindedMessage {
	void _deprecated; // intentionally unused
	return createRandomRawBlindedMessage();
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
	if (!r) {
		r = bytesToNumber(createRandomSecretKey());
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

// ------------------------------
// Schnorr Signing / Verififcaton
// ------------------------------

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
	const msghash = sha256(new TextEncoder().encode(message));
	const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
	const sig = schnorr.sign(msghash, privKeyBytes); // auxRand is random by default
	return bytesToHex(sig);
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
		const msghash = sha256(new TextEncoder().encode(message));
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
