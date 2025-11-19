import { MeltQuoteState, type MeltQuoteBaseResponse } from '../model/types';
import type { Logger } from '../logger';

export type MeltQuoteResponsePaidDeprecated = {
	paid?: boolean;
};

export function handleMeltQuoteResponseDeprecated<TQuote extends MeltQuoteBaseResponse>(
	response: TQuote & MeltQuoteResponsePaidDeprecated,
	logger: Logger,
): TQuote {
	// if the response has a "paid" flag, we monkey patch it to the state enum
	if (!response.state) {
		logger.warn(
			"Field 'state' not found in Melt Quote Response. Update NUT-05 of mint: https://github.com/cashubtc/nuts/pull/136)",
		);
		if (typeof response.paid === 'boolean') {
			response.state = response.paid ? MeltQuoteState.PAID : MeltQuoteState.UNPAID;
		}
	}
	return response;
}
