import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';

import { CTSError } from '../model/Errors';
import { isBase64String } from '../utils';

import { BLS_FR_ORDER } from './curve_bls';
import { getPubKeyFromPrivKey } from './curve_secp';
import { getKeysetIdInt, isBlsKeyset } from './curves';
import { NUTROOT_MAX_SLOTS } from './nutroot';

const STANDARD_DERIVATION_PATH = `m/129372'/0'`;

/**
 * Purpose of a deterministically-derived key, selecting the index in the BIP-32 path
 * `m/129373'/{index}'/0'/0'/{counter}`.
 *
 * - `P2PK`: NUT-11 P2PK signing key.
 * - `QuoteLock`: NUT-20 quote locking key.
 */
export type Bip32KeyPurpose = 'P2PK' | 'QuoteLock';

/**
 * Path purpose index per {@link Bip32KeyPurpose}.
 */
const PURPOSE_INDEX: Record<Bip32KeyPurpose, number> = {
  P2PK: 10,
  QuoteLock: 20,
};

const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

enum DerivationKind {
  DEPRECATED_BIP32,
  HMAC_SHA256,
}

export type DerivedSecretAndBlindingFactor = {
  blindingFactor: Uint8Array;
  secret: Uint8Array;
  /**
   * V3 (`02…`) keysets only: the internal private key `k` behind the pubkey secret `K = k*G`.
   */
  secretKey?: Uint8Array;
};
type SecretAndBlindingFactorDeriver = (counter: number) => DerivedSecretAndBlindingFactor;

/**
 * Derives the deterministic secret and blinding factor for one counter.
 *
 * @remarks
 * This is the preferred NUT-13 derivation API because deterministic output construction needs both
 * values for the same seed, keyset, and counter. For deprecated BIP-32 keysets, deriving both
 * values together is faster because it avoids repeating the shared path derivation common to the
 * secret and blinding factor.
 *
 * The function supports legacy base64 keyset IDs, deprecated hex keyset IDs with the `00` prefix,
 * and modern hex keyset IDs with the `01` prefix.
 * @param seed - Wallet seed used for deterministic derivation.
 * @param keysetId - Mint keyset ID that selects the derivation method.
 * @param counter - Deterministic counter for the output.
 * @returns The derived secret bytes and blinding factor bytes.
 * @throws {@link CTSError} If the keyset ID version is unsupported or if derivation produces an
 *   invalid private key.
 */
export function deriveSecretAndBlindingFactor(
  seed: Uint8Array,
  keysetId: string,
  counter: number,
): DerivedSecretAndBlindingFactor {
  const derive = createSecretAndBlindingFactorDeriver(seed, keysetId);
  return derive(counter);
}

/**
 * Derives the deterministic keypair for one counter under the BIP-32 path
 * `m/129373'/{purpose}'/0'/0'/{counter}` (the counter child is non-hardened).
 *
 * @remarks
 * Used for NUT-11 P2PK keys and NUT-20 quote locking keys. Both fields are hex: `pubkey` drops into
 * the lock/quote APIs and `privkey` into `signP2PKProofs`. To scan many counters from the same
 * seed, prefer {@link createKeyPairDeriver}, which caches the shared parent.
 *
 * The counter child is non-hardened so the parent xpub can derive counter pubkeys for watch-only
 * use. Consequently, never export the parent xpub alongside any counter's private key: with both,
 * the parent private key (and thus every counter's key) can be recovered.
 * @param seed - Wallet seed used for deterministic derivation.
 * @param purpose - Key purpose (`'P2PK'` or `'QuoteLock'`), which selects the path's purpose index.
 * @param counter - Non-hardened BIP-32 child index.
 * @returns The derived keypair, both hex-encoded: compressed (02/03) `pubkey` and `privkey`.
 * @throws {@link CTSError} If the counter is not a non-hardened index (integer below 2^31) or
 *   derivation produces an invalid private key.
 */
export function deriveKeyPair(
  seed: Uint8Array,
  purpose: Bip32KeyPurpose,
  counter: number,
): { pubkey: string; privkey: string } {
  const derive = createKeyPairDeriver(seed, purpose);
  return derive(counter);
}

/**
 * Creates a deterministic keypair deriver for a seed/purpose pair.
 *
 * @remarks
 * Caches the parent `m/129373'/{purpose}'/0'/0'` derivation once so each per-counter call is a
 * single non-hardened child derivation. This is ~5x faster than re-traversing the full path per
 * counter, so it is the path to use for restore loops scanning many counters. Each call returns a
 * ready-to-use hex keypair; for a single counter use {@link deriveKeyPair}.
 *
 * The counter child is non-hardened so the parent xpub can derive counter pubkeys for watch-only
 * use. Consequently, never export the parent xpub alongside any counter's private key: with both,
 * the parent private key (and thus every counter's key) can be recovered.
 * @param seed - Wallet seed used for deterministic derivation.
 * @param purpose - Key purpose, which selects the path's purpose index.
 * @returns A function mapping a non-hardened counter to its hex keypair.
 */
export function createKeyPairDeriver(
  seed: Uint8Array,
  purpose: Bip32KeyPurpose,
): (counter: number) => { pubkey: string; privkey: string } {
  const index = PURPOSE_INDEX[purpose];
  const parentKey = HDKey.fromMasterSeed(seed).derive(`m/129373'/${index}'/0'/0'`);
  return (counter: number) => {
    // deriveChild silently hardens indices >= 2^31, which xpub-only derivation cannot follow.
    if (!Number.isInteger(counter) || counter < 0 || counter >= 0x80000000) {
      throw new CTSError('Counter must be a non-hardened BIP-32 index (0 <= counter < 2^31)');
    }
    const secretKey = parentKey.deriveChild(counter).privateKey;
    /* c8 ignore next */
    if (secretKey === null) {
      throw new CTSError('Could not derive secret key');
    }
    return { pubkey: bytesToHex(getPubKeyFromPrivKey(secretKey)), privkey: bytesToHex(secretKey) };
  };
}

// ------------------------------
// Internal helpers
// ------------------------------

/**
 * Creates a deterministic deriver function for a seed/keyset pair.
 *
 * @remarks
 * For deprecated BIP-32 derivation this caches the shared keyset parent node once, so each counter
 * costs three child derivations instead of a full path walk from the master. Constructing an HDKey
 * node computes its public key, so fewer nodes means fewer EC multiplications.
 * @internal
 */
export function createSecretAndBlindingFactorDeriver(
  seed: Uint8Array,
  keysetId: string,
): SecretAndBlindingFactorDeriver {
  switch (getDerivationKind(keysetId)) {
    case DerivationKind.DEPRECATED_BIP32: {
      const keysetIdInt = getKeysetIdInt(keysetId);
      const parentKey = HDKey.fromMasterSeed(seed).derive(
        `${STANDARD_DERIVATION_PATH}/${keysetIdInt}'`,
      );
      return (counter: number) => deriveBip32SecretAndBlindingFactor(parentKey, counter);
    }
    case DerivationKind.HMAC_SHA256:
      return (counter: number) => deriveHmacSecretAndBlindingFactor(seed, keysetId, counter);
  }
}

function getDerivationKind(keysetId: string): DerivationKind {
  const isValidHex = /^[a-fA-F0-9]+$/.test(keysetId);
  const isHmacHexVersion = keysetId.startsWith('01') || keysetId.startsWith('02');
  if (isValidHex && isHmacHexVersion && keysetId.length % 2 !== 0) {
    throw new CTSError('Invalid hex string: odd length.');
  }
  if (!isValidHex && isBase64String(keysetId)) {
    return DerivationKind.DEPRECATED_BIP32;
  }
  if (isValidHex && keysetId.startsWith('00')) {
    return DerivationKind.DEPRECATED_BIP32;
  }
  // Strict version gate: does not assume future keyset versions are BLS.
  if (isValidHex && isHmacHexVersion) {
    return DerivationKind.HMAC_SHA256;
  }
  throw new CTSError(`Unrecognized keyset ID version ${keysetId.slice(0, 2)}`);
}

function deriveBip32SecretAndBlindingFactor(
  parentKey: HDKey,
  counter: number,
): DerivedSecretAndBlindingFactor {
  // HARDENED_OFFSET + counter must stay in the hardened range; a counter outside [0, 2^31) would
  // wrap to a different index and derive the wrong key rather than fail.
  if (!Number.isInteger(counter) || counter < 0 || counter >= 0x80000000) {
    throw new CTSError('Counter must be an integer in the range 0 <= counter < 2^31');
  }
  const baseKey = parentKey.deriveChild(HARDENED_OFFSET + counter);
  const secret = baseKey.deriveChild(0).privateKey;
  const blindingFactor = baseKey.deriveChild(1).privateKey;
  /* c8 ignore next */
  if (secret === null || blindingFactor === null) {
    throw new CTSError('Could not derive private key');
  }
  return { secret, blindingFactor };
}

function deriveHmacSecretAndBlindingFactor(
  seed: Uint8Array,
  keysetId: string,
  counter: number,
): DerivedSecretAndBlindingFactor {
  assertCounter(counter);
  if (isBlsKeyset(keysetId)) {
    const secretKey = deriveV3Scalar(seed, keysetId, counter, DERIVATION_TYPE.secretKey);
    return {
      secret: getPubKeyFromPrivKey(secretKey),
      secretKey,
      blindingFactor: deriveV3Scalar(
        seed,
        keysetId,
        counter,
        DERIVATION_TYPE.blindingFactor,
        undefined,
        BLS_FR_ORDER,
      ),
    };
  }
  // V2 stays byte-for-byte as deployed: reframing it would silently re-derive every existing
  // secret, and a wallet restoring from seed would find nothing rather than error.
  const base = v2BaseMessage(keysetId, counter);
  return {
    secret: hmac(sha256, seed, concatBytes(base, hexToBytes('00'))),
    blindingFactor: computeV2BlindingFactor(seed, base),
  };
}

/**
 * NUT-13 derivation types. `0x00`-`0x03` are components of one proof allocation and share the
 * keyset's proof counter; `0x04` has its own quote counter.
 */
export const DERIVATION_TYPE = {
  /**
   * Internal private key `k`; the secret is `K = k*G`.
   */
  secretKey: 0x00,
  /**
   * Blinding factor `r`.
   */
  blindingFactor: 0x01,
  /**
   * NUMS offset `u` for a script-only secret.
   */
  numsOffset: 0x02,
  /**
   * Self-owned leaf key at index `i`; the message carries `u32_BE(i)`.
   */
  leafKey: 0x03,
  /**
   * Mint quote lock key; counted on the quote counter, not the proof counter.
   */
  quoteLock: 0x04,
} as const;

function assertCounter(counter: number): void {
  // NUT-13 encodes the counter as u64, but cap at MAX_SAFE_INTEGER: past it
  // `counter + 1 === counter`, so a batch would derive one counter twice.
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new CTSError('Counter must be an integer in the range 0 <= counter <= 2^53 - 1');
  }
}

function v2BaseMessage(keysetId: string, counter: number): Uint8Array {
  return concatBytes(
    utf8ToBytes('Cashu_KDF_HMAC_SHA256'),
    hexToBytes(keysetId),
    // numberToBytesBE throws rather than wrapping, so an out-of-range counter can never
    // be silently encoded as a different one even if the guard above is ever moved.
    numberToBytesBE(counter, 8),
  );
}

/**
 * Derive one V3 scalar by rejection sampling (NUT-13 V3 message).
 *
 * @remarks
 * `DST || u32_BE(len(keyset_id)) || keyset_id || u64_BE(counter) || type || u32_BE(attempt) ||
 * suffix`. The keyset id is length-framed because it is the one variable-length field and a type
 * may append its own suffix; `attempt` sits ahead of the suffix because every type samples.
 * Rejection against `SECP256K1_N` is a ~2^-128 event, so the loop is on one pattern with the
 * blinding factor's `BLS_FR_ORDER` rather than a separate shape.
 *
 * An absent `keysetId` frames an empty field, which is what type `0x04` uses: a quote exists before
 * any keyset is chosen. The framing is what makes an empty field unambiguous.
 * @internal
 */
function deriveV3Scalar(
  seed: Uint8Array,
  keysetId: string | undefined,
  counter: number,
  type: number,
  suffix?: Uint8Array,
  order: bigint = SECP256K1_N,
): Uint8Array {
  assertCounter(counter);
  const keysetIdBytes = keysetId === undefined ? new Uint8Array(0) : hexToBytes(keysetId);
  const base = concatBytes(
    utf8ToBytes('Cashu_KDF_HMAC_SHA256'),
    numberToBytesBE(keysetIdBytes.length, 4),
    keysetIdBytes,
    numberToBytesBE(counter, 8),
    Uint8Array.of(type),
  );
  for (let attempt = 0; attempt < 1 << 16; attempt++) {
    const msg = concatBytes(base, numberToBytesBE(attempt, 4), suffix ?? new Uint8Array(0));
    const digest = hmac(sha256, seed, msg);
    const x = bytesToNumberBE(digest);
    if (x === 0n || x >= order) continue;
    return digest; // raw 32 bytes; x < order < 2^256 so the BE encoding matches the digest
  }
  /* c8 ignore next */
  throw new CTSError(`V3 derivation failed for type ${type}`);
}

function computeV2BlindingFactor(seed: Uint8Array, base: Uint8Array): Uint8Array {
  // V2 (secp256k1): single HMAC, single-subtraction modular reduction. SECP256K1_N is ~2^256 so
  // at most one subtraction is needed; bias is ~2^-128 (negligible).
  const digest = hmac(sha256, seed, concatBytes(base, hexToBytes('01')));
  const x = bytesToNumberBE(digest);
  const reduced = x >= SECP256K1_N ? x - SECP256K1_N : x;
  /* c8 ignore next */
  if (reduced === 0n) {
    throw new CTSError('Derived invalid blinding scalar r == 0');
  }
  return numberToBytesBE(reduced, 32);
}

/**
 * The NUMS offset `u` for a self-owned script-only secret (NUT-13 type `0x02`).
 *
 * @remarks
 * Shares the proof's counter with the secret key and blinding factor, so reusing a counter repeats
 * `B_` and the mint refuses it. `u` is disclosed in spend info regardless: deriving it rather than
 * randomising it buys uniqueness, not secrecy.
 */
export function deriveNumsOffset(seed: Uint8Array, keysetId: string, counter: number): Uint8Array {
  assertV3Keyset(keysetId, 'NUMS offset');
  return deriveV3Scalar(seed, keysetId, counter, DERIVATION_TYPE.numsOffset);
}

/**
 * A self-owned leaf key at index `i` (NUT-13 type `0x03`).
 *
 * @remarks
 * `i` has no canonical meaning and **must not** be read from a leaf's position: transmitted leaf
 * order is not committed. Recover by deriving candidates and matching the tree's keys by value
 * ({@link recoverV3LeafKeys}).
 */
export function deriveLeafKey(
  seed: Uint8Array,
  keysetId: string,
  counter: number,
  index: number,
): Uint8Array {
  assertV3Keyset(keysetId, 'Leaf key');
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new CTSError('Leaf key index must be an integer in [0, 2^32)');
  }
  return deriveV3Scalar(
    seed,
    keysetId,
    counter,
    DERIVATION_TYPE.leafKey,
    numberToBytesBE(index, 4),
  );
}

/**
 * A mint quote lock key (NUT-13 message type `0x04`, defined in NUT-20).
 *
 * @remarks
 * No keyset: a mint quote is requested before any keyset is chosen (the outputs of the later mint
 * request fix it), so binding the key to one would leave a wallet unable to sign for its own paid
 * quote after a rotation. The message frames an empty keyset id instead, and the counter is the
 * wallet's single quote counter, so the key is recoverable from the seed and the quote's pubkey
 * alone.
 *
 * Its own counter, never the proof counter: a quote may mint nothing, and a lock key may be handed
 * over for delegated minting, so it must never collide with a key that has to stay secret. Nothing
 * detects a reused quote counter the way a repeated `B_` detects a reused proof counter, so advance
 * it on every quote request.
 */
export function deriveQuoteLockKey(seed: Uint8Array, counter: number): Uint8Array {
  return deriveV3Scalar(seed, undefined, counter, DERIVATION_TYPE.quoteLock);
}

function assertV3Keyset(keysetId: string, what: string): void {
  if (!isBlsKeyset(keysetId)) {
    throw new CTSError(`${what} derivation is a v3 keyset operation`);
  }
}

/**
 * Recover a proof's own leaf keys (NUT-13 type `0x03`) by matching derived candidates by value.
 *
 * @remarks
 * Leaf order is not committed and `i` has no canonical meaning, so position tells you nothing:
 * derive `i = 0, 1, 2…` and match the tree's keys by value, as NUT-28 does for slots. The scan is
 * bounded by the 255-leaf-key slot cap, and stops early once every key is accounted for.
 * @param counter - The proof's counter, ie the one its secret key was derived at.
 * @param keysHex - The tree's leaf keys (33-byte compressed hex); foreign keys simply never match.
 * @returns A map of leaf key hex to its 32-byte private key; keys the wallet does not own are
 *   absent.
 */
export function recoverV3LeafKeys(
  seed: Uint8Array,
  keysetId: string,
  counter: number,
  keysHex: string[],
): Map<string, Uint8Array> {
  assertV3Keyset(keysetId, 'Leaf key');
  const wanted = new Set(keysHex.map((key) => key.toLowerCase()));
  const found = new Map<string, Uint8Array>();
  for (let index = 0; index < NUTROOT_MAX_SLOTS - 1 && found.size < wanted.size; index++) {
    const secretKey = deriveLeafKey(seed, keysetId, counter, index);
    const pubkey = bytesToHex(getPubKeyFromPrivKey(secretKey));
    if (wanted.has(pubkey)) found.set(pubkey, secretKey);
  }
  return found;
}

/**
 * Recover the internal private keys behind self-owned v3 point secrets by counter scan.
 *
 * @remarks
 * A self-owned plain v3 proof needs no stored spend info: `k` re-derives from the seed (type
 * `0x00`). Scans counters `[0, maxCounter)` and trial-matches each derived `K` against the wanted
 * secrets. Returns a map of secret hex to its 32-byte private key; unmatched secrets are absent.
 * @param seed - Wallet seed.
 * @param keysetId - V3 (`02…`) keyset id.
 * @param secretsHex - The 66-char hex secrets to resolve.
 * @param maxCounter - Exclusive scan bound; use the wallet's current counter for the keyset.
 */
export function recoverV3SecretKeys(
  seed: Uint8Array,
  keysetId: string,
  secretsHex: string[],
  maxCounter: number,
): Map<string, Uint8Array> {
  if (!isBlsKeyset(keysetId)) {
    throw new CTSError('Secret key recovery is a v3 keyset operation');
  }
  if (!Number.isInteger(maxCounter) || maxCounter < 0 || maxCounter > 1 << 20) {
    throw new CTSError('maxCounter must be an integer in [0, 2^20]');
  }
  const wanted = new Set(secretsHex);
  const found = new Map<string, Uint8Array>();
  for (let counter = 0; counter < maxCounter && found.size < wanted.size; counter++) {
    const { secret, secretKey } = deriveSecretAndBlindingFactor(seed, keysetId, counter);
    const secretHex = bytesToHex(secret);
    if (wanted.has(secretHex) && secretKey) {
      found.set(secretHex, secretKey);
    }
  }
  return found;
}
