import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';

import { failIf, type Logger } from '../logger';
import { CTSError } from '../model/Errors';
import { decodeBase64ToUint8Legacy, hexToNumber, isBase64String, isValidHex } from '../utils';

import { type G1Point, hashToCurveBls, pointFromHexG1 } from './curve_bls';
import { hashToCurve } from './curve_secp';

/**
 * Tagged-union point covering both keyset curves on the wallet output / proof path.
 *
 * - `secp`: secp256k1 compressed point (33 bytes, 66 hex) — v0/v1/v2 keysets.
 * - `blsG1`: BLS12-381 G1 compressed point (48 bytes, 96 hex) — v3 keysets.
 */
export type CurvePoint =
  { kind: 'secp'; pt: WeierstrassPoint<bigint> } | { kind: 'blsG1'; pt: G1Point };

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
 * Highest keyset id version byte this build can spend: 0x02, the v3 BLS keysets.
 *
 * @remarks
 * Keysets above this are refused before binding, loading keys, or computing `Y`. Bump it only with
 * the curve and derivation dispatch a new version needs.
 * @internal
 */
export const MAX_SUPPORTED_KEYSET_VERSION_BYTE = 0x02;

/**
 * Name a keyset id version byte the way the docs do.
 *
 * @remarks
 * Version bytes are zero-indexed and the names are not: byte 0x02 is a "v3" keyset, and a legacy
 * base64 id (byte -1) is v0.
 * @internal
 */
export const versionName = (versionByte: number): string => `v${versionByte + 1}`;

/**
 * Refuse unsupported keyset versions, including paths that do not load keys.
 *
 * @remarks
 * Takes the id rather than a `Keyset` so the curve dispatch below can use it: crypto cannot import
 * from wallet. The parse mirrors `Keyset.version`, which reads the same byte off a loaded keyset.
 * @internal
 */
export function assertSpendableVersion(keysetId: string, logger?: Logger): void {
  const version = isValidHex(keysetId) ? Number.parseInt(keysetId.slice(0, 2), 16) : -1;
  failIf(
    version > MAX_SUPPORTED_KEYSET_VERSION_BYTE,
    `Keyset '${keysetId}' is a ${versionName(version)} keyset; this build of cashu-ts supports ` +
      `up to ${versionName(MAX_SUPPORTED_KEYSET_VERSION_BYTE)}. Upgrade to use this keyset.`,
    logger,
    { keysetId, versionByte: version, supported: MAX_SUPPORTED_KEYSET_VERSION_BYTE },
  );
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

/**
 * `Y = hash_to_curve(secret)` as compressed hex, on the curve the keyset id selects.
 *
 * @remarks
 * The secret string is hashed as UTF-8, hex secrets included.
 */
export function hashToCurveHex(secret: string, keysetId: string): string {
  assertSpendableVersion(keysetId);
  const msg = new TextEncoder().encode(secret);
  return (isBlsKeyset(keysetId) ? hashToCurveBls(msg) : hashToCurve(msg)).toHex(true);
}

/**
 * Length of a legacy (pre-2024) base64 keyset id, which has no version byte.
 *
 * @internal
 */
export const LEGACY_KEYSET_ID_LENGTH = 12;

export const getKeysetIdInt = (keysetId: string): bigint => {
  let keysetIdInt: bigint;
  // Length and alphabet separate the two encodings, the same rule getDerivationKind applies.
  // Legacy ids travelled URL-safe in `GET /keys/{id}`; fold that spelling back to the standard one.
  const legacy = (id: string): bigint =>
    bytesToNumberBE(decodeBase64ToUint8Legacy(id.replace(/-/g, '+').replace(/_/g, '/'))) %
    BigInt(2 ** 31 - 1);
  if (keysetId.length === LEGACY_KEYSET_ID_LENGTH && isBase64String(keysetId)) {
    keysetIdInt = legacy(keysetId);
  } else if (isValidHex(keysetId)) {
    keysetIdInt = hexToNumber(keysetId) % BigInt(2 ** 31 - 1);
  } else if (isBase64String(keysetId)) {
    keysetIdInt = legacy(keysetId);
  } else {
    throw new CTSError('Invalid keyset id: neither hex nor base64');
  }
  return keysetIdInt;
};
