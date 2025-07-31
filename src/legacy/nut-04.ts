import type { PartialMintQuoteResponse } from '../model/types/index';
import { MintQuoteState } from '../model/types/index';
import type { Logger } from '../logger';

export type MintQuoteResponsePaidDeprecated = {
	paid?: boolean;
};

export function handleMintQuoteResponseDeprecated(
	response: PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated,
	logger: Logger
): PartialMintQuoteResponse {
	// if the response MeltQuoteResponse has a "paid" flag, we monkey patch it to the state enum
	if (!response.state) {
		logger.warn(
			"Field 'state' not found in MintQuoteResponse. Update NUT-04 of mint: https://github.com/cashubtc/nuts/pull/141)"
		);
		if (typeof response.paid === 'boolean') {
			response.state = response.paid ? MintQuoteState.PAID : MintQuoteState.UNPAID;
		}
	}
	return response;
}
