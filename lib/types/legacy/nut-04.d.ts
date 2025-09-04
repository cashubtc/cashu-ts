import { PartialMintQuoteResponse } from '../model/types/index';
import { Logger } from '../logger';
export type MintQuoteResponsePaidDeprecated = {
    paid?: boolean;
};
export declare function handleMintQuoteResponseDeprecated(response: PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated, logger: Logger): PartialMintQuoteResponse;
