// ==========================
// v2 (stable) surface
// ==========================
export { CashuMint } from './CashuMint';
export { CashuWallet } from './CashuWallet';

// Core models & primitives
export * from './model/types';

// Crypto
export * from './crypto';

// Serialization & helpers
export {
	getEncodedToken,
	getEncodedTokenV4,
	getDecodedToken,
	deriveKeysetId,
	decodePaymentRequest,
	getDecodedTokenBinary,
	getEncodedTokenBinary,
	hasValidDleq,
} from './utils';

// Auth
export { CashuAuthMint, CashuAuthWallet, getEncodedAuthToken, getBlindedAuthToken } from './auth';

// Payment request facade (tests rely on these at top level)
export { PaymentRequest } from './model/PaymentRequest';
export { PaymentRequestTransportType } from './wallet/types';
export type {
	PaymentRequestTransport,
	RawPaymentRequest,
	RawTransport,
	NUT10Option,
	RawNUT10Option,
} from './wallet/types';

// Logging & errors
export { LogLevel, ConsoleLogger, type Logger } from './logger';
export { MintOperationError, NetworkError, HttpResponseError } from './model/Errors';

// Low-level helpers/types that appear in public surfaces
export { OutputData } from './model/OutputData';
export type { OutputDataLike, OutputDataFactory } from './model/OutputData';
export { MintInfo } from './model/MintInfo';
export { WSConnection, injectWebSocketImpl, setGlobalRequestOptions } from './transport';
export type { RequestFn, RequestArgs, RequestOptions } from './transport';

// ==========================
// v3 (new API) surface
// ==========================
export { Mint } from './mint';
export { KeyChain } from './wallet/KeyChain';
export { Keyset } from './wallet/Keyset';
export {
	type P2PKOptions,
	type OutputType,
	type OutputConfig,
	type SendConfig,
	type SendOfflineConfig,
	type ReceiveConfig,
	type MintProofsConfig,
	type MeltProofsConfig,
	type SharedOutputTypeProps,
	type SubscriptionCanceller,
	type MeltBlanks,
	DEFAULT_OUTPUT,
	DEFAULT_OUTPUT_CONFIG,
	Wallet,
} from './wallet';
export * from './mint/types';
