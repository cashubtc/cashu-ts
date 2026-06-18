/**
 * NUT-17 subscription kinds.
 *
 * `mint_quote` / `melt_quote` are the method-agnostic kinds; the per-method forms are what mints
 * advertise today. Custom payment methods may use further `<method>_mint_quote` /
 * `<method>_melt_quote` kinds that the wallet forwards but does not enumerate here.
 */
export type RpcSubKinds =
  | 'mint_quote'
  | 'melt_quote'
  | 'proof_state'
  | 'bolt11_mint_quote'
  | 'bolt11_melt_quote'
  | 'bolt12_mint_quote'
  | 'bolt12_melt_quote';
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
