import { type GetInfoResponse } from '../model/types';
import { canonicalizeJson } from '../utils/canonicalJson';

import { schnorrVerifyMessage } from './core';
import { isValidSecpPubkey } from './curve_secp';

/**
 * Checks the mint's BIP-340 signature over its `/v1/info` response.
 *
 * @remarks
 * The signed payload is the RFC 8785 canonicalization of the response without its `signature` and
 * `time` members, hashed with SHA-256. Pass the response exactly as the mint sent it: normalizing
 * or re-serializing it first changes the canonical bytes and the signature will not verify.
 * @returns `'unsigned'` when no signature is claimed, otherwise `'valid'` or `'invalid'`.
 */
export function verifyMintInfoSignature(info: GetInfoResponse): 'unsigned' | 'valid' | 'invalid' {
  const { signature, time, ...payload } = info;
  void time; // excluded from the signed payload
  if (signature == null) return 'unsigned';
  if (typeof signature !== 'string' || !isValidSecpPubkey(info.pubkey)) return 'invalid';
  try {
    // Signing is over the x-only half of the mint's compressed identity key; schnorrVerifyMessage
    // takes either form.
    return schnorrVerifyMessage(signature, canonicalizeJson(payload), info.pubkey)
      ? 'valid'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}
