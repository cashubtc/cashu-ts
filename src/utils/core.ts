import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import {
  type DLEQ,
  type G1Point,
  type G2Point,
  assertV3PointSecret,
  batchVerifyUnblindedSignatureBls,
  isBlsKeyset,
  isV3PointSecret,
  pointFromHex,
  pointFromHexG1,
  pointFromHexG2,
  verifyDLEQProof_reblind,
  verifyUnblindedSignatureBls,
} from '../crypto';
import { hashToCurveBls } from '../crypto/curve_bls';
import { verifyHTLCHash } from '../crypto/NUT14';
import {
  countLeafSigners,
  parseNutrootLeafHex,
  verifyNutrootCommitment,
  verifyNutrootSpendInfo,
} from '../crypto/nutroot';
import {
  inputDigest,
  proofInputContainer,
  spendCommitment,
  verifyTransactionInputWitness,
} from '../crypto/transcript';
import { Amount, type AmountLike } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { PaymentRequest } from '../model/PaymentRequest';
import type {
  TokenMetadata,
  DeprecatedToken,
  Keys,
  Proof,
  ProofLike,
  Token,
  TokenV4Template,
  V4InnerToken,
  V4ProofTemplate,
  HasKeysetKeys,
} from '../model/types';
import type { SpendReceipt } from '../wallet/types/responses';

import {
  decodeBase64UrlToJson,
  decodeBase64UrlToUint8,
  encodeUint8ToBase64,
  encodeUint8ToBase64Url,
} from './base64';
import { minimalBytesBE } from './bytes';
import { decodeCBOR, encodeCBOR } from './cbor';
import { JSONInt } from './JSONInt';
import { MAX_PAYLOAD_DECODE_ATTEMPTS, MAX_PAYLOAD_LENGTH, MAX_SPLIT_OUTPUTS } from './limits';

/**
 * Splits the amount into denominations of the provided keyset.
 *
 * @remarks
 * Partial splits will be filled up to value using minimum splits required. Sorting is only applied
 * if a fill was made - exact custom splits are always returned in the same order.
 * @param value Amount to split.
 * @param keyset Keys to look up split amounts.
 * @param split? Optional custom split amounts.
 * @param order? Optional order for split amounts (if fill was required)
 * @returns Array of split amounts.
 * @throws Error if split sum is greater than value, the keyset lacks requested denominations, or
 *   the fill would exceed an internal output cap (coarse denominations over a large value).
 */
export function splitAmount(
  value: AmountLike,
  keyset: Keys,
  split?: AmountLike[],
  order?: 'desc' | 'asc',
): Amount[] {
  let remainingValue = toAmount(value, 'splitAmount.value', true);
  let normalizedSplit = split?.map((amt) => toAmount(amt, 'splitAmount.split', true));

  if (normalizedSplit) {
    const totalSplitAmount = Amount.sum(normalizedSplit);

    // Special case: explicit "zero-total" outputs (restore or NUT-08 blanks)
    if (remainingValue.isZero() && totalSplitAmount.isZero()) {
      return normalizedSplit;
    }

    // Normal positive-value paths: ignore zeros for validation and totals
    const positive = normalizedSplit.filter((amt) => !amt.isZero());
    const totalPositive = Amount.sum(positive);
    if (totalPositive.greaterThan(remainingValue)) {
      throw new CTSError(
        `Split is greater than total amount: ${totalPositive.toString()} > ${remainingValue.toString()}`,
      );
    }
    if (positive.some((amt) => !hasCorrespondingKey(amt, keyset))) {
      throw new CTSError(
        'Provided amount preferences do not match the amounts of the mint keyset.',
      );
    }

    // if caller supplied an exact custom split, preserve their order
    if (totalPositive.equals(remainingValue)) {
      return positive;
    }

    // Work only with validated positive amounts from here on
    normalizedSplit = positive;
    remainingValue = remainingValue.subtract(totalPositive);
  } else {
    normalizedSplit = [];
  }

  // Denomination fill for the remaining value
  const sortedKeyAmounts = getKeysetAmountsAsAmount(keyset, 'desc');
  if (sortedKeyAmounts.length === 0) {
    throw new CTSError('Cannot split amount, keyset is inactive or contains no keys');
  }
  for (const amtAsAmount of sortedKeyAmounts) {
    if (amtAsAmount.isZero()) continue;
    // Calculate how many of this denomination fit into the remaining value.
    // Guard requireCount: small keyset denom + large value could be millions of outputs.
    // Compare against remaining budget, so an oversized count never reaches toNumber().
    const requireCount = remainingValue.divideBy(amtAsAmount);
    const budget = MAX_SPLIT_OUTPUTS - normalizedSplit.length;
    if (budget <= 0 || requireCount.greaterThan(budget)) {
      throw new CTSError(`Cannot split amount: fill would exceed ${MAX_SPLIT_OUTPUTS} outputs`);
    }
    const count = requireCount.toNumber();
    for (let i = 0; i < count; i++) {
      normalizedSplit.push(amtAsAmount);
    }
    remainingValue = remainingValue.subtract(amtAsAmount.multiplyBy(requireCount));
    // Break early once target is satisfied
    if (remainingValue.isZero()) break;
  }
  if (!remainingValue.isZero()) {
    throw new CTSError(`Unable to split remaining amount: ${remainingValue.toString()}`);
  }

  // Only sort when we performed a fill and it was requested
  // Exact custom splits were returned unsorted earlier
  if (order) {
    normalizedSplit = normalizedSplit.sort((a, b) =>
      order === 'desc' ? b.compareTo(a) : a.compareTo(b),
    );
  }
  return normalizedSplit;
}

/**
 * Returns the amounts in the keyset sorted by the order specified.
 *
 * @param keyset To search in.
 * @param order Order to sort the amounts in.
 * @returns The amounts in the keyset sorted by the order specified.
 */
export function getKeysetAmounts(keyset: Keys, order: 'asc' | 'desc' = 'desc'): Amount[] {
  return getKeysetAmountsAsAmount(keyset, order);
}

function getKeysetAmountsAsAmount(keyset: Keys, order: 'asc' | 'desc'): Amount[] {
  const amounts = Object.keys(keyset).map((k: string) => Amount.from(k));
  amounts.sort((a, b) => (order === 'desc' ? b.compareTo(a) : a.compareTo(b)));
  return amounts;
}

/**
 * Checks if the provided amount is in the keyset.
 *
 * @param amount Amount to check.
 * @param keyset To search in.
 * @returns True if the amount is in the keyset, false otherwise.
 */
export function hasCorrespondingKey(amount: AmountLike, keyset: Keys): boolean {
  return toAmount(amount, 'hasCorrespondingKey.amount', true).toString() in keyset;
}

function toAmount(amount: AmountLike, op: string, allowZero = false): Amount {
  const parsed = Amount.from(amount);
  if (!allowZero && parsed.isZero()) {
    throw new CTSError(`Amount must be positive: ${parsed.toString()}, op: ${op}`);
  }
  return parsed;
}

/**
 * Converts a hex string to a bigint scalar. Returns `0n` for empty/falsy input.
 *
 * @internal
 */
export function hexToNumber(hex: string): bigint {
  return hex ? BigInt(`0x${hex}`) : 0n;
}

/**
 * Converts a bigint scalar to a zero-padded 64-character hex string (32 bytes).
 *
 * @internal
 */
export function numberToHexPadded64(scalar: bigint): string {
  return scalar.toString(16).padStart(64, '0');
}

/**
 * Returns `true` if the value is byte-decodable hex (a string, even length, hex chars only).
 *
 * @remarks
 * Accepts `unknown`: IDs reach here from decoded tokens and mint responses, so a non-string must
 * return `false`, not throw.
 * @internal
 */
export function isValidHex(str: unknown): str is string {
  return typeof str === 'string' && str.length % 2 === 0 && /^[a-f0-9]+$/i.test(str);
}

function hasNonHexId(p: Proof | Proof[]) {
  if (Array.isArray(p)) {
    return p.some((proof) => !isValidHex(proof.id));
  }
  return !isValidHex(p.id);
}

/**
 * `JSON.stringify` replacer that converts `bigint` values to strings.
 *
 * @internal
 */
export function bigIntStringify<T>(_key: unknown, value: T) {
  return typeof value === 'bigint' ? value.toString() : value;
}

/*
 * Convert a keyset ID into short form
 */
function convertToShortKeysetId(proofs: Proof[]) {
  return proofs.map((p) => {
    const newP = { ...p };
    newP.id = newP.id.slice(0, 16);
    return newP;
  });
}

/**
 * Encodes a {@link Token} as a cashu token string.
 */
export function getEncodedToken(token: Token, opts?: { removeDleq?: boolean }): string {
  // Normalize amounts for untyped (JS) callers who may pass JSON.parse'd tokens directly.
  const proofs = normalizeProofAmounts(token.proofs);
  if (hasNonHexId(proofs)) {
    throw new CTSError(
      'Proofs contain a legacy keyset ID and cannot be encoded. Swap them at the mint first.',
    );
  }
  return getEncodedTokenV4({ ...token, proofs }, opts?.removeDleq);
}

/**
 * Encodes a {@link Token} as a v4 CBOR cashu token string (`cashuB…`).
 *
 * @internal Use {@link getEncodedToken} instead.
 */
function getEncodedTokenV4(token: Token, removeDleq?: boolean): string {
  let proofs = token.proofs;
  if (removeDleq) {
    proofs = stripDleq(proofs);
  }
  // Make sure each DLEQ has its blinding factor
  proofs.forEach((p) => {
    if (p.dleq && p.dleq.r == undefined) {
      throw new CTSError('Missing blinding factor in included DLEQ proof');
    }
  });
  const nonHex = hasNonHexId(proofs);
  if (nonHex) {
    throw new CTSError('can not encode to v4 token if proofs contain non-hex keyset id');
  }
  // Map keyset IDs to short IDs
  proofs = convertToShortKeysetId(proofs);

  const tokenTemplate = templateFromToken({ ...token, proofs });

  const encodedData = encodeCBOR(tokenTemplate);
  const prefix = 'cashu';
  const version = 'B';
  const base64Data = encodeUint8ToBase64Url(encodedData);
  return prefix + version + base64Data;
}

/**
 * True when a token entry's witness is a v3 transaction witness, so it must not travel.
 *
 * @remarks
 * A v3 witness signs one transaction's digest, so it means nothing outside that transaction and a
 * token carries no transaction. Tokens drop it in both directions: emitting one hands the next
 * owner a witness that can never verify, and keeping one on receive leaves it in place of the
 * signature the new owner must produce, so their sweep is refused for a witness a stranger chose.
 *
 * Dispatch is on the keyset, not on the secret's shape. A pre-v3 secret is an arbitrary string and
 * may happen to look like a compressed point, and that proof's witness is a NUT-11 witness which
 * does travel. Which rules apply follows the keyset (NUT-10), the same rule the transcript uses.
 */
function isV3TransactionWitness(keysetId: string, secret: string): boolean {
  return isBlsKeyset(keysetId) && isV3PointSecret(secret);
}

function templateFromToken(token: Token): TokenV4Template {
  // Keyed by token-supplied IDs, so a plain object would resolve `__proto__` etc. to inherited members.
  const idMap = Object.create(null) as { [id: string]: Proof[] };
  const mint = token.mint;
  for (let i = 0; i < token.proofs.length; i++) {
    const proof = token.proofs[i];
    if (idMap[proof.id]) {
      idMap[proof.id].push(proof);
    } else {
      idMap[proof.id] = [proof];
    }
  }
  const tokenTemplate: TokenV4Template = {
    m: mint,
    u: token.unit || 'sat',
    t: Object.keys(idMap).map((id: string): V4InnerToken => ({
      i: hexToBytes(id),
      p: idMap[id].map((p: Proof): V4ProofTemplate => ({
        a: p.amount.toBigInt(),
        s: p.secret,
        c: hexToBytes(p.C),
        ...(p.dleq && {
          d: {
            e: hexToBytes(p.dleq.e),
            s: hexToBytes(p.dleq.s),
            r: hexToBytes(p.dleq.r ?? '00'),
          },
        }),
        ...(p.p2pk_e && {
          pe: hexToBytes(p.p2pk_e),
        }),
        ...(p.witness &&
          !isV3TransactionWitness(id, p.secret) && {
            w: JSON.stringify(p.witness),
          }),
        ...(p.spend_info && {
          si: {
            ...(p.spend_info.k && { k: hexToBytes(p.spend_info.k) }),
            ...(p.spend_info.E && { e: hexToBytes(p.spend_info.E) }),
            ...(p.spend_info.K && { i: hexToBytes(p.spend_info.K) }),
            ...(p.spend_info.u && { u: hexToBytes(p.spend_info.u) }),
            ...(p.spend_info.tree && { t: p.spend_info.tree.map(hexToBytes) }),
          },
        }),
      })),
    })),
  } as TokenV4Template;
  if (token.memo) {
    tokenTemplate.d = token.memo;
  }
  return tokenTemplate;
}

function tokenFromTemplate(template: TokenV4Template): Token {
  if (!template || !Array.isArray(template.t)) {
    throw new CTSError('Invalid token template');
  }
  const proofs: Proof[] = [];
  template.t.forEach((t) => {
    if (!t || !Array.isArray(t.p)) {
      throw new CTSError('Invalid token template');
    }
    t.p.forEach((p) => {
      proofs.push({
        secret: p.s,
        C: bytesToHex(p.c),
        amount: Amount.from(p.a),
        id: bytesToHex(t.i),
        ...(p.d && {
          dleq: {
            r: bytesToHex(p.d.r),
            s: bytesToHex(p.d.s),
            e: bytesToHex(p.d.e),
          },
        }),
        ...(p.pe && {
          p2pk_e: bytesToHex(p.pe),
        }),
        ...(p.w &&
          !isV3TransactionWitness(bytesToHex(t.i), p.s) && {
            witness: p.w,
          }),
        ...(p.si && {
          spend_info: {
            ...(p.si.k && { k: bytesToHex(p.si.k) }),
            ...(p.si.e && { E: bytesToHex(p.si.e) }),
            ...(p.si.i && { K: bytesToHex(p.si.i) }),
            ...(p.si.u && { u: bytesToHex(p.si.u) }),
            ...(p.si.t && { tree: p.si.t.map(bytesToHex) }),
          },
        }),
      });
    });
  });
  const decodedToken: Token = { mint: template.m, proofs, unit: template.u || 'sat' };
  if (template.d) {
    decodedToken.memo = template.d;
  }
  return decodedToken;
}

/**
 * Helper function to decode cashu tokens into an object.
 *
 * @param token An encoded cashu token (cashuB...)
 * @param keysets Array of full keyset ID strings, eg: from `KeyChain.getAllKeysetIds()`
 * @returns Cashu token object.
 */
export function getDecodedToken(tokenString: string, keysetIds: readonly string[]): Token {
  const tokenStr = removePrefix(tokenString);
  const token: Token = handleTokens(tokenStr);
  token.proofs = mapShortKeysetIds(token.proofs, keysetIds);
  return token;
}

/**
 * Returns the metadata of a cashu token.
 *
 * @param token An encoded cashu token (cashuB...)
 * @returns Token metadata.
 */
export function getTokenMetadata(token: string): TokenMetadata {
  token = removePrefix(token);
  const tokenObj = handleTokens(token);
  return {
    unit: tokenObj.unit || 'sat',
    mint: tokenObj.mint,
    amount: sumProofs(tokenObj.proofs),
    ...(tokenObj.memo && { memo: tokenObj.memo }),
    proofAmounts: tokenObj.proofs.map((p) => p.amount),
  };
}

/**
 * What {@link findCashuPayload} located: a cashu token, or a NUT-18 / NUT-26 payment request.
 */
export type CashuPayloadKind = 'token' | 'paymentRequest';

/**
 * One scanner per payload prefix: a literal prefix plus a single character class, so matching
 * cannot backtrack catastrophically, capped by {@link MAX_PAYLOAD_LENGTH}. Tokens and `creqA` use
 * base64url, the alphabet NUT-00 mandates for these payloads. The two characters that separate it
 * from standard base64 are delimiters in the places people paste tokens, `/` in URL paths and `+`
 * as a space in query strings, so stopping at them keeps an embedded payload findable instead of
 * swallowing its surroundings. `creqb1` (NUT-26) uses bech32m, matched case-insensitively because
 * QR alphanumeric mode uppercases it.
 */
const PAYLOAD_SCANNERS: ReadonlyArray<{ regExp: RegExp; kind: CashuPayloadKind }> = [
  { regExp: new RegExp(`cashu[AB][A-Za-z0-9=_-]{1,${MAX_PAYLOAD_LENGTH}}`, 'g'), kind: 'token' },
  {
    regExp: new RegExp(`creqA[A-Za-z0-9=_-]{1,${MAX_PAYLOAD_LENGTH}}`, 'g'),
    kind: 'paymentRequest',
  },
  {
    regExp: new RegExp(`creqb1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{1,${MAX_PAYLOAD_LENGTH}}`, 'gi'),
    kind: 'paymentRequest',
  },
];

/**
 * Finds the first token or payment request out of a block of text, wherever it sits. Covers v3 and
 * v4 tokens and both request encodings (`creqA` per NUT-18, `creqb1` / `CREQB1` per NUT-26).
 * Matches are found by prefix and then decoded to check them, so a prefix that is not really a
 * payload gets skipped. What it finds comes back as it appeared, except for bech32m requests, which
 * are lowercased to their canonical form. Feed it to {@link getDecodedToken} or
 * `PaymentRequest.fromEncodedRequest`.
 *
 * @example
 *
 *     findCashuPayload('paying you back cashuBo2Ft… thanks!');
 *     // { kind: 'token', payload: 'cashuBo2Ft…' }
 *
 * @returns The first valid payload by position or `null` if the text carries none, a valid payload
 *   sits beyond `MAX_PAYLOAD_DECODE_ATTEMPTS` failed candidates, or the only candidate is a
 *   multi-entry v3 token (unsupported).
 */
export function findCashuPayload(text: string): { kind: CashuPayloadKind; payload: string } | null {
  if (typeof text !== 'string') {
    throw new CTSError('text must be a string');
  }
  let searchFrom = 0;
  for (let attempts = 0; attempts < MAX_PAYLOAD_DECODE_ATTEMPTS; attempts++) {
    let earliestMatch: { index: number; text: string; kind: CashuPayloadKind } | null = null;
    for (const scanner of PAYLOAD_SCANNERS) {
      // Global regexes resume from lastIndex, so point each one at the current search position.
      scanner.regExp.lastIndex = searchFrom;
      const match = scanner.regExp.exec(text);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = {
          index: match.index,
          // A case-insensitive scanner emits canonical lowercase (bech32m case carries no data).
          text: scanner.regExp.flags.includes('i') ? match[0].toLowerCase() : match[0],
          kind: scanner.kind,
        };
      }
    }
    if (earliestMatch === null) {
      return null;
    }
    try {
      if (earliestMatch.kind === 'token') {
        handleTokens(removePrefix(earliestMatch.text));
      } else {
        PaymentRequest.fromEncodedRequest(earliestMatch.text);
      }
      return { kind: earliestMatch.kind, payload: earliestMatch.text };
    } catch {
      // Resume one character into the failed match because another valid
      // payload may begin inside the same regex match.
      searchFrom = earliestMatch.index + 1;
    }
  }
  return null;
}

/**
 * Private helper function to decode different versions of cashu tokens into an object.
 *
 * @remarks
 * Callers should use {@link getDecodedToken} or {@link getTokenMetadata}
 * @param token An encoded cashu token (cashuB...)
 * @returns Cashu Token object.
 */
function handleTokens(token: string): Token {
  const version = token.slice(0, 1);
  const encodedToken = token.slice(1);
  if (version === 'A') {
    const parsedV3Token = decodeBase64UrlToJson<DeprecatedToken>(encodedToken);
    if (parsedV3Token.token.length > 1) {
      throw new CTSError('Multi entry token are not supported');
    }
    const entry = parsedV3Token.token[0];
    const proofs = entry.proofs.map((p) => ({
      ...p,
      amount: Amount.from(p.amount as AmountLike),
    }));
    const tokenObj: Token = {
      mint: entry.mint,
      proofs,
      unit: parsedV3Token.unit || 'sat',
    };
    if (parsedV3Token.memo) {
      tokenObj.memo = parsedV3Token.memo;
    }
    return tokenObj;
  } else if (version === 'B') {
    const uInt8Token = decodeBase64UrlToUint8(encodedToken);
    const tokenData = decodeCBOR(uInt8Token) as TokenV4Template;
    return tokenFromTemplate(tokenData);
  }
  throw new CTSError('Token version is not supported');
}

export type DeriveKeysetIdOptions = {
  expiry?: number;
  input_fee_ppk?: number;
  unit?: string;
  versionByte?: number;
  isDeprecatedBase64?: boolean;
};

/**
 * Returns the keyset id of a set of keys.
 *
 * @param keys Keys object to derive keyset id from.
 * @param options.expiry (optional) expiry of the keyset (V2 only; V3 does not commit expiry to the
 *   id).
 * @param options.input_fee_ppk (optional) Input fee for keyset (in ppk)
 * @param options.unit (optional) the unit of the keyset. Default: sat.
 * @param options.versionByte (optional) version of the keyset ID. Default: 1.
 * @param options.isDeprecatedBase64 (optional) version of the keyset ID. Default: false.
 * @returns Keyset id of the keys.
 * @throws If keyset versionByte is not valid.
 */
export function deriveKeysetId(keys: Keys, options?: DeriveKeysetIdOptions): string {
  const unit = options?.unit ?? 'sat'; // default: sat
  const expiry = options?.expiry;
  const versionByte = options?.versionByte ?? 1; // default: 1
  const input_fee_ppk = options?.input_fee_ppk;
  const isDeprecatedBase64 = options?.isDeprecatedBase64 ?? false; // default: false

  if (isDeprecatedBase64) {
    const pubkeysConcat = Object.entries(keys)
      .sort(([amountA], [amountB]) => Amount.from(amountA).compareTo(amountB))
      .map(([, pubKey]) => pubKey)
      .reduce((prev: string, curr: string) => prev + curr, '');
    const hash = sha256(utf8ToBytes(pubkeysConcat));
    const b64 = encodeUint8ToBase64(hash);
    return b64.slice(0, 12);
  }

  switch (versionByte) {
    case 0: {
      const pubkeysConcat = mergeUInt8Arrays(
        ...Object.entries(keys)
          .sort(([amountA], [amountB]) => Amount.from(amountA).compareTo(amountB))
          .map(([, pubKey]) => hexToBytes(pubKey)),
      );
      const hash = sha256(pubkeysConcat);
      const hashHex = bytesToHex(hash).slice(0, 14);
      return '00' + hashHex;
    }
    case 1: {
      if (!unit) {
        throw new CTSError(`Cannot compute keyset ID version 01: unit is required.`);
      }
      // Per NUT-02 V2: pubkey hex and unit string MUST be lowercased in the preimage.
      const sortedEntries = Object.entries(keys).sort(([amountA], [amountB]) =>
        Amount.from(amountA).compareTo(amountB),
      );
      let preimage = sortedEntries
        .map(([amount, pubkey]) => `${amount}:${pubkey.toLowerCase()}`)
        .join(',');
      preimage += `|unit:${unit.toLowerCase()}`;
      // Per NUT-02: input_fee_ppk and expiry must be specified AND non-zero (truthy)
      if (input_fee_ppk) {
        preimage += `|input_fee_ppk:${input_fee_ppk}`;
      }
      if (expiry) {
        preimage += `|final_expiry:${expiry}`;
      }
      const hash = sha256(utf8ToBytes(preimage));
      const hashHex = bytesToHex(hash);
      return '01' + hashHex;
    }
    case 2: {
      if (!unit) {
        throw new CTSError(`Cannot compute keyset ID version 02: unit is required.`);
      }
      // Per NUT-02 V3: length-framed preimage over raw bytes; unit MUST match
      // [a-z0-9_-]+ and final_expiry is not committed to the id.
      if (!/^[a-z0-9_-]+$/.test(unit)) {
        throw new CTSError(`Invalid keyset unit: ${unit}`);
      }
      const sortedEntries = Object.entries(keys).sort(([amountA], [amountB]) =>
        Amount.from(amountA).compareTo(amountB),
      );
      const keysBytes = mergeUInt8Arrays(
        ...sortedEntries.flatMap(([amount, pubkey]) => [
          len32Framed(minimalBytesBE(BigInt(amount))),
          len32Framed(hexToBytes(pubkey.toLowerCase())),
        ]),
      );
      const preimage = mergeUInt8Arrays(
        len32Framed(keysBytes),
        len32Framed(utf8ToBytes(unit)),
        len32Framed(minimalBytesBE(BigInt(input_fee_ppk ?? 0))),
      );
      return '02' + bytesToHex(sha256(preimage));
    }
    default:
      throw new CTSError(`Unrecognized keyset ID version: ${versionByte}`);
  }
}

function mergeUInt8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((a, c) => a + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    merged.set(arr, offset);
    offset += arr.length;
  }
  return merged;
}

/**
 * NUT-02 V3 len32 framing: 4-byte big-endian length prefix.
 */
function len32Framed(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, false);
  out.set(b, 4);
  return out;
}

/**
 * True if the proof lives on a BLS (v3) keyset, so nutroot rules apply.
 */
export function isBlsProof(proof: Pick<Proof, 'id'>): boolean {
  return isBlsKeyset(proof.id);
}

/**
 * Spend-info shape of a nutroot proof (NUT-10 receive-time check 1).
 */
export type NutrootSpendInfoShape =
  'bearer' | 'script-only' | 'receiver-keyed' | 'disclosed' | 'none';

/**
 * Classifies a nutroot proof's spend info by shape: which key, if any, travels with it.
 *
 * @remarks
 * `bearer`: the private key `k` rides the token. `script-only`: `u` claims a NUMS internal key, so
 * no key path exists and only the disclosed leaves spend (an `E` beside it blinds leaf keys only).
 * `receiver-keyed`: the receiver's static key derives the spending key from `E`. `disclosed`: `K`
 * alone travels, so the key path is held elsewhere (eg an aggregated key's cosigners). `none`: no
 * spend info (eg the owner's own proof). Classifies the claimed shape only:
 * `verifyNutrootSpendInfo` checks the commitments.
 */
export function classifyNutrootSpendInfo(proof: Pick<Proof, 'spend_info'>): NutrootSpendInfoShape {
  const si = proof.spend_info;
  if (si?.k) return 'bearer';
  if (si?.u) return 'script-only';
  if (si?.E) return 'receiver-keyed';
  if (si?.K) return 'disclosed';
  return 'none';
}

/**
 * The key an auditable lock (NUT-10) commits to, fully verified; `undefined` for any other shape.
 *
 * @remarks
 * An auditable lock is script-only with a NUMS-proven internal key and exactly one threshold leaf
 * of one key (`auditableLock` builds it), so anyone holding the proof can verify who it is locked
 * to. Verifies the commitments (NUMS offset, root, tweak), not just the claimed fields.
 */
export function auditableLockKey(
  proof: Pick<Proof, 'id' | 'secret' | 'spend_info'>,
): string | undefined {
  const si = proof.spend_info;
  if (!isBlsKeyset(proof.id)) return undefined;
  if (!si || si.k || si.E || !si.K || !si.u || si.tree?.length !== 1) return undefined;
  try {
    const leaf = parseNutrootLeafHex(si.tree[0]);
    if (leaf.type !== 'threshold' || leaf.n !== 1 || leaf.keys.length !== 1) return undefined;
    verifyNutrootSpendInfo(proof.secret, si);
    return leaf.keys[0];
  } catch {
    return undefined;
  }
}

/**
 * What {@link verifySpendReceipt} checked, one flag per claim the receipt makes.
 */
export type SpendReceiptVerdict = {
  /**
   * The receipt is about this proof: its `Y` and keyset match.
   */
  proof: boolean;
  /**
   * `inputDigest` recomputes from `transcript` and this proof's own container (NUT-10).
   */
  inputDigest: boolean;
  /**
   * `commitment` recomputes from `Y`, `inputDigest` and `witness` (NUT-07). Compare it to the
   * mint's for the same `Y` to tie the receipt to a real spend.
   */
  commitment: boolean;
  /**
   * `witness` spends this proof over `inputDigest`: a key-path signature by the secret, or a
   * script-path leaf the secret commits to, with its signatures and any preimage.
   */
  witness: boolean;
  path?: 'key' | 'script';
  ok: boolean;
};

/**
 * Verify a spend receipt against the proof it claims to have spent; every check is client-side.
 *
 * @remarks
 * What anyone given the spent proof can establish without the mint: it is about that proof, its
 * digest was built from the transcript it shows, and the witness satisfies the secret. `ok` is all
 * four. An `after` leaf's time is not checked, since nothing here says when the spend happened.
 * Whether the spend happened at all is the mint's `commitment` for `Y` (NUT-07): compare it to the
 * receipt's yourself.
 */
export function verifySpendReceipt(
  receipt: SpendReceipt,
  proof: Pick<Proof, 'id' | 'secret' | 'amount' | 'C'>,
): SpendReceiptVerdict {
  // Invalid until proven otherwise
  const verdict: SpendReceiptVerdict = {
    proof: false,
    inputDigest: false,
    commitment: false,
    witness: false,
    ok: false,
  };
  if (!isBlsKeyset(proof.id) || receipt.keysetId !== proof.id) return verdict;
  let Y: string;
  let digest: Uint8Array;
  try {
    Y = hashToCurveBls(utf8ToBytes(proof.secret)).toHex(true);
    verdict.proof = receipt.Y.toLowerCase() === Y;
    digest = hexToBytes(receipt.inputDigest);
    const container = proofInputContainer({
      amount: Amount.from(proof.amount).toBigInt(),
      keysetId: proof.id,
      secret: proof.secret,
      C: proof.C,
    });
    const recomputed = inputDigest(sha256(hexToBytes(receipt.transcript)), container);
    verdict.inputDigest = bytesToHex(recomputed) === bytesToHex(digest);
    verdict.commitment =
      spendCommitment(Y, digest, receipt.witness) === receipt.commitment.toLowerCase();
  } catch {
    return verdict;
  }
  if (verifyTransactionInputWitness(digest, proof.secret, receipt.witness)) {
    verdict.path = 'key';
    verdict.witness = true;
  } else {
    verdict.path = 'script';
    verdict.witness = scriptPathWitnessSpends(digest, proof.secret, receipt.witness);
  }
  verdict.ok = verdict.proof && verdict.inputDigest && verdict.commitment && verdict.witness;
  return verdict;
}

function scriptPathWitnessSpends(digest: Uint8Array, secretHex: string, witness: string): boolean {
  try {
    const w = JSON.parse(witness) as {
      leaf?: string;
      control?: { K?: string; path?: string[] };
      signatures?: string[];
      preimage?: string;
    };
    if (!w.leaf || !w.control?.K || !Array.isArray(w.control.path)) return false;
    const leaf = parseNutrootLeafHex(w.leaf);
    const committed = verifyNutrootCommitment(
      hexToBytes(secretHex),
      hexToBytes(w.control.K),
      hexToBytes(w.leaf),
      w.control.path.map((h) => hexToBytes(h)),
    );
    const signed = countLeafSigners(leaf, digest, w.signatures ?? []) >= leaf.n;
    const unlocked =
      leaf.hash === undefined || (!!w.preimage && verifyHTLCHash(w.preimage, leaf.hash));
    return committed && signed && unlocked;
  } catch {
    return false;
  }
}

/**
 * Returns a copy of `proofs` sorted by keyset id (lexicographic).
 */
export function sortProofsById(proofs: Proof[]) {
  return [...proofs].sort((a: Proof, b: Proof) => a.id.localeCompare(b.id));
}

/**
 * Type guard: returns `true` if `v` is a non-null object.
 *
 * @internal
 */
export function isObj(v: unknown): v is object {
  return v != null && typeof v === 'object';
}

/**
 * In-place: set listed keys to `null` if currently `undefined`. Used when normalizing mint
 * responses where the spec defines a nullable wire field but the mint omits it (Postel-style).
 * Pairs with TS types declared as `T | null`.
 *
 * @internal
 */
export function nullIfUndefined(o: Record<string, unknown>, ...keys: string[]): void {
  for (const k of keys) if (o[k] === undefined) o[k] = null;
}

/**
 * Joins URL path segments, stripping leading/trailing slashes from each part.
 *
 * @internal
 */
export function joinUrls(...parts: string[]): string {
  return parts.map((part: string) => part.replace(/(^\/+|\/+$)/g, '')).join('/');
}

/**
 * Parses and normalizes a mint URL: validates the scheme (http/https only), rejects credentials,
 * query parameters, fragments, and percent-encoded characters in the path, and strips any trailing
 * slashes.
 *
 * @example
 *
 *     normalizeMintUrl('https://Mint.Example.COM/'); // 'https://mint.example.com'
 *
 * @throws CTSError if the URL is invalid, non-http(s), or contains credentials, query, fragment, or
 *   percent-encoded characters in the path.
 */
export function normalizeMintUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new CTSError(`Invalid mint URL: ${url}`, { cause: e });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CTSError(`Invalid mint URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new CTSError('Mint URL must not contain credentials');
  }
  if (parsed.search || parsed.href.includes('?')) {
    throw new CTSError('Mint URL must not contain query parameters');
  }
  if (parsed.hash || parsed.href.includes('#')) {
    throw new CTSError('Mint URL must not contain a fragment');
  }
  if (/%[0-9a-f]{2}/i.test(parsed.pathname)) {
    throw new CTSError('Mint URL path must not contain percent-encoded characters');
  }
  return parsed.href.replace(/\/+$/, '');
}

/**
 * Sums the `amount` field of the given proofs.
 */
export function sumProofs(proofs: Array<Pick<ProofLike, 'amount'>>): Amount {
  return Amount.sum(proofs.map((proof) => proof.amount));
}

/**
 * Normalizes raw proof objects (e.g. from a database query) into typed {@link Proof} objects by
 * converting `amount` to `bigint`. Use {@link deserializeProofs} if your proofs are stored as JSON.
 *
 * @example
 *
 *     const proofs = normalizeProofAmounts(db.query('SELECT * FROM proofs'));
 */
export function normalizeProofAmounts(raw: ProofLike[]): Proof[] {
  return raw.map((p) => ({ ...p, amount: Amount.from(p.amount) }));
}

/**
 * Serializes one or more {@link Proof} objects to an array of individual JSON strings, one per
 * proof. BigInt `amount` fields are emitted as plain JSON numbers without precision loss.
 *
 * @example
 *
 *     // NutZap proof tags
 *     const proofTags = serializeProofs(proofs).map((s) => ['proof', s]);
 *
 *     // localStorage
 *     localStorage.setItem('proofs', JSON.stringify(serializeProofs(proofs)));
 */
export function serializeProofs(proofs: Proof | Proof[]): string[] {
  const arr = Array.isArray(proofs) ? proofs : [proofs];
  return arr.map((p) => JSONInt.stringify(p) as string);
}

/**
 * Deserializes proofs from JSON back into typed {@link Proof} objects, restoring `amount` as
 * `bigint` without silent precision loss.
 *
 * - Pass a `string[]` (individual proof JSON strings) when reading from NutZap proof tags or a
 *   database.
 * - Pass a `string` (a JSON array) when reading from a single stored blob e.g. localStorage.
 * - Pass a `ProofLike[]` of already-parsed proof objects for legacy data or database rows.
 *
 * @example
 *
 *     // NutZap proof tags
 *     const proofs = deserializeProofs(
 *       event.tags.filter((t) => t[0] === 'proof').map((t) => t[1]),
 *     );
 *
 *     // localStorage — pass the raw string, no JSON.parse needed
 *     const proofs = deserializeProofs(localStorage.getItem('proofs') ?? '[]');
 */
export function deserializeProofs(json: string | string[] | ProofLike[]): Proof[] {
  if (!Array.isArray(json)) {
    const parsed = JSONInt.parse(json);
    if (!Array.isArray(parsed)) {
      throw new TypeError('deserializeProofs: expected a JSON array of proofs');
    }
    json = parsed;
  }
  const raw = json.map((s: unknown) => (typeof s === 'string' ? JSONInt.parse(s) : s));
  return normalizeProofAmounts(raw as ProofLike[]);
}

/**
 * Decodes an encoded cashu payment request string into a {@link PaymentRequest}.
 */
export function decodePaymentRequest(paymentRequest: string) {
  return PaymentRequest.fromEncodedRequest(paymentRequest);
}

/**
 * Removes all traces of DLEQs from a list of proofs.
 *
 * @param proofs The list of proofs that dleq should be stripped from.
 */
export function stripDleq(proofs: Proof[]): Array<Omit<Proof, 'dleq'>> {
  return proofs.map((p) => {
    const { dleq, ...rest } = p;
    void dleq;
    return rest;
  });
}

/**
 * Maps the short keyset IDs stored in the token to actual keyset IDs that were fetched from the
 * Mint.
 *
 * @param proofs Array of Proofs.
 * @param keysets Array of full keyset ID strings, eg: from `KeyChain.getAllKeysetIds()`
 * @returns Array of Proofs with full keyset IDs.
 */
function mapShortKeysetIds(proofs: Proof[], keysetIds: readonly string[]): Proof[] {
  const uniqueIds = [...new Set(keysetIds.map((id) => id.toLowerCase()))];
  const newProofs: Proof[] = [];
  for (const proof of proofs) {
    let idBytes: Uint8Array;
    try {
      idBytes = hexToBytes(proof.id);
    } catch {
      // Base64 keysets don't need conversion
      newProofs.push(proof);
      continue;
    }

    if (idBytes[0] === 0x00) {
      newProofs.push(proof);
    } else {
      // Modern hex keyset IDs (v1+) are spec'd at exactly 8 bytes (short, in tokens) or 33 bytes
      // (full). v0 is the only short-form outlier and was handled above.
      // Permissive version gate: assumes future keyset versions follow same length spec.
      if (proof.id.length === 66) {
        newProofs.push(proof);
        continue;
      }
      if (proof.id.length !== 16) {
        throw new CTSError(`Malformed keyset ID (unexpected length): ${proof.id}`);
      }
      if (!uniqueIds.length) {
        throw new CTSError(
          `Short keyset ID ${proof.id} cannot be resolved. ` +
            'Call `wallet.loadMint()` (or pass `KeyChain.getAllKeysetIds()`) first.',
        );
      }
      // Look for a match: prefix(keyset ID) == short ID
      const shortId = proof.id.toLowerCase();
      const matches = uniqueIds.filter((id) => shortId === id.slice(0, shortId.length));
      if (matches.length > 1) {
        throw new CTSError(`Short keyset ID ${proof.id} is ambiguous.`);
      }
      if (matches.length === 0) {
        throw new CTSError(
          `Couldn't map short keyset ID ${proof.id} to any known keysets of the current Mint`,
        );
      }
      proof.id = matches[0];
      newProofs.push(proof);
    }
  }

  return newProofs;
}

/**
 * NUT-12: verifies the DLEQ on a Proof. v3 (BLS) proofs have no DLEQ payload — pairing equality
 * stands in and runs regardless of `require`.
 *
 * @param proof The proof subject to verification.
 * @param keyset Object containing keyset keys (eg: Keyset, MintKeys, KeysetCache).
 * @param opts.require Default `false` (NUT-12 "MUST verify-if-present" — missing DLEQ on v0/v1/v2
 *   returns `true`). `true` opts into above-spec strictness: missing DLEQ → `false`.
 * @returns True if verification succeeded, false otherwise.
 * @throws CTSError if the proof amount is not a denomination in the keyset.
 */
export function hasValidDleq(
  proof: Proof,
  keyset: HasKeysetKeys,
  opts?: { require?: boolean },
): boolean {
  const require = opts?.require ?? false;
  // v3 (BLS) proofs carry no DLEQ; pairing verification stands in. Returns true iff
  // e(C, G2) == e(Y, K2). This is "valid signature" in v3 terms — equivalent guarantee
  // to a verifying DLEQ on v0/v1/v2 proofs.
  if (!hasCorrespondingKey(proof.amount, keyset.keys)) {
    // An empty keyset means keys were never loaded (eg rotated-out keyset per NUT-01),
    // not that the denomination is missing. Say so: the two failures have different fixes.
    const message =
      Object.keys(keyset.keys).length === 0
        ? `No keys loaded for keyset ${keyset.id}`
        : `Undefined key for amount ${proof.amount.toString()} in keyset ${keyset.id}`;
    throw new CTSError(message);
  }

  if (isBlsKeyset(proof.id)) {
    try {
      assertV3PointSecret(proof.secret);
      const K2 = pointFromHexG2(keyset.keys[proof.amount.toString()]);
      return verifyUnblindedSignatureBls(
        K2,
        pointFromHexG1(proof.C),
        new TextEncoder().encode(proof.secret),
      );
    } catch {
      // Malformed v3 keyset hex, malformed proof.C, etc. — match secp behaviour: return false.
      return false;
    }
  }

  if (proof?.dleq == undefined) {
    return !require;
  }

  const key = keyset.keys[proof.amount.toString()];
  try {
    const dleq = {
      e: hexToBytes(proof.dleq.e),
      s: hexToBytes(proof.dleq.s),
      r: hexToNumber(proof.dleq.r ?? '00'),
    } as DLEQ;
    return verifyDLEQProof_reblind(
      new TextEncoder().encode(proof.secret),
      dleq,
      pointFromHex(proof.C),
      pointFromHex(key),
    );
  } catch {
    // Malformed DLEQ payload (out-of-range scalar, bad point encoding, etc.) — treat as invalid.
    return false;
  }
}

/**
 * Verifies a batch of received proofs in one pass, batching the v3 (BLS) subset into a single
 * multi-pairing while keeping per-proof DLEQ verification for v0/v1/v2.
 *
 * Batch path: builds the {K2, C, secret} triples once, runs `batchVerifyUnblindedSignatureBls`, and
 * on failure re-runs per-proof to identify the offending proof — cost is one extra batch's worth of
 * work on the unhappy path, acceptable.
 *
 * @param proofs The proofs to verify (mixed curves allowed; `amount` may be any {@link AmountLike}
 *   shape — normalized internally).
 * @param getKeyset Lookup callback (e.g. `(id) => keyChain.getKeyset(id)`).
 * @param opts.requireDleq Forwarded to {@link hasValidDleq} as `require` for v0/v1/v2 proofs;
 *   ignored for v3.
 * @throws CTSError if any proof's amount is not in its keyset, or DLEQ/pairing verification fails.
 */
export function verifyProofsForReceive(
  proofs: ProofLike[],
  getKeyset: (id: string) => HasKeysetKeys,
  opts?: { requireDleq?: boolean },
): void {
  const normalized = normalizeProofAmounts(proofs);
  const requireDleq = opts?.requireDleq ?? false;
  const failMsg = requireDleq
    ? 'Token contains proofs with invalid or missing DLEQ'
    : 'Token contains a proof with an invalid DLEQ';

  const blsProofs: Proof[] = [];
  const otherProofs: Proof[] = [];
  for (const p of normalized) {
    (isBlsKeyset(p.id) ? blsProofs : otherProofs).push(p);
  }

  const offenderSuffix = (p: Proof) => ` (keyset ${p.id}, amount ${p.amount.toString()})`;

  for (const p of otherProofs) {
    if (!hasValidDleq(p, getKeyset(p.id), { require: requireDleq })) {
      throw new CTSError(failMsg + offenderSuffix(p));
    }
  }

  if (blsProofs.length === 0) return;

  // Receive-time verification cascade (nutroot secrets 2.5.1): spend info must reconstruct the
  // secret (bare key, or complete disclosed tree). Anything partial or mismatched rejects.
  for (const p of blsProofs) {
    if (!p.spend_info) continue;
    try {
      verifyNutrootSpendInfo(p.secret, p.spend_info);
    } catch (e) {
      throw new CTSError(
        `${e instanceof Error ? e.message : 'Invalid spend info'}${offenderSuffix(p)}`,
      );
    }
  }

  // Batch path bypasses hasValidDleq, so the amount-in-keyset check is repeated here.
  const items = blsProofs.map((p) => {
    const ks = getKeyset(p.id);
    if (!hasCorrespondingKey(p.amount, ks.keys)) {
      throw new CTSError(`Undefined key for amount ${p.amount.toString()} in keyset ${ks.id}`);
    }
    // Wrap both parses: a malformed/foreign-curve K2 must surface as a CTSError, not an
    // unhandled throw that escapes the receive path.
    let K2: G2Point;
    let C: G1Point;
    try {
      assertV3PointSecret(p.secret);
      K2 = pointFromHexG2(ks.keys[p.amount.toString()]);
      C = pointFromHexG1(p.C);
    } catch {
      throw new CTSError(failMsg + offenderSuffix(p));
    }
    return { K2, C, secret: new TextEncoder().encode(p.secret), proof: p };
  });

  // Single proof: batch wrapper costs an extra mul; just pair directly.
  if (items.length === 1) {
    const it = items[0];
    if (!verifyUnblindedSignatureBls(it.K2, it.C, it.secret)) {
      throw new CTSError(failMsg + offenderSuffix(it.proof));
    }
    return;
  }

  if (batchVerifyUnblindedSignatureBls(items)) return;

  // Batch failed — pinpoint the offender so the caller can surface a useful error.
  for (const it of items) {
    if (!verifyUnblindedSignatureBls(it.K2, it.C, it.secret)) {
      throw new CTSError(failMsg + offenderSuffix(it.proof));
    }
  }
  // Defensive: batch returned false but every proof verified individually. Shouldn't happen
  // unless the batch implementation regresses; treat as a hard failure rather than silently passing.
  throw new CTSError(failMsg);
}

/**
 * Encodes a {@link Token} as a raw binary token (`craw` + `B` + CBOR).
 */
export function getEncodedTokenBinary(token: Token): Uint8Array {
  const utf8Encoder = new TextEncoder();
  // Normalize amounts for untyped (JS) callers who may pass JSON.parse'd tokens directly.
  const proofs = normalizeProofAmounts(token.proofs);
  if (hasNonHexId(proofs)) {
    throw new CTSError(
      'Proofs contain a legacy keyset ID and cannot be encoded. Swap them at the mint first.',
    );
  }
  const template = templateFromToken({ ...token, proofs });
  const binaryTemplate = encodeCBOR(template);
  const prefix = utf8Encoder.encode('craw');
  const version = utf8Encoder.encode('B');
  return mergeUInt8Arrays(prefix, version, binaryTemplate);
}

/**
 * Decodes a raw binary token (`craw` + `B` + CBOR) into a {@link Token}.
 */
export function getDecodedTokenBinary(bytes: Uint8Array): Token {
  const utfDecoder = new TextDecoder();
  const prefix = utfDecoder.decode(bytes.slice(0, 4));
  const version = utfDecoder.decode(new Uint8Array([bytes[4]]));
  if (prefix !== 'craw' || version !== 'B') {
    throw new CTSError('not a valid binary token');
  }
  const binaryToken = bytes.slice(5);
  const decoded = decodeCBOR(binaryToken) as TokenV4Template;
  return tokenFromTemplate(decoded);
}

function removePrefix(token: string): string {
  // Strip optional URI scheme first, then the required "cashu" token prefix
  const uriSchemes = ['web+cashu://', 'cashu://', 'cashu:'];
  for (const scheme of uriSchemes) {
    if (token.startsWith(scheme)) {
      token = token.slice(scheme.length);
      break;
    }
  }
  if (token.startsWith('cashu')) {
    token = token.slice('cashu'.length);
  }
  return token;
}

/**
 * Detects whether a BOLT-11 Lightning invoice encodes a non-zero amount in the Human-Readable Part
 * (HRP).
 *
 * @internal
 */
export function invoiceHasAmountInHRP(invoice: string): boolean {
  try {
    return bolt11AmountMsat(invoice) !== null;
  } catch {
    return false; // malformed invoice or amount: no readable amount in the HRP
  }
}

/**
 * Msat per HRP amount unit for each BOLT11 multiplier ('p' is handled separately).
 */
const MULTIPLIER_MSAT: Record<string, bigint> = {
  m: 100_000_000n, // milli-bitcoin
  u: 100_000n, // micro-bitcoin
  n: 100n, // nano-bitcoin
};

const MSAT_PER_BTC = 100_000_000_000n;

/**
 * Reads the amount a BOLT11 invoice asks for from its human readable part, in millisats.
 *
 * @remarks
 * HRP only: no checksum or signature validation, that is the payer's job. Returns null for an
 * amountless invoice.
 * @throws If the string is not shaped like a BOLT11 invoice or the amount is malformed.
 * @internal
 */
export function bolt11AmountMsat(pr: string): bigint | null {
  if (typeof pr !== 'string') throw new CTSError('BOLT11 invoice must be a string');
  const lower = pr.toLowerCase();
  // The bech32 charset excludes '1', so the last '1' is the HRP separator.
  const sep = lower.lastIndexOf('1');
  if (!lower.startsWith('ln') || sep < 3 || sep === lower.length - 1) {
    throw new CTSError('Invalid BOLT11 invoice');
  }
  const match = /^ln[a-z]+?(\d*)([munp]?)$/.exec(lower.slice(0, sep));
  if (!match) throw new CTSError('Invalid BOLT11 invoice');

  const [, digits, multiplier] = match;
  if (digits === '') return null; // amountless invoice
  // BOLT11 forbids leading zeros, which also rules out a zero amount.
  if (digits.startsWith('0')) throw new CTSError('Invalid BOLT11 amount');
  const n = BigInt(digits);
  if (multiplier === '') return n * MSAT_PER_BTC;
  if (multiplier === 'p') {
    // Pico-bitcoin is 0.1 msat per unit; BOLT11 requires a multiple of 10.
    if (n % 10n !== 0n) throw new CTSError('Invalid BOLT11 amount');
    return n / 10n;
  }
  return n * MULTIPLIER_MSAT[multiplier];
}
