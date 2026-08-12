import { Amount } from '../Amount';

import { type SerializedBlindedMessage } from './blinded';
import { type MintQuoteBaseResponse } from './NUT04';

/**
 * NUT-29 batch minting info advertised by the mint in the NUT-06 info response.
 */
export type Nut29Info = {
  methods?: string[];
  max_batch_size?: number;
};

/**
 * Batch quote check placeholder for a quote ID the mint holds no record of.
 *
 * @remarks
 * Returned in place (same index as the requested ID) for unknown or malformed IDs.
 */
export type UnknownQuote = {
  quote: string;
  unknown: true;
};

/**
 * Narrows a batch quote check entry to an {@link UnknownQuote}.
 */
export function isUnknownQuote(entry: unknown): entry is UnknownQuote {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as UnknownQuote).quote === 'string' &&
    (entry as UnknownQuote).unknown === true
  );
}

/**
 * Narrows a batch check entry to a known quote with a positive mintable amount (`amount_paid -
 * amount_issued`).
 */
export function isMintableQuote<
  T extends Pick<MintQuoteBaseResponse, 'amount_paid' | 'amount_issued'>,
>(entry: T | UnknownQuote): entry is T {
  if (isUnknownQuote(entry)) return false;
  return Amount.from(entry.amount_paid).greaterThan(Amount.from(entry.amount_issued));
}

/**
 * Payload that needs to be sent to the mint when requesting a NUT-29 batched mint.
 */
export type BatchMintRequest = {
  /**
   * Array of Quote IDs received from the mint.
   */
  quotes: string[];
  /**
   * Array of amounts that shall be minted per quote id.
   */
  quote_amounts: Amount[];
  /**
   * Outputs (blinded messages) to be signed by the mint.
   */
  outputs: SerializedBlindedMessage[];
  /**
   * Optional. Signatures for the Public key the quote is locked to (NUT-20) (same order as quote
   * ids). If some quotes are unlocked null is expected. Can be omitted if all quotes are unlocked.
   */
  signatures?: Array<string | null>;
};
