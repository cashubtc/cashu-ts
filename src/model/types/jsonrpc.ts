// NUT-17 names a quote kind per payment method (`bolt11_mint_quote`, `bolt12_melt_quote`, ...)
export type RpcSubKinds = 'proof_state' | `${string}_mint_quote` | `${string}_melt_quote`;
export type RpcSubId = string | number | null;

export type JsonRpcParams = {
  subId?: string;
  payload?: unknown;
};

export type JsonRpcReqParams = {
  kind: RpcSubKinds;
  filters: string[];
  subId: string;
};

export type JsonRpcSuccess<T = unknown> = {
  jsonrpc: '2.0';
  result: T;
  id: RpcSubId;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcError = {
  jsonrpc: '2.0';
  error: JsonRpcErrorObject;
  id: RpcSubId;
};

export type JsonRpcRequest = {
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
