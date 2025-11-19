import { type MeltQuoteBolt11Response } from './NUT23';

/**
 * Response from the mint after requesting a BOLT12 melt quote. Contains payment details and state
 * for paying Lightning Network offers.
 *
 * @remarks
 * - Same as Bolt11.
 */
export type MeltQuoteBolt12Response = MeltQuoteBolt11Response;
