import { bytesToHex, numberToBytesBE } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import { BLS_FR_ORDER } from './curve_bls';
import { getPubKeyFromPrivKey } from './curve_secp';
import { getKeysetIdInt, isBlsKeyset } from './curves';

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

type DerivedSecretAndBlindingFactor = { blindingFactor: Uint8Array; secret: Uint8Array };
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
 * The function supports deprecated hex keyset IDs with the `00` prefix and modern hex keyset IDs
 * with the `01` prefix. Legacy base64 keyset IDs throw (removed in v5).
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
): { blindingFactor: Uint8Array; secret: Uint8Array } {
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
  if (!isValidHex) {
    throw new CTSError(
      `Unsupported keyset ID '${keysetId}': legacy base64 keyset IDs were removed in v5`,
    );
  }
  if (keysetId.startsWith('00')) {
    return DerivationKind.DEPRECATED_BIP32;
  }
  // Strict version gate: does not assume future keyset versions are BLS.
  if (keysetId.startsWith('01') || keysetId.startsWith('02')) {
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
  const base = Bytes.concat(
    Bytes.fromString('Cashu_KDF_HMAC_SHA256'),
    Bytes.fromHex(keysetId),
    Bytes.writeBigUint64BE(BigInt(counter)),
  );
  return {
    secret: hmac(sha256, seed, Bytes.concat(base, Bytes.fromHex('00'))),
    blindingFactor: computeBlindingFactor(seed, base, keysetId),
  };
}

function computeBlindingFactor(seed: Uint8Array, base: Uint8Array, keysetId: string): Uint8Array {
  if (isBlsKeyset(keysetId)) {
    // V3 (BLS12-381): rejection sampling. Append u32_BE(attempt) to the HMAC input and accept the
    // first digest with 0 < x < BLS_FR_ORDER. Modular reduction would bias ~7.5% because
    // BLS_FR_ORDER ~ 0.45·2^256; rejection sampling yields a uniform sample over Fr*. Match the
    // NUT-00 batch-weight pattern. Loop cap is defensive; expected attempts ≈ 2.2.
    for (let attempt = 0; attempt < 1 << 16; attempt++) {
      const msg = Bytes.concat(base, Bytes.fromHex('01'), numberToBytesBE(attempt, 4));
      const digest = hmac(sha256, seed, msg);
      const x = Bytes.toBigInt(digest);
      if (x === 0n || x >= BLS_FR_ORDER) continue;
      return digest; // raw 32 bytes; x < 2^256 so the BE encoding matches the digest
    }
    /* c8 ignore next */
    throw new CTSError('V3 blinding factor derivation failed');
  }
  // V2 (secp256k1): single HMAC, single-subtraction modular reduction. SECP256K1_N is ~2^256 so
  // at most one subtraction is needed; bias is ~2^-128 (negligible).
  const digest = hmac(sha256, seed, Bytes.concat(base, Bytes.fromHex('01')));
  const x = Bytes.toBigInt(digest);
  const reduced = x >= SECP256K1_N ? x - SECP256K1_N : x;
  /* c8 ignore next */
  if (reduced === 0n) {
    throw new CTSError('Derived invalid blinding scalar r == 0');
  }
  return numberToBytesBE(reduced, 32);
}
