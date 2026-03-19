import { type SerializedBlindedMessage } from './blinded';

/**
 * Payload that needs to be sent to the mint when requesting a NUT-XX batched mint.
 */
export type BatchMintRequest = {
	/**
	 * Array of Quote IDs received from the mint.
	 */
	quotes: string[];
	/**
	 * Array of amounts that shall be minted per quote id.
	 */
	quote_amounts: number[];
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
