import { Proof } from './index';

export type RawTransport = {
	t: PaymentRequestTransportType; // type
	a: string; // target
	g?: Array<Array<string>>; // tags
};

export type RawPaymentRequest = {
	i?: string; // id
	a?: number; // amount
	u?: string; // unit
	s?: boolean; // single use
	m?: Array<string>; // mints
	d?: string; // description
	t: Array<RawTransport>; // transports
};

export type PaymentRequestTransport = {
	type: PaymentRequestTransportType;
	target: string;
	tags?: Array<Array<string>>;
};

export enum PaymentRequestTransportType {
	POST = 'post',
	NOSTR = 'nostr'
}

export type PaymentRequestPayload = {
	id?: string;
	memo?: string;
	unit: string;
	mint: string;
	proofs: Array<Proof>;
};
