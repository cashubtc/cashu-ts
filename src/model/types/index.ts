export * from './mint/index';
export * from './wallet/index';

export type InvoiceData = {
	paymentRequest: string;
	amountInSats?: number;
	amountInMSats?: number;
	timestamp?: number;
	paymentHash?: string;
	memo?: string;
	expiry?: number;
};

export type V4ProofTemplate = {
	a: number;
	s: string;
	c: Uint8Array;
};

export type V4InnerToken = {
	i: Uint8Array;
	p: Array<V4ProofTemplate>;
};

export type TokenV4Template = {
	t: Array<V4InnerToken>;
	d: string;
	m: string;
	u: string;
};
