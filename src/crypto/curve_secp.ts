import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes, bytesToHex } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import type { BlindSignature, RawBlindedMessage, UnblindedSignature } from './core';

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
  throw new CTSError('No valid point found');
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

// Decompression-validated keys; callers typically share keys, so repeat parses are common. Naive
// clear-on-full, swap for LRU if churn ever matters.
const VALIDATED_PUBKEYS = new Set<string>();

/**
 * Validates a compressed secp256k1 pubkey and returns it lowercased (canonical form).
 *
 * @remarks
 * Strict: 66-char 02/03 hex that decompresses to a curve point; x-only is rejected. Throwing
 * companion to {@link isValidSecpPubkey}.
 * @throws {@link CTSError} If not 66-char 02/03 hex, or not a valid secp256k1 point.
 */
export function normalizeSecpPubkey(pk: string): string {
  // Check type, length, and prefix before lowercasing: a non-string or oversized input is rejected
  // as a CTSError (per this function's contract), not a raw TypeError, and without a full copy/scan.
  if (typeof pk !== 'string' || pk.length !== 66 || !(pk.startsWith('02') || pk.startsWith('03'))) {
    const got = typeof pk === 'string' ? `length ${pk.length}` : typeof pk;
    throw new CTSError(
      `Invalid pubkey: expected 33-byte compressed hex (66 chars); for an x-only (nostr) key, prepend '02', got ${got}`,
    );
  }
  const hex = pk.toLowerCase();
  if (!VALIDATED_PUBKEYS.has(hex)) {
    try {
      pointFromHex(hex);
    } catch (e) {
      throw new CTSError('Invalid pubkey: not a valid secp256k1 point', { cause: e });
    }
    if (VALIDATED_PUBKEYS.size >= 1024) VALIDATED_PUBKEYS.clear();
    VALIDATED_PUBKEYS.add(hex);
  }
  return hex;
}

/**
 * True if `pk` is a valid compressed secp256k1 pubkey. Non-throwing companion to
 * {@link normalizeSecpPubkey}.
 */
export function isValidSecpPubkey(pk: string): boolean {
  try {
    normalizeSecpPubkey(pk);
    return true;
  } catch {
    return false;
  }
}

export function getPubKeyFromPrivKey(privKey: Uint8Array): Uint8Array<ArrayBufferLike> {
  return secp256k1.getPublicKey(privKey, true);
}

export function createRandomSecretKey(): Uint8Array<ArrayBufferLike> {
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
    throw new CTSError('Blinding factor r must be non-zero');
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
