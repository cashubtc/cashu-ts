import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  type DLEQ,
  type G1Point,
  type G2Point,
  batchVerifyUnblindedSignatureBls,
  isBlsKeyset,
  pointFromHex,
  pointFromHexG1,
  pointFromHexG2,
  verifyDLEQProof_reblind,
  verifyUnblindedSignatureBls,
} from '../crypto';
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

import { encodeBase64ToJson, encodeBase64toUint8, encodeUint8toBase64Url } from './base64';
import { Bytes } from './Bytes';
import { decodeCBOR, encodeCBOR } from './cbor';
import { JSONInt } from './JSONInt';

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
 * @throws Error if split sum is greater than value or mint does not have keys for requested split.
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
    // Calculate how many of this denomination fit into the remaining value
    const requireCount = remainingValue.divideBy(amtAsAmount).toNumber();
    // Add them to the split and reduce the target value by added amounts
    normalizedSplit.push(...Array<Amount>(requireCount).fill(amtAsAmount));
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
 * Returns `true` if the string contains only hexadecimal characters (case-insensitive).
 *
 * @internal
 */
export function isValidHex(str: string) {
  return /^[a-f0-9]+$/i.test(str);
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
  const base64Data = encodeUint8toBase64Url(encodedData);
  return prefix + version + base64Data;
}

function templateFromToken(token: Token): TokenV4Template {
  const idMap: { [id: string]: Proof[] } = {};
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
    t: Object.keys(idMap).map(
      (id: string): V4InnerToken => ({
        i: hexToBytes(id),
        p: idMap[id].map(
          (p: Proof): V4ProofTemplate => ({
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
            ...(p.witness && {
              w: JSON.stringify(p.witness),
            }),
          }),
        ),
      }),
    ),
  } as TokenV4Template;
  if (token.memo) {
    tokenTemplate.d = token.memo;
  }
  return tokenTemplate;
}

function tokenFromTemplate(template: TokenV4Template): Token {
  const proofs: Proof[] = [];
  template.t.forEach((t) =>
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
        ...(p.w && {
          witness: p.w,
        }),
      });
    }),
  );
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
    incompleteProofs: tokenObj.proofs.map((p) => {
      const { id, ...rest } = p;
      void id;
      return rest;
    }),
  };
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
    const parsedV3Token = encodeBase64ToJson<DeprecatedToken>(encodedToken);
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
    const uInt8Token = encodeBase64toUint8(encodedToken);
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
 * @param options.expiry (optional) expiry of the keyset.
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
    const hash = sha256(Bytes.fromString(pubkeysConcat));
    const b64 = Bytes.toBase64(hash);
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
      const hashHex = Bytes.toHex(hash).slice(0, 14);
      return '00' + hashHex;
    }
    case 1:
    case 2: {
      if (!unit) {
        throw new CTSError(`Cannot compute keyset ID version 0${versionByte}: unit is required.`);
      }
      const sortedEntries = Object.entries(keys).sort(([amountA], [amountB]) =>
        Amount.from(amountA).compareTo(amountB),
      );
      let preimage = sortedEntries.map(([amount, pubkey]) => `${amount}:${pubkey}`).join(',');
      preimage += `|unit:${unit}`;
      // Per NUT-02: input_fee_ppk and expiry must be specified AND non-zero (truthy)
      if (input_fee_ppk) {
        preimage += `|input_fee_ppk:${input_fee_ppk}`;
      }
      if (expiry) {
        preimage += `|final_expiry:${expiry}`;
      }
      const hash = sha256(Bytes.fromString(preimage));
      const hashHex = Bytes.toHex(hash);
      return (versionByte === 2 ? '02' : '01') + hashHex;
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
 * query parameters, fragments, and encoded path delimiters, and strips any trailing slashes.
 *
 * @internal
 */
export function normalizeUrl(url: string): string {
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
    } else if (idBytes[0] === 0x01 || idBytes[0] === 0x02) {
      if (!uniqueIds.length) {
        throw new CTSError(
          'A short keyset ID v2/v3 was encountered, but got no keysets to map it to.',
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
    } else {
      throw new CTSError(`Unknown keyset ID version: ${idBytes[0]}`);
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
    throw new CTSError(
      `Undefined key for amount ${proof.amount.toString()} in keyset ${keyset.id}`,
    );
  }

  if (isBlsKeyset(proof.id)) {
    try {
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
  if (!hasCorrespondingKey(proof.amount, keyset.keys)) {
    throw new CTSError(
      `Undefined key for amount ${proof.amount.toString()} in keyset ${keyset.id}`,
    );
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
 * @deprecated Use `hasValidDleq(proof, keyset, { require: false })`.
 *
 *   Will be removed in v5.0.
 */
export function verifyDleqIfPresent(proof: Proof, keyset: HasKeysetKeys): boolean {
  // v3 (BLS) proofs always require a pairing check at receive time — there's no DLEQ
  // to short-circuit on, so we route through hasValidDleq which performs the pairing.
  if (isBlsKeyset(proof.id)) {
    return hasValidDleq(proof, keyset);
  }
  if (proof?.dleq == undefined) {
    return true;
  }
  return hasValidDleq(proof, keyset, { require: false });
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
  return /^ln[a-z]{2,}[1-9][0-9]*(?:[mun]|0p)?1/i.test(invoice);
}
