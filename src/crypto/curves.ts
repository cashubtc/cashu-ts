import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { CTSError } from '../model/Errors';
import { Bytes, encodeBase64toUint8, hexToNumber, isValidHex } from '../utils';

import { type G1Point, pointFromHexG1 } from './curve_bls';

/**
 * Tagged-union point covering both keyset curves on the wallet output / proof path.
 *
 * - `secp`: secp256k1 compressed point (33 bytes, 66 hex) — v0/v1/v2 keysets.
 * - `blsG1`: BLS12-381 G1 compressed point (48 bytes, 96 hex) — v3 keysets.
 */
export type CurvePoint =
  | { kind: 'secp'; pt: WeierstrassPoint<bigint> }
  | { kind: 'blsG1'; pt: G1Point };

export function asSecpPoint(pt: WeierstrassPoint<bigint>): CurvePoint {
  return { kind: 'secp', pt };
}

export function asBlsG1Point(pt: G1Point): CurvePoint {
  return { kind: 'blsG1', pt };
}

/**
 * Decode a compressed point hex string to a {@link CurvePoint}, picking the curve by length: 66 hex
 * chars → secp256k1, 96 hex chars → BLS12-381 G1.
 *
 * Lengths are disjoint across the supported curves (secp uncompressed is 130; G2 compressed is
 * 192), so there is no ambiguity.
 */
export function pointFromHexAuto(hex: string): CurvePoint {
  if (hex.length === 66) return { kind: 'secp', pt: secp256k1.Point.fromHex(hex) };
  if (hex.length === 96) return { kind: 'blsG1', pt: pointFromHexG1(hex) };
  throw new CTSError(`Cannot decode point: unexpected hex length ${hex.length}`);
}

export function pointToHex(p: CurvePoint): string {
  return p.pt.toHex(true);
}

/**
 * True if `keysetId` is a v3 BLS12-381 keyset id (modern hex, version byte 0x02).
 *
 * @remarks
 * Strict version gate: does not assume future keyset versions are BLS.
 */
export function isBlsKeyset(keysetId: string): boolean {
  if (keysetId.length !== 16 && keysetId.length !== 66) return false;
  if (!isValidHex(keysetId)) return false;
  return keysetId.startsWith('02');
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
