import { encodeBase64toUint8 } from '../base64';
import { decodeCBOR, encodeCBOR } from '../cbor';
import { RawPaymentRequest, Transport } from './types';

export class PaymentRequest {
	constructor(
		public unit: string,
		public transport: Array<Transport>,
		public memo: string,
		public amount?: number,
		public mint?: string,
		public description?: string,
		public lock?: string
	) {}

	toEncodedRequest() {
		const rawRequest: RawPaymentRequest = {
			u: this.unit,
			t: this.transport.map((t) => ({ t: t.type, a: t.target }))
		};
		if (this.lock) {
			rawRequest.l = this.lock;
		}
		if (this.memo) {
			rawRequest.m = this.memo;
		}
		if (this.mint) {
			rawRequest.r = this.mint;
		}
		if (this.amount) {
			rawRequest.a = this.amount;
		}
		if (this.description) {
			rawRequest.d = this.description;
		}
		const data = encodeCBOR(rawRequest);
		const encodedData = Buffer.from(data).toString('base64');
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
		const transports = decoded.t.map((t) => ({ type: t.t, target: t.a }));
		return new PaymentRequest(
			decoded.u,
			transports,
			decoded.m,
			decoded.a,
			decoded.r,
			decoded.d,
			decoded.l
		);
	}
}
