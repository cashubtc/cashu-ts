import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { hasLoneSurrogate } from '../utils/bytes';

/**
 * Private key type - can be hex string or Uint8Array.
 */
export type PrivKey = Uint8Array | string;
export type DigestInput = Uint8Array | string; // hex string or bytes
/**
 * A message already reduced to the 32-byte value BIP-340 signs (eg a tagged hash).
 */
export type PrehashedMessage = { digest: DigestInput };
export type MessageInput = string | PrehashedMessage; // UTF-8 string, or a prehashed digest
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
// Hashing
// ------------------------------

/**
 * SHA-256 over raw bytes.
 *
 * @remarks
 * For UTF-8 message strings, use `computeMessageDigest`.
 */
export function sha256(message: Uint8Array): Uint8Array {
  return nobleSha256(message);
}

/**
 * BIP340-style tagged hash: `SHA256(SHA256(tag) || SHA256(tag) || messages)`.
 */
export function taggedHash(tag: string, ...messages: Uint8Array[]): Uint8Array {
  const tagHash = sha256(utf8ToBytes(tag));
  return sha256(concatBytes(tagHash, tagHash, ...messages));
}

// ------------------------------
// Schnorr Signing / Verification
// ------------------------------

/**
 * Computes the SHA-256 hash of a message.
 *
 * @remarks
 * For raw byte messages, use `sha256`. A `PrehashedMessage` is returned as its digest, unchanged.
 * @param message To hash (UTF-8 encoded before hashing), or a prehashed digest.
 * @param asHex Optional: True returns a hex-encoded hash string; otherwise returns raw bytes.
 * @returns SHA-256 hash as raw bytes or hex string, depending on `asHex`.
 */
export function computeMessageDigest(message: MessageInput): Uint8Array;
export function computeMessageDigest(message: MessageInput, asHex: false): Uint8Array;
export function computeMessageDigest(message: MessageInput, asHex: true): string;
export function computeMessageDigest(message: MessageInput, asHex = false): string | Uint8Array {
  if (typeof message !== 'string') {
    const digest = typeof message.digest === 'string' ? hexToBytes(message.digest) : message.digest;
    return asHex ? bytesToHex(digest) : digest;
  }
  // Ill-formed UTF-16 would hash as its U+FFFD replacement, aliasing distinct messages.
  if (hasLoneSurrogate(message)) {
    throw new CTSError('Message must be well-formed UTF-16');
  }
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
 * Signs a message using Schnorr.
 *
 * @remarks
 * Signatures are non-deterministic because schnorr.sign() generates a new random auxiliary value
 * (auxRand) each time it is called.
 * @param message - The message to sign (UTF-8 string or prehashed digest).
 * @param privateKey - The private key to sign with (hex string or Uint8Array).
 * @returns The signature in hex format.
 */
export const schnorrSignMessage = (message: MessageInput, privateKey: PrivKey): string => {
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
 * @param message - The message to verify (UTF-8 string or prehashed digest).
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param throws - True: throws on error, False: swallows errors and returns false.
 * @returns True if the signature is valid, false otherwise.
 * @throws If throws param is true and error is encountered.
 */
export const schnorrVerifyMessage = (
  signature: string,
  message: MessageInput,
  pubkey: string,
  throws: boolean = false,
): boolean => {
  try {
    return schnorrVerifyDigest(signature, computeMessageDigest(message), pubkey, throws);
  } catch (e) {
    if (throws) {
      throw e;
    }
  }
  return false;
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
    return schnorr.verify(hexToBytes(signature), digestBytes, hexToBytes(toXOnlyPubkey(pubkey)));
  } catch (e) {
    if (throws) {
      throw e;
    }
  }
  return false; // default fail
};

/**
 * X-only identity of a P2PK pubkey: lowercased hex with any 02/03 parity prefix stripped.
 *
 * @remarks
 * Verification and signer dedupe must share this so they agree on key identity. Non-string and
 * non-02/03 prefixed 33-byte inputs pass through unchanged and fail verification downstream.
 */
function toXOnlyPubkey(pubkey: string): string {
  if (typeof pubkey !== 'string') return pubkey;
  const hex = pubkey.toLowerCase();
  return hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03')) ? hex.slice(2) : hex;
}

/**
 * Find the private key that can sign for a given compressed public key.
 *
 * @remarks
 * Matches on the x coordinate: a key imported from an x-only context (any nostr key) is published
 * as `02 || x` but its scalar derives the odd-y twin half the time. That twin is `n - d`, and it is
 * what gets returned, so the caller signs for the point the quote actually names.
 * @param pubkey Compressed SEC1 public key (33 bytes, hex-encoded) to match against.
 * @param privkeys One or more candidate private keys (hex-encoded).
 * @returns The private key hex string that signs for `pubkey`.
 * @throws If no candidate key derives to the expected pubkey.
 */
export function findSigningKey(pubkey: string, privkeys: string | string[]): string {
  const keys = Array.isArray(privkeys) ? privkeys : [privkeys];
  const wanted = pubkey.toLowerCase();
  for (const key of keys) {
    const derived = bytesToHex(secp256k1.getPublicKey(hexToBytes(key), true));
    if (derived === wanted) return key;
    if (derived.slice(2) === wanted.slice(2)) {
      const d = secp256k1.Point.Fn.fromBytes(hexToBytes(key));
      return bytesToHex(secp256k1.Point.Fn.toBytes(secp256k1.Point.Fn.neg(d)));
    }
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
 * @returns Array of public keys who validly signed, duplicates removed. The same key in different
 *   encodings (X-only, 02/03 prefix, letter case) counts once; the first occurrence is returned.
 */
export function getValidSigners(
  signatures: string[],
  message: MessageInput,
  pubkeys: string[],
): string[] {
  // Dedupe by x-only identity: BIP-340 ignores the parity prefix, so 02|X, 03|X
  // and X all verify against the same signature and must count as one signer.
  const uniquePubs = new Map<string, string>();
  for (const pubkey of pubkeys) {
    const xOnly = toXOnlyPubkey(pubkey);
    if (!uniquePubs.has(xOnly)) uniquePubs.set(xOnly, pubkey);
  }
  return Array.from(uniquePubs.values()).filter((pubkey) =>
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
  message: MessageInput,
  pubkeys: string[],
  threshold: number = 1,
): boolean => {
  const validSigners = getValidSigners(signatures, message, pubkeys);
  return validSigners.length >= threshold;
};
