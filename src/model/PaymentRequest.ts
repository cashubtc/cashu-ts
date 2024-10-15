import { encodeBase64toUint8 } from '../base64';
import { decodeCBOR, encodeCBOR } from '../cbor';
import {
	RawPaymentRequest,
	RawTransport,
	PaymentRequestTransport,
	PaymentRequestTransportType,
	PaymentRequestTag
} from './types';
import { Buffer } from 'buffer';

export class PaymentRequest {
	private tags: Map<string, string>;

	constructor(
		public transport: Array<PaymentRequestTransport>,
		public id?: string,
		public amount?: number,
		public unit?: string,
		public mints?: Array<string>,
		public description?: string
	) {
		this.tags = new Map();
		this.transport.forEach((t: PaymentRequestTransport) => {
			if (t.tags) {
				t.tags.forEach((tag: PaymentRequestTag) => {
					if (Array.isArray(tag) && tag.length === 2) {
						this.tags.set(tag[0], tag[1]);
					} else {
						throw new Error('invalid tag');
					}
				});
			}
		});
	}

	toEncodedRequest() {
		const rawRequest: RawPaymentRequest = {
			t: this.transport.map((t: PaymentRequestTransport) => ({ t: t.type, a: t.target }))
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
		const encodedData = Buffer.from(data).toString('base64');
		return 'creq' + 'A' + encodedData;
	}

	getTransport(type: PaymentRequestTransportType) {
		return this.transport.find((t: PaymentRequestTransport) => t.type === type);
	}

	getTag(tag: string) {
		return this.tags.get(tag);
	}

	static fromEncodedRequest(encodedRequest: string): PaymentRequest {
		if (!encodedRequest.startsWith('creq')) {
			throw new Error('unsupported pr: invalid prefix');
		}
		const version = encodedRequest[4];
		if (version !== 'A') {
			throw new Error('unsupported pr version');
		}
		const encodedData = encodedRequest.slice(5);
		const data = encodeBase64toUint8(encodedData);
		const decoded = decodeCBOR(data) as RawPaymentRequest;
		const transports = decoded.t.map((t: RawTransport) => ({ type: t.t, target: t.a, tags: t.g }));
		return new PaymentRequest(transports, decoded.i, decoded.a, decoded.u, decoded.m, decoded.d);
	}
}
