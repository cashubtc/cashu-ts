import {
	type MintQuoteBolt11Response,
	type MintQuoteBolt12Response,
	type MeltQuoteBolt11Response,
	type MeltQuoteBolt12Response,
} from '../../model/types';

/**
 * Response from the mint after requesting a melt quote.
 *
 * @deprecated - Use MeltQuoteBolt11Response.
 */
export type PartialMeltQuoteResponse = MeltQuoteBolt11Response;

/**
 * @deprecated - Use MeltQuoteBolt11Response.
 */
export type MeltQuoteResponse = MeltQuoteBolt11Response;

/**
 * @deprecated - Use MeltQuoteBolt12Response.
 */
export type Bolt12MeltQuoteResponse = MeltQuoteBolt12Response;

/**
 * Response from the mint after requesting a mint.
 *
 * @deprecated - Use MintQuoteBolt11Response or MintQuoteBolt12Response.
 */
export type PartialMintQuoteResponse = MintQuoteBolt11Response;

/**
 * @deprecated - Use MintQuoteBolt11Response.
 */
export type MintQuoteResponse = MintQuoteBolt11Response;

/**
 * @deprecated - Use MintQuoteBolt11Response.
 */
export type LockedMintQuoteResponse = MintQuoteBolt11Response;

/**
 * Response from the mint after requesting a BOLT12 mint quote. Contains a Lightning Network offer
 * and tracks payment/issuance amounts.
 *
 * @deprecated - Use MintQuoteBolt12Response.
 */
export type Bolt12MintQuoteResponse = MintQuoteBolt12Response;
