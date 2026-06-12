import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { CTSError } from '../model/Errors';

/**
 * Private key type - can be hex string or Uint8Array.
 */
export type PrivKey = Uint8Array | string;
export type DigestInput = Uint8Array | string; // hex string or bytes
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
  return schnorrVerifyDigest(signature, computeMessageDigest(message), pubkey, throws);
};

/**
 * Verifies a Schnorr signature on a message digest.
 *
 * @remarks
 * This function swallows Schnorr verification errors (eg invalid signature / pubkey format) and
 * treats them as false. If you want to throw such errors, use the throws param.
 * @param signature - The Schnorr signature (hex-encoded).
 * @param digest - The SHA-256 digest to verify (hex string or Uint8Array).
 * @param pubkey - The public key (hex-encoded, X-only or with 02/03 prefix).
 * @param throws - True: throws on error, False: swallows errors and returns false.
 * @returns True if the signature is valid, false otherwise.
 * @throws If throws param is true and error is encountered.
 */
export const schnorrVerifyDigest = (
  signature: string,
  digest: DigestInput,
  pubkey: string,
  throws: boolean = false,
): boolean => {
  try {
    const digestBytes = typeof digest === 'string' ? hexToBytes(digest) : digest;
    // Use X-only pubkey: strip 02/03 prefix if pubkey is 66 hex chars (33 bytes)
    const pubkeyX = pubkey.length === 66 ? pubkey.slice(2) : pubkey;
    return schnorr.verify(hexToBytes(signature), digestBytes, hexToBytes(pubkeyX));
  } catch (e) {
    if (throws) {
      throw e;
    }
  }
  return false; // default fail
};

/**
 * Find the private key that can sign for a given compressed public key.
 *
 * @param pubkey Compressed SEC1 public key (33 bytes, hex-encoded) to match against.
 * @param privkeys One or more candidate private keys (hex-encoded).
 * @returns The matching private key hex string.
 * @throws If no candidate key derives to the expected pubkey.
 */
export function findSigningKey(pubkey: string, privkeys: string | string[]): string {
  const keys = Array.isArray(privkeys) ? privkeys : [privkeys];
  for (const key of keys) {
    const derived = bytesToHex(secp256k1.getPublicKey(hexToBytes(key), true));
    if (derived.toLowerCase() === pubkey.toLowerCase()) return key;
  }
  throw new CTSError(`No private key matches quote pubkey ${pubkey}`);
}

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
