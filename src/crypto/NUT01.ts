import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { HDKey } from '@scure/bip32';

import { CTSError } from '../model/Errors';
import { deriveKeysetId } from '../utils';

import { BLS_G2_GENERATOR, type G2Point, hashToCurveBls, pointFromHexG2 } from './bls';
import { type UnblindedSignature, createRandomSecretKey, hashToCurve, isBlsKeyset } from './core';

const DERIVATION_PATH = "m/0'/0'/0'";

export type RawMintKeys = { [k: string]: Uint8Array };

export type SerializedMintKeys = {
  [k: string]: string;
};

export type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc['length']]>;

export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

export type KeysetPair = {
  keysetId: string;
  pubKeys: RawMintKeys;
  privKeys: RawMintKeys;
};

export function serializeMintKeys(mintKeys: RawMintKeys): SerializedMintKeys {
  const serializedMintKeys: SerializedMintKeys = {};
  Object.keys(mintKeys).forEach((p) => {
    serializedMintKeys[p] = bytesToHex(mintKeys[p]);
  });
  return serializedMintKeys;
}

export function deserializeMintKeys(serializedMintKeys: SerializedMintKeys): RawMintKeys {
  const mintKeys: RawMintKeys = {};
  Object.keys(serializedMintKeys).forEach((p) => {
    mintKeys[p] = hexToBytes(serializedMintKeys[p]);
  });
  return mintKeys;
}

export function getPubKeyFromPrivKey(privKey: Uint8Array): Uint8Array<ArrayBufferLike> {
  return secp256k1.getPublicKey(privKey, true);
}

/**
 * V3 (BLS) mint pubkey: K2 = a · G2_gen, compressed to 96 bytes.
 *
 * The 32-byte private key is interpreted as a big-endian scalar and reduced mod the BLS Fr order
 * (same convention as the mint-side blind signer for v3).
 */
export function getG2PubKeyFromPrivKey(privKey: Uint8Array): Uint8Array<ArrayBufferLike> {
  const a = bls12_381.fields.Fr.fromBytes(privKey);
  if (a === 0n) {
    throw new CTSError('Mint scalar must be non-zero');
  }
  return BLS_G2_GENERATOR.multiply(a).toBytes(true);
}

/**
 * Creates new mint keys.
 *
 * @param pow2height Number of powers of 2 to create (Max 65).
 * @param seed (Optional). Seed for key derivation.
 * @param options.expiry (optional) expiry of the keyset.
 * @param options.input_fee_ppk (optional) Input fee for keyset (in ppk)
 * @param options.unit (optional) the unit of the keyset. Default: sat.
 * @param options.versionByte (optional) version of the keyset ID. Default: 1.
 * @returns KeysetPair object.
 * @throws If keyset versionByte is not valid.
 */
export function createNewMintKeys(
  pow2height: IntRange<0, 65>,
  seed?: Uint8Array,
  options?: {
    expiry?: number;
    input_fee_ppk?: number;
    unit?: string;
    versionByte?: number;
  },
): KeysetPair {
  const { expiry, input_fee_ppk, unit = 'sat', versionByte = 1 } = options || {};
  let counter = 0n;
  const pubKeys: RawMintKeys = {};
  const privKeys: RawMintKeys = {};
  let masterKey;
  if (seed) {
    masterKey = HDKey.fromMasterSeed(seed);
  }
  while (counter < pow2height) {
    const index: string = (2n ** counter).toString();
    if (masterKey) {
      const k = masterKey.derive(`${DERIVATION_PATH}/${counter}`).privateKey;
      if (k) {
        privKeys[index] = k;
      } else {
        throw new CTSError(`Could not derive Private key from: ${DERIVATION_PATH}/${counter}`);
      }
    } else {
      privKeys[index] = createRandomSecretKey();
    }

    pubKeys[index] =
      versionByte === 2
        ? getG2PubKeyFromPrivKey(privKeys[index])
        : getPubKeyFromPrivKey(privKeys[index]);
    counter++;
  }
  const keysetId = deriveKeysetId(serializeMintKeys(pubKeys), {
    expiry,
    input_fee_ppk,
    unit,
    versionByte,
  });
  return { pubKeys, privKeys, keysetId };
}

/**
 * Mint-side keyed verification: holds iff the proof's `C` equals `a · hashToCurve(secret)`.
 *
 * @remarks
 * Dispatches by keyset version. v0/v1/v2 keysets use secp256k1; v3 keysets use BLS12-381 G1. The
 * wallet-side pairing equivalent for v3 is {@link verifyUnblindedSignatureBls} in `./bls`.
 */
export function verifyUnblindedSignature(proof: UnblindedSignature, privKey: Uint8Array): boolean {
  if (isBlsKeyset(proof.id)) {
    const a = bls12_381.fields.Fr.fromBytes(privKey);
    if (a === 0n) {
      throw new CTSError('Mint scalar must be non-zero');
    }
    const Y = hashToCurveBls(proof.secret);
    return Y.multiply(a).equals(proof.C);
  }
  const Y: WeierstrassPoint<bigint> = hashToCurve(proof.secret);
  const a = secp256k1.Point.Fn.fromBytes(privKey);
  const aY: WeierstrassPoint<bigint> = Y.multiply(a);
  return aY.equals(proof.C);
}

/**
 * Tagged-union mint pubkey covering both keyset curves.
 *
 * - `secp`: compressed secp256k1 (33 bytes, 66 hex) — v0/v1/v2 keysets.
 * - `blsG2`: compressed BLS12-381 G2 (96 bytes, 192 hex) — v3 keysets.
 */
export type MintPubKey =
  | { kind: 'secp'; pt: WeierstrassPoint<bigint> }
  | { kind: 'blsG2'; pt: G2Point };

/**
 * Parse a mint pubkey hex string for a given keyset id. v3 (`02…`) keys are G2; others secp256k1.
 */
export function parseMintPubKey(keysetId: string, hex: string): MintPubKey {
  if (isBlsKeyset(keysetId)) {
    return { kind: 'blsG2', pt: pointFromHexG2(hex) };
  }
  return { kind: 'secp', pt: secp256k1.Point.fromHex(hex) };
}
