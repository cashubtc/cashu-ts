import { type MeltQuoteResponse } from '../../mint/types';
import { type Proof } from '../../model/types/proof';

/**
 * Response after paying a Lightning invoice.
 */
export type MeltProofsResponse = {
	/**
	 * If false, the proofs have not been invalidated and the payment can be tried later again with
	 * the same proofs.
	 */
	quote: MeltQuoteResponse;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
	 */
	change: Proof[];
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
