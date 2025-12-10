// ==========================
// Public API Surface
// ==========================
export { Mint } from './mint';
export { KeyChain } from './wallet/KeyChain';
export { Keyset } from './wallet/Keyset';
export { P2PKBuilder } from './wallet/P2PKBuilder';
export { type SelectProofs, selectProofsRGLI } from './wallet/SelectProofs';
export { Wallet } from './wallet/Wallet';
export { WalletCounters } from './wallet/WalletCounters';
export { WalletEvents } from './wallet/WalletEvents';
export {
	type MintMethod,
	type MintQuoteFor,
	SendBuilder,
	ReceiveBuilder,
	MintBuilder,
	MeltBuilder,
	WalletOps,
} from './wallet/WalletOps';

// AUTH module
export {
	OIDCAuth,
	AuthManager,
	createAuthWallet,
	type AuthProvider,
	type AuthManagerOptions,
	type TokenResponse,
	type DeviceStartResponse,
	type OIDCConfig,
	type OIDCAuthOptions,
} from './auth';

// Wallet/Mint types used in the public API surface
export type { CounterRange, CounterSource, OperationCounters } from './wallet/CounterSource';
export type { SubscribeOpts, CancellerLike } from './wallet/WalletEvents';
export type * from './wallet/types/_deprecated';
export type * from './wallet/types/config';
export type * from './wallet/types/payloads';
export type * from './wallet/types/responses';
export type { SubscriptionCanceller } from './wallet/types/websocket';
export type * from './mint/types/_deprecated';
export type * from './mint/types/payloads';
export type * from './mint/types/responses';

// Shared models & primitives
export type * from './model/types/_deprecated';
export type * from './model/types/blinded';
export type { JsonRpcReqParams, RpcSubKinds } from './model/types/jsonrpc';
export type * from './model/types/keyset';
export type * from './model/types/NUT03';
export * from './model/types/NUT04';
export * from './model/types/NUT05';
export type * from './model/types/NUT06';
export * from './model/types/NUT07';
export type * from './model/types/NUT23';
export type * from './model/types/NUT25';
export type * from './model/types/proof';
export type { Token, TokenMetadata } from './model/types/token';

// Crypto
export * from './crypto';

// Core Utils
export * from './utils/core';

// Payment request facade (tests rely on these at top level)
export { PaymentRequest } from './model/PaymentRequest';
export { PaymentRequestTransportType } from './wallet/types';
export type {
	PaymentRequestPayload,
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
