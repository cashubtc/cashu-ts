import type { PartialMeltQuoteResponse } from '../model/types/index';
import type { Logger } from '../logger';
export type MeltQuoteResponsePaidDeprecated = {
    paid?: boolean;
};
export declare function handleMeltQuoteResponseDeprecated(response: PartialMeltQuoteResponse & MeltQuoteResponsePaidDeprecated, logger: Logger): PartialMeltQuoteResponse;
