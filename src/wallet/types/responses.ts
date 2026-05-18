import type { OutputDataLike } from '../../model/OutputData';
import type { MeltQuoteBaseResponse, Proof } from '../../model/types';

/**
 * Response after melting proofs.
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
   * Return/change from overpaid fees. Empty when the mint defers change (async/onchain melts).
   */
  change: Proof[];
  /**
   * NUT-08 outputs retained for deferred-change recovery (onchain, NUT-23 `prefer_async`). Empty
   * when `change` is populated — no recovery needed. Otherwise pair with the polled quote's
   * `change` via `wallet.createMeltChangeProofs()`.
   */
  outputData: OutputDataLike[];
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
