import { utf8ToBytes } from '@noble/hashes/utils.js';

import { type GetInfoResponse } from '../model/types';
import { canonicalizeJson } from '../utils/canonicalJson';
import { isRecord } from '../utils/core';

import { schnorrVerifyDigest, taggedHash } from './core';

const MINT_INFO_SIG_TAG = 'Cashu_MintInfo_v1';
// NUT-06: the mint's `time` may differ from the wallet clock by at most this many seconds.
const MAX_SKEW_SECS = 3600;
const COMPRESSED_PUBKEY_RE = /^0[23][0-9a-f]{64}$/;

/**
 * Checks the mint's BIP-340 signature over its `/v1/info` response (NUT-06).
 *
 * @remarks
 * The signed message is `tagged_hash("Cashu_MintInfo_v1", JCS(response minus signature))`, so pass
 * the response exactly as the mint sent it. `time` must be within 3600s of `now`, and when
 * `requestNonce` is given the response must echo it exactly.
 * @returns `'unsigned'` when no signature is claimed, otherwise `'valid'` or `'invalid'`.
 */
export function verifyMintInfoSignature(
  info: GetInfoResponse,
  opts: { requestNonce?: string; now?: number } = {},
): 'unsigned' | 'valid' | 'invalid' {
  // Untrusted JSON: check the shape before the spread below enumerates it.
  if (!isRecord(info) || info.signature == null) return 'unsigned';
  const { signature, ...payload } = info;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const wellFormed =
    typeof signature === 'string' &&
    typeof info.pubkey === 'string' &&
    COMPRESSED_PUBKEY_RE.test(info.pubkey) &&
    typeof info.time === 'number' &&
    Number.isInteger(info.time) &&
    Math.abs(info.time - now) <= MAX_SKEW_SECS &&
    (opts.requestNonce === undefined || info.request_nonce === opts.requestNonce);
  if (!wellFormed) return 'invalid';
  try {
    const digest = taggedHash(MINT_INFO_SIG_TAG, utf8ToBytes(canonicalizeJson(payload)));
    // BIP-340 verifies against the x-only half of the compressed identity key.
    return schnorrVerifyDigest(signature, digest, info.pubkey) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}
