import { Proof } from './index';
export type RawTransport = {
    t: PaymentRequestTransportType;
    a: string;
    g?: string[][];
};
export type RawNUT10Option = {
    k: string;
    d: string;
    t: string[][];
};
export type RawPaymentRequest = {
    i?: string;
    a?: number;
    u?: string;
    s?: boolean;
    m?: string[];
    d?: string;
    t?: RawTransport[];
    nut10?: RawNUT10Option;
};
export type PaymentRequestTransport = {
    type: PaymentRequestTransportType;
    target: string;
    tags?: string[][];
};
export declare enum PaymentRequestTransportType {
    POST = "post",
    NOSTR = "nostr"
}
export type PaymentRequestPayload = {
    id?: string;
    memo?: string;
    unit: string;
    mint: string;
    proofs: Proof[];
};
/**
 * Used to express a spending condition that proofs should be encumbered with.
 */
export type NUT10Option = {
    /**
     * The kind of spending condition.
     */
    kind: string;
    /**
     * Expresses the spending condition relative to the kind.
     */
    data: string;
    /**
     * Tags associated with the spending condition for additional data.
     */
    tags: string[][];
};
