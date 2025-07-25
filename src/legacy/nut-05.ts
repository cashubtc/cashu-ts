import type { PartialMeltQuoteResponse } from '../model/types/index';
import { MeltQuoteState } from '../model/types/index';
import type { Logger } from '../logger';

export type MeltQuoteResponsePaidDeprecated = {
	paid?: boolean;
};

export function handleMeltQuoteResponseDeprecated(
	response: PartialMeltQuoteResponse & MeltQuoteResponsePaidDeprecated,
	logger: Logger
): PartialMeltQuoteResponse {
	// if the response MeltQuoteResponse has a "paid" flag, we monkey patch it to the state enum
	if (!response.state) {
		logger.warn(
			"Field 'state' not found in MeltQuoteResponse. Update NUT-05 of mint: https://github.com/cashubtc/nuts/pull/136)"
		);
		if (typeof response.paid === 'boolean') {
			response.state = response.paid ? MeltQuoteState.PAID : MeltQuoteState.UNPAID;
		}
	}
	return response;
}
