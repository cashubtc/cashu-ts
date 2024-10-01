export * from './mint/index';
export * from './wallet/index';

export type OutputAmounts = {
	sendAmounts: Array<number>;
	keepAmounts?: Array<number>;
};

// deprecated
export type AmountPreference = {
	amount: number;
	count: number;
};

export type InvoiceData = {
	paymentRequest: string;
	amountInSats?: number;
	amountInMSats?: number;
	timestamp?: number;
	paymentHash?: string;
	memo?: string;
	expiry?: number;
};
