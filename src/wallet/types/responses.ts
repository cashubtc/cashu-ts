import type { MeltQuoteBaseResponse, MeltQuoteOnchainResponse, Proof } from '../../model/types';

/**
 * Response after paying a Lightning invoice.
 */
export type MeltProofsResponse<
  TQuote extends Pick<MeltQuoteBaseResponse, 'quote'> = MeltQuoteBaseResponse,
> = {
  /**
   * If false, the proofs have not been invalidated and the payment can be tried later again with
   * the same proofs.
   */
  quote: TQuote;
  /**
   * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
   */
  change: Proof[];
};

/**
 * Response after melting proofs via an onchain transaction.
 *
 * @remarks
 * No `change` field — NUT-08 does not apply to onchain melts.
 */
export type MeltProofsOnchainResponse = {
  quote: MeltQuoteOnchainResponse;
};

/**
 * Response after sending.
 */
export type SendResponse = {
  /**
   * Proofs that exceeded the needed amount.
   */
  keep: Proof[];
  /**
   * Proofs to be sent, matching the chosen amount.
   */
  send: Proof[];
  serialized?: Array<{ proof: Proof; keep: boolean }>;
};
