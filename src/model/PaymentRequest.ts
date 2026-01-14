import { encodeBase64toUint8, decodeCBOR, encodeCBOR, Bytes } from '../utils';
import { decodeBech32mToBytes, encodeBech32m } from '../utils/bech32m';
import { decodeTLV, encodeTLV } from '../utils/tlv';
import type { DecodedTLVPaymentRequest, Nut10SpendingCondition } from '../utils/tlv';
import type {
	RawPaymentRequest,
	RawTransport,
	NUT10Option,
	PaymentRequestTransport,
	PaymentRequestTransportType,
} from '../wallet/types';

export class PaymentRequest {
	constructor(
		public transport?: PaymentRequestTransport[],
		public id?: string,
		public amount?: number,
		public unit?: string,
		public mints?: string[],
		public description?: string,
		public singleUse: boolean = false,
		public nut10?: NUT10Option,
	) {}

	toRawRequest() {
		const rawRequest: RawPaymentRequest = {};
		if (this.transport) {
			rawRequest.t = this.transport.map((t: PaymentRequestTransport) => ({
				t: t.type,
				a: t.target,
				g: t.tags,
			}));
		}
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
		if (this.singleUse) {
			rawRequest.s = this.singleUse;
		}
		if (this.nut10) {
			rawRequest.nut10 = {
				k: this.nut10.kind,
				d: this.nut10.data,
				t: this.nut10.tags,
			};
		}
		return rawRequest;
	}

	toEncodedRequest(): string {
		const rawRequest: RawPaymentRequest = this.toRawRequest();
		const data = encodeCBOR(rawRequest);
		const encodedData = Bytes.toBase64(data);
		return 'creq' + 'A' + encodedData;
	}

	/**
	 * Encodes the payment request to creqA format (CBOR).
	 *
	 * @returns A base64 encoded payment request string with 'creqA' prefix.
	 */
	toEncodedCreqA(): string {
		return this.toEncodedRequest();
	}

	/**
	 * Encodes the payment request to creqB format (TLV + bech32m).
	 *
	 * @returns A bech32m encoded payment request string with 'CREQB' prefix.
	 * @experimental
	 */
	toEncodedCreqB(): string {
		const tlvRequest: DecodedTLVPaymentRequest = {
			id: this.id,
			amount: this.amount !== undefined ? BigInt(this.amount) : undefined,
			unit: this.unit,
			singleUse: this.singleUse,
			mints: this.mints,
			description: this.description,
			transports: this.transport,
			nut10: this.nut10
				? [
						{
							kind: this.nut10.kind,
							data: this.nut10.data,
							tags: this.nut10.tags,
						} as Nut10SpendingCondition,
					]
				: undefined,
		};

		const tlvBytes = encodeTLV(tlvRequest);
		return encodeBech32m('creqb', tlvBytes).toUpperCase();
	}

	getTransport(type: PaymentRequestTransportType) {
		return this.transport?.find((t: PaymentRequestTransport) => t.type === type);
	}

	/**
	 * Creates a PaymentRequest from a raw payment request. Supports both creqA and creqB versions.
	 *
	 * @param rawPaymentRequest - The raw payment request string to create a PaymentRequest from.
	 * @returns A PaymentRequest object.
	 * @throws An error if the raw payment request is not supported.
	 */
	static fromRawRequest(rawPaymentRequest: RawPaymentRequest): PaymentRequest {
		const transports = rawPaymentRequest.t
			? rawPaymentRequest.t.map((t: RawTransport) => ({
					type: t.t,
					target: t.a,
					tags: t.g,
				}))
			: undefined;
		const nut10 = rawPaymentRequest.nut10
			? {
					kind: rawPaymentRequest.nut10.k,
					data: rawPaymentRequest.nut10.d,
					tags: rawPaymentRequest.nut10.t,
				}
			: undefined;
		return new PaymentRequest(
			transports,
			rawPaymentRequest.i,
			rawPaymentRequest.a,
			rawPaymentRequest.u,
			rawPaymentRequest.m,
			rawPaymentRequest.d,
			rawPaymentRequest.s,
			nut10,
		);
	}

	static fromEncodedRequest(encodedRequest: string): PaymentRequest {
		const lowerRequest = encodedRequest.toLowerCase();

		// Version B: bech32m + TLV encoding (creqb...)
		if (lowerRequest.startsWith('creqb')) {
			const data = decodeBech32mToBytes(lowerRequest);
			const decoded = decodeTLV(data);
			return new PaymentRequest(
				decoded.transports,
				decoded.id,
				decoded.amount !== undefined ? Number(decoded.amount) : undefined,
				decoded.unit,
				decoded.mints,
				decoded.description,
				decoded.singleUse ?? false,
				undefined,
			);
		}

		// Version A: CBOR encoding (creqA...)
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
		return this.fromRawRequest(decoded);
	}
}
