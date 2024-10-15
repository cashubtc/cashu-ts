import { encodeBase64toUint8 } from '../base64';
import { decodeCBOR, encodeCBOR } from '../cbor';
import { RawPaymentRequest, RawTransport, Transport } from './types';

export class PaymentRequest {
	constructor(
		public transport: Array<Transport>,
		public id?: string,
		public amount?: number,
		public unit?: string,
		public mints?: Array<string>,
		public description?: string,
	) { }

	toEncodedRequest() {
		const rawRequest: RawPaymentRequest = {
			t: this.transport.map((t: Transport) => ({ t: t.type, a: t.target }))
		};
		if (this.id) {
			rawRequest.i = this.id;
		}
		if (this.amount) {
			rawRequest.a = this.amount;
		}
		if (this.unit) {
			rawRequest.u = this.unit;
		}
		if (this.mints) {
			rawRequest.m = this.mints;
		}
		if (this.description) {
			rawRequest.d = this.description;
		}
		const data = encodeCBOR(rawRequest);
		const encodedData = Buffer.from(data).toString('base64url');
		return 'creq' + 'A' + encodedData;
	}

	static fromEncodedRequest(encodedRequest: string): PaymentRequest {
		const version = encodedRequest[4];
		if (version !== 'A') {
			throw new Error('unsupported version...');
		}
		const encodedData = encodedRequest.slice(5);
		const data = encodeBase64toUint8(encodedData);
		const decoded = decodeCBOR(data) as RawPaymentRequest;
		if (!decoded.m) {
			throw new Error('unsupported pr: memo undefined');
		}
		const transports = decoded.t.map((t: RawTransport) => ({ type: t.t, target: t.a }));
		return new PaymentRequest(
			transports,
			decoded.i,
			decoded.a,
			decoded.u,
			decoded.m,
			decoded.d,
		);
	}
}
