export const MintQuoteState = {
	UNPAID: 'UNPAID',
	PAID: 'PAID',
	ISSUED: 'ISSUED',
} as const;
export type MintQuoteState = (typeof MintQuoteState)[keyof typeof MintQuoteState];
