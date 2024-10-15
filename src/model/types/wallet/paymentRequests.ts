export type RawTransport = {
    t: PaymentRequestTransportType;
    a: string;
    g?: Array<Array<string>>;
};

export type RawPaymentRequest = {
    i?: string;
    a?: number;
    u?: string;
    r?: boolean;
    m?: Array<string>;
    d?: string;
    t: Array<RawTransport>;
};

export type Transport = {
    type: PaymentRequestTransportType;
    target: string;
    tags?: Array<Array<string>>;
};

export enum PaymentRequestTransportType {
    POST = 'post',
    NOSTR = 'nostr',
}