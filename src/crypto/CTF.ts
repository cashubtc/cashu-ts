import { sha256 } from '@noble/hashes/sha2.js';

import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import type { Keys } from '../model/types/keyset';
import { Bytes } from '../utils';

export interface DeriveConditionalKeysetIdInput {
  keys: Keys;
  input_fee_ppk?: number;
  final_expiry?: number;
  unit: string;
  conditionId: string;
  outcomeCollectionId: string;
}

/**
 * Derives a NUT-CTF conditional keyset id.
 *
 * Mirrors CDK's `Id::v2_from_data_conditional`: build the NUT-02 V2 preimage, append
 * `|condition_id:<hex>|outcome_collection_id:<hex>`, SHA-256 it, and prefix the 32-byte digest with
 * the NUT-02 V2 version byte `01`.
 */
export function deriveConditionalKeysetId(input: DeriveConditionalKeysetIdInput): string {
  validateHex32(input.conditionId, 'conditionId');
  validateHex32(input.outcomeCollectionId, 'outcomeCollectionId');
  if (!input.unit) {
    throw new CTSError('Cannot compute conditional keyset ID: unit is required.');
  }

  let preimage = Object.entries(input.keys)
    .sort(([amountA], [amountB]) => Amount.from(amountA).compareTo(amountB))
    .map(([amount, pubkey]) => `${amount}:${pubkey.toLowerCase()}`)
    .join(',');
  preimage += `|unit:${input.unit.toLowerCase()}`;
  if (input.input_fee_ppk) {
    preimage += `|input_fee_ppk:${input.input_fee_ppk}`;
  }
  if (input.final_expiry) {
    preimage += `|final_expiry:${input.final_expiry}`;
  }
  preimage += `|condition_id:${input.conditionId.toLowerCase()}`;
  preimage += `|outcome_collection_id:${input.outcomeCollectionId.toLowerCase()}`;

  return '01' + Bytes.toHex(sha256(Bytes.fromString(preimage)));
}

function validateHex32(value: string, name: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new CTSError(`${name} must be a 64-character hex string`);
  }
}
