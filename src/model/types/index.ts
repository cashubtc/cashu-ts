export * from './mint/index';
export * from './wallet/index';

export type Preferences = {
	sendPreference: Array<AmountPreference>;
	keepPreference?: Array<AmountPreference>;
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
