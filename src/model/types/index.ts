export * from './mint/index';
export * from './wallet/index';

export type OutputAmounts = {
	sendAmounts: Array<number>;
	keepAmounts?: Array<number>;
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

export type RpcSubId = string | number | null;

type JsonRpcParams = any;

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
	method: string;
	params?: JsonRpcParams;
	id: Exclude<RpcSubId, null>;
};

type JsonRpcNotification = {
	jsonrpc: '2.0';
	method: string;
	params?: JsonRpcParams;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError;
