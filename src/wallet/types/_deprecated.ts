import {
	type SwapRequest,
	type MeltQuoteBolt12Request,
	type MintQuoteBolt11Request,
	type MintQuoteBolt12Request,
} from '../../model/types';

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 *
 * @deprecated - Use MintQuoteBolt11Request.
 */
export type MintQuotePayload = MintQuoteBolt11Request;

/**
 * Payload for requesting a BOLT12 mint quote.
 *
 * @deprecated - Use MintQuoteBolt12Request.
 */
export type Bolt12MintQuotePayload = MintQuoteBolt12Request;

/**
 * Payload for requesting a BOLT12 melt quote. Used to pay Lightning Network offers.
 *
 * @deprecated - Use MeltQuoteBolt12Request.
 */
export type Bolt12MeltQuotePayload = MeltQuoteBolt12Request;

/**
 * Payload that needs to be sent to the mint when performing a split action.
 *
 * @deprecated - Use SwapRequest.
 */
export type SwapPayload = SwapRequest;
