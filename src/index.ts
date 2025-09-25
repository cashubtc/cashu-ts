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
	type RestoreConfig,
	type MeltProofsResponse,
	type SendResponse,
	type OnCountersReserved,
	type SecretsPolicy,
	type CounterSource,
	type CancellerLike,
	type CounterRange,
	type OperationCounters,
	type SelectProofs,
	SendBuilder,
	ReceiveBuilder,
	MintBuilder,
	MeltBuilder,
	WalletEvents,
	WalletOps,
	Wallet,
} from './wallet';
export type * from './wallet/types/payloads';
export * from './mint/types';

// Core models & primitives
export * from './model/types';

// Crypto
export * from './crypto';

// Core Utils
export * from './utils/core';

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
export { type LogLevel, ConsoleLogger, type Logger } from './logger';
export { MintOperationError, NetworkError, HttpResponseError } from './model/Errors';

// Low-level helpers/types that appear in public surfaces
export { OutputData } from './model/OutputData';
export type { OutputDataLike, OutputDataFactory } from './model/OutputData';
export { MintInfo } from './model/MintInfo';
export { WSConnection, injectWebSocketImpl, setGlobalRequestOptions } from './transport';
export type { RequestFn, RequestArgs, RequestOptions } from './transport';
