import { RawPaymentRequest, NUT10Option, PaymentRequestTransport, PaymentRequestTransportType } from './types';
export declare class PaymentRequest {
    transport?: PaymentRequestTransport[] | undefined;
    id?: string | undefined;
    amount?: number | undefined;
    unit?: string | undefined;
    mints?: string[] | undefined;
    description?: string | undefined;
    singleUse: boolean;
    nut10?: NUT10Option | undefined;
    constructor(transport?: PaymentRequestTransport[] | undefined, id?: string | undefined, amount?: number | undefined, unit?: string | undefined, mints?: string[] | undefined, description?: string | undefined, singleUse?: boolean, nut10?: NUT10Option | undefined);
    toRawRequest(): RawPaymentRequest;
    toEncodedRequest(): string;
    getTransport(type: PaymentRequestTransportType): PaymentRequestTransport | undefined;
    static fromRawRequest(rawPaymentRequest: RawPaymentRequest): PaymentRequest;
    static fromEncodedRequest(encodedRequest: string): PaymentRequest;
}
