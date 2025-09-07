import { CashuMint } from './CashuMint';
import { CashuWallet } from './CashuWallet';
/**
 * @v3 import
 */
import { Mint } from './mint';
/**
 * @v3 imports
 */
import { KeyChain } from './wallet/KeyChain';
import {
	type P2PKOptions,
	type OutputType,
	type OutputConfig,
	type SendConfig,
	type SendOfflineConfig,
	type ReceiveConfig,
	type MintProofsConfig,
	type MeltProofsConfig,
	type SharedOutputTypeProps,
	DEFAULT_OUTPUT,
	DEFAULT_OUTPUT_CONFIG,
	Wallet,
} from './wallet';
import { OutputData } from './model/OutputData';
import { PaymentRequest } from './model/PaymentRequest';
import { setGlobalRequestOptions } from './request';
import { LogLevel, ConsoleLogger, type Logger } from './logger';
import {
	getEncodedToken,
	getEncodedTokenV4,
	getDecodedToken,
	deriveKeysetId,
	decodePaymentRequest,
	getDecodedTokenBinary,
	getEncodedTokenBinary,
	hasValidDleq,
} from './utils';
import { CashuAuthMint, CashuAuthWallet, getBlindedAuthToken, getEncodedAuthToken } from './auth';

export * from './model/types/index';

/**
 * @v3 exports
 */
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
	DEFAULT_OUTPUT,
	DEFAULT_OUTPUT_CONFIG,
	Wallet,
	Mint,
	KeyChain,
};

export {
	CashuMint,
	CashuWallet,
	CashuAuthMint,
	CashuAuthWallet,
	getEncodedAuthToken,
	getBlindedAuthToken,
	PaymentRequest,
	OutputData,
	getDecodedToken,
	getEncodedToken,
	getEncodedTokenV4,
	decodePaymentRequest,
	deriveKeysetId,
	setGlobalRequestOptions,
	getDecodedTokenBinary,
	getEncodedTokenBinary,
	hasValidDleq,
	LogLevel,
	ConsoleLogger,
	type Logger,
};

export { injectWebSocketImpl } from './ws';

export { MintOperationError, NetworkError, HttpResponseError } from './model/Errors';
