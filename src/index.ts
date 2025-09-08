/**
 * Legacy v2 (stable) exports.
 */
export { CashuMint } from './CashuMint';
export { CashuWallet } from './CashuWallet';

/**
 * V3 (experimental) exports.
 *
 * NOTE: v3 is under active development and may change without notice.
 */
export { Mint } from './mint';
export { Wallet, KeyChain, DEFAULT_OUTPUT, DEFAULT_OUTPUT_CONFIG } from './wallet/index';
export type {
	P2PKOptions,
	OutputType,
	OutputConfig,
	SendConfig,
	SendOfflineConfig,
	ReceiveConfig,
	MintProofsConfig,
	MeltProofsConfig,
	SharedOutputTypeProps,
} from './wallet/index';

/**
 * Public model & DTO types.
 */
export * from './model/types/index';

/**
 * Payment request API.
 */
export { PaymentRequest } from './model/PaymentRequest';
export { PaymentRequestTransportType } from './wallet/types/index';
export type {
	PaymentRequestTransport,
	RawPaymentRequest,
	RawTransport,
	NUT10Option,
} from './wallet/types/index';

/**
 * Utilities.
 */
export {
	getEncodedToken,
	getEncodedTokenV4,
	getDecodedToken,
	getDecodedTokenBinary,
	getEncodedTokenBinary,
	deriveKeysetId,
	decodePaymentRequest,
	hasValidDleq,
} from './utils';
export { setGlobalRequestOptions } from './request';
export { injectWebSocketImpl } from './ws';

/**
 * Auth helpers.
 */
export {
	CashuAuthMint,
	CashuAuthWallet,
	getBlindedAuthToken,
	getEncodedAuthToken,
} from './auth/index';

/**
 * Logger.
 */
export { ConsoleLogger, LogLevel } from './logger/index';
export type { Logger } from './logger/index';

/**
 * Errors.
 */
export { MintOperationError, NetworkError, HttpResponseError } from './model/Errors';
