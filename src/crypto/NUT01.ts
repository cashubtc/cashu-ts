import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { HDKey } from '@scure/bip32';

import { CTSError } from '../model/Errors';
import { deriveKeysetId } from '../utils';

import { type UnblindedSignature } from './core';
import {
  BLS_FR_ORDER,
  createRandomBlsSecretKey,
  getG2PubKeyFromPrivKey,
  hashToCurveBls,
} from './curve_bls';
import { createRandomSecretKey, getPubKeyFromPrivKey, hashToCurve } from './curve_secp';
import { isBlsKeyset } from './curves';

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
  // The IntRange type is erased at runtime; a plain-JS or JSON-derived caller can pass any number
  // (including Infinity), and each iteration does an EC multiply. Bound it before the loop.
  if (!Number.isInteger(pow2height) || pow2height < 0 || pow2height > 64) {
    throw new CTSError('createNewMintKeys: pow2height must be an integer in [0, 64]');
  }
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
      if (versionByte === 2) {
        for (let attempt = 0; attempt < 1 << 16; attempt++) {
          const path = `${DERIVATION_PATH}/${counter}'/${attempt}'`;
          const k = masterKey.derive(path).privateKey;
          if (!k) throw new CTSError(`Could not derive Private key from: ${path}`);
          const scalar = BigInt(`0x${bytesToHex(k)}`);
          /* v8 ignore next -- rejection sampling: seed-dependent, not deterministically testable */
          if (scalar === 0n || scalar >= BLS_FR_ORDER) continue;
          privKeys[index] = k;
          break;
        }
        /* v8 ignore next -- unreachable short of 2^16 consecutive rejections */
        if (!privKeys[index]) throw new CTSError(`Could not derive v3 private key for ${index}`);
      } else {
        // v1/v2 keep the original unhardened path for back-compat with existing fixtures.
        // TODO v5: Harden the v1/v2 path and update TEST_PRIV_KEY_PUBS.
        const path = `${DERIVATION_PATH}/${counter}`;
        const k = masterKey.derive(path).privateKey;
        if (!k) throw new CTSError(`Could not derive Private key from: ${path}`);
        privKeys[index] = k;
      }
    } else {
      privKeys[index] = versionByte === 2 ? createRandomBlsSecretKey() : createRandomSecretKey();
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
 * wallet-side pairing equivalent for v3 is {@link verifyUnblindedSignatureBls} in `./curve_bls`.
 */
export function verifyUnblindedSignature(proof: UnblindedSignature, privKey: Uint8Array): boolean {
  if (isBlsKeyset(proof.id)) {
    if (privKey.length !== 32) {
      throw new CTSError('Mint scalar must be 32 bytes in Fr*');
    }
    const a = BigInt(`0x${bytesToHex(privKey)}`);
    if (a === 0n || a >= BLS_FR_ORDER) {
      throw new CTSError('Mint scalar must be 32 bytes in Fr*');
    }
    const Y = hashToCurveBls(proof.secret);
    return Y.multiply(a).equals(proof.C);
  }
  const Y: WeierstrassPoint<bigint> = hashToCurve(proof.secret);
  const a = secp256k1.Point.Fn.fromBytes(privKey);
  const aY: WeierstrassPoint<bigint> = Y.multiply(a);
  return aY.equals(proof.C);
}
