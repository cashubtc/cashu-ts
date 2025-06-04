import { type GCSFilter } from '../../gcs';
import { type OutputDataFactory, type OutputDataLike } from '../OutputData';
import { type Proof } from './wallet/index';

export * from './mint/index';
export * from './wallet/index';

export type OutputAmounts = {
	sendAmounts: number[];
	keepAmounts?: number[];
};

export type LockedMintQuote = {
	id: string;
	privkey: string;
};

/**
 * @param {ReceiveOptions} [options] - Optional configuration for token processing:
 *
 *   - `keysetId`: Override the default keyset ID with a custom one fetched from the `/keysets`
 *       endpoint.
 *   - `outputAmounts`: Specify output amounts for keeping or sending.
 *   - `proofsWeHave`: Provide stored proofs for optimal output derivation.
 *   - `counter`: Set a counter to deterministically derive secrets (requires CashuWallet initialized
 *       with a seed phrase).
 *   - `pubkey`: Lock eCash to a public key (non-deterministic, even with a counter set).
 *   - `privkey`: Create a signature for token secrets.
 *   - `requireDleq`: Verify DLEQ proofs for all provided proofs; reject the token if any proof fails
 *       verification.
 *   - `outputData` : Specify your own OutputData (blinded messages)
 *   - `p2pk` : Specify options to lock the proofs according to NUT-11.
 */
export type ReceiveOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	requireDleq?: boolean;
	outputData?: OutputDataLike[] | OutputDataFactory;
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * @param {SendOptions} [options] - Optional parameters for configuring the send operation:
 *
 *   - `outputAmounts` (OutputAmounts): Specify the amounts to keep and send in the output.
 *   - `counter` (number): Set a counter to derive secrets deterministically. Requires the `CashuWallet`
 *       class to be initialized with a seed phrase.
 *   - `proofsWeHave` (Array<Proof>): Provide all currently stored proofs for the mint. Used to derive
 *       optimal output amounts.
 *   - `pubkey` (string): Lock eCash to a specified public key. Note that this will not be
 *       deterministic, even if a counter is set.
 *   - `privkey` (string): Create a signature for the output secrets if provided.
 *   - `keysetId` (string): Override the keyset ID derived from the current mint keys with a custom one.
 *       The keyset ID should be fetched from the `/keysets` endpoint.
 *   - `offline` (boolean): Send proofs offline, if enabled.
 *   - `includeFees` (boolean): Include fees in the response, if enabled.
 *   - `includeDleq` (boolean): Include DLEQ proofs in the proofs to be sent, if enabled.
 *   - `outputData` : Specify your own OutputData (blinded messages)
 *   - `p2pk` : Specify options to lock the proofs according to NUT-11.
 */
export type SendOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	offline?: boolean;
	includeFees?: boolean;
	includeDleq?: boolean;
	outputData?: {
		send?: OutputDataLike[] | OutputDataFactory;
		keep?: OutputDataLike[] | OutputDataFactory;
	};
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * @param {SwapOptions} [options] - Optional parameters for configuring the swap operation:
 *
 *   - `amount`: amount to send while performing the optimal split (least proofs possible). can be set
 *       to undefined if preference is set.
 *   - Proofs proofs matching that amount.
 *   - OutputAmounts? optionally specify the output's amounts to keep and to send.
 *   - Counter? optionally set counter to derive secret deterministically. CashuWallet class must be
 *       initialized with seed phrase to take effect.
 *   - KeysetId? override the keysetId derived from the current mintKeys with a custom one. This should
 *       be a keyset that was fetched from the `/keysets` endpoint.
 *   - IncludeFees? include estimated fees for the receiver to receive the proofs.
 *   - ProofsWeHave? optionally provide all currently stored proofs of this mint. Cashu-ts will use them
 *       to derive the optimal output amounts.
 *   - Pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
 *   - Privkey? will create a signature on the proofs secrets if set.
 *   - `outputData` : Specify your own OutputData (blinded messages)
 *   - `p2pk` : Specify options to lock the proofs according to NUT-11.
 */
export type SwapOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	includeFees?: boolean;
	outputData?: {
		send?: OutputDataLike[] | OutputDataFactory;
		keep?: OutputDataLike[] | OutputDataFactory;
	};
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

export type RestoreOptions = {
	keysetId?: string;
	issuedFilter?: GCSFilter;
	spentFilter?: GCSFilter;
};

/**
 * @param {MintProofOptions} [options] - Optional parameters for configuring the Mint Proof
 *   operation:
 *
 *   - `keysetId`: override the keysetId derived from the current mintKeys with a custom one. This
 *       should be a keyset that was fetched from the `/keysets` endpoint.
 *   - `outputAmounts`: optionally specify the output's amounts to keep and to send.
 *   - `counter`: optionally set counter to derive secret deterministically. CashuWallet class must be
 *       initialized with seed phrase to take effect.
 *   - `proofsWeHave`: optionally provide all currently stored proofs of this mint. Cashu-ts will use
 *       them to derive the optimal output amounts.
 *   - `pubkey`: optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
 *   - `outputData` : Specify your own OutputData (blinded messages)
 *   - `p2pk` : Specify options to lock the proofs according to NUT-11.
 */
export type MintProofOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	outputData?: OutputDataLike[] | OutputDataFactory;
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof
 *   operation:
 *
 *   - `keysetId`: override the keysetId derived from the current mintKeys with a custom one. This
 *       should be a keyset that was fetched from the `/keysets` endpoint.
 *   - `counter`: optionally set counter to derive secret deterministically. CashuWallet class must be
 *       initialized with seed phrase to take effect.
 *   - `privkey`: will create a signature on the proofs secrets if set.
 */
export type MeltProofOptions = {
	keysetId?: string;
	counter?: number;
	privkey?: string;
};
// deprecated

export type InvoiceData = {
	paymentRequest: string;
	amountInSats?: number;
	amountInMSats?: number;
	timestamp?: number;
	paymentHash?: string;
	memo?: string;
	expiry?: number;
};

type RpcSubKinds = 'bolt11_mint_quote' | 'bolt11_melt_quote' | 'proof_state';

export type RpcSubId = string | number | null;

type JsonRpcParams = {
	subId?: string;
	payload?: unknown;
};

export type JsonRpcReqParams = {
	kind: RpcSubKinds;
	filters: string[];
	subId: string;
};

type JsonRpcSuccess<T = unknown> = {
	jsonrpc: '2.0';
	result: T;
	id: RpcSubId;
};

export type JsonRpcErrorObject = {
	code: number;
	message: string;
	data?: unknown;
};

type JsonRpcError = {
	jsonrpc: '2.0';
	error: JsonRpcErrorObject;
	id: RpcSubId;
};

type JsonRpcRequest = {
	jsonrpc: '2.0';
	method: 'sub';
	params: JsonRpcReqParams;
	id: Exclude<RpcSubId, null>;
};

export type JsonRpcNotification = {
	jsonrpc: '2.0';
	method: string;
	params?: JsonRpcParams;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError;
