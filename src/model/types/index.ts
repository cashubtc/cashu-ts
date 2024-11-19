import { Proof } from './wallet/index';

export * from './mint/index';
export * from './wallet/index';

export type OutputAmounts = {
	sendAmounts: Array<number>;
	keepAmounts?: Array<number>;
};

export type ReceiveOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Array<Proof>;
	counter?: number;
	pubkey?: string;
	privkey?: string;
	requireDleq?: boolean;
};

export type SendOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Array<Proof>;
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	offline?: boolean;
	includeFees?: boolean;
	includeDleq?: boolean;
};

export type SwapOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Array<Proof>;
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	includeFees?: boolean;
};

export type RestoreOptions = {
	keysetId?: string;
};

export type MintProofOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Array<Proof>;
	counter?: number;
	pubkey?: string;
};

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

type JsonRpcParams = any;

export type JsonRpcReqParams = {
	kind: RpcSubKinds;
	filters: Array<string>;
	subId: string;
};

type JsonRpcSuccess<T = any> = {
	jsonrpc: '2.0';
	result: T;
	id: RpcSubId;
};

export type JsonRpcErrorObject = {
	code: number;
	message: string;
	data?: any;
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
