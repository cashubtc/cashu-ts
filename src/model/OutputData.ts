import {
	type MintKeys,
	type Proof,
	type SerializedBlindedMessage,
	type SerializedBlindedSignature,
	type SerializedDLEQ,
} from './types';
import { blindMessage, constructProofFromPromise, serializeProof } from '../crypto/client/index';
import { BlindedMessage } from './BlindedMessage';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { type DLEQ, pointFromHex } from '../crypto/common/index';
import { bytesToNumber, numberToHexPadded64, splitAmount } from '../utils';
import { deriveBlindingFactor, deriveSecret } from '../crypto/client/NUT09';

export interface OutputDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	toProof: (signature: SerializedBlindedSignature, keyset: MintKeys) => Proof;
}

export type OutputDataFactory = (amount: number, keys: MintKeys) => OutputDataLike;

export function isOutputDataFactory(
	value: OutputData[] | OutputDataFactory,
): value is OutputDataFactory {
	return typeof value === 'function';
}

const RESERVED_P2PK_TAGS = new Set(['locktime', 'pubkeys', 'n_sigs', 'refund', 'n_sigs_refund']);
const MAX_SECRET_LENGTH = 1024;

export class OutputData implements OutputDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	constructor(blindedMessage: SerializedBlindedMessage, blidingFactor: bigint, secret: Uint8Array) {
		this.secret = secret;
		this.blindingFactor = blidingFactor;
		this.blindedMessage = blindedMessage;
	}

	toProof(sig: SerializedBlindedSignature, keyset: MintKeys) {
		let dleq: DLEQ | undefined;
		if (sig.dleq) {
			dleq = {
				s: hexToBytes(sig.dleq.s),
				e: hexToBytes(sig.dleq.e),
				r: this.blindingFactor,
			};
		}
		const blindSignature = {
			id: sig.id,
			amount: sig.amount,
			C_: pointFromHex(sig.C_),
			dleq: dleq,
		};
		const A = pointFromHex(keyset.keys[sig.amount]);
		const proof = constructProofFromPromise(blindSignature, this.blindingFactor, this.secret, A);
		const serializedProof = {
			...serializeProof(proof),
			...(dleq && {
				dleq: {
					s: bytesToHex(dleq.s),
					e: bytesToHex(dleq.e),
					r: numberToHexPadded64(dleq.r ?? BigInt(0)),
				} as SerializedDLEQ,
			}),
		} as Proof;
		return serializedProof;
	}

	static createP2PKData(
		p2pk: {
			pubkey: string | string[];
			locktime?: number;
			refundKeys?: string[];
			requiredSignatures?: number;
			requiredRefundSignatures?: number;
			additionalTags?: Array<[key: string, ...values: string[]]>;
		},
		amount: number,
		keyset: MintKeys,
		customSplit?: number[],
	) {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
	}

	static createSingleP2PKData(
		p2pk: {
			pubkey: string | string[];
			locktime?: number;
			refundKeys?: string[];
			requiredSignatures?: number;
			requiredRefundSignatures?: number;
			additionalTags?: Array<[key: string, ...values: string[]]>;
		},
		amount: number,
		keysetId: string,
	) {
		// normalise keys and clamp required signature counts to available keys
		const lockKeys: string[] = Array.isArray(p2pk.pubkey) ? p2pk.pubkey : [p2pk.pubkey];
		const refundKeys: string[] = p2pk.refundKeys ?? [];
		const reqLock = Math.max(1, Math.min(p2pk.requiredSignatures ?? 1, lockKeys.length));
		const reqRefund = Math.max(
			1,
			Math.min(p2pk.requiredRefundSignatures ?? 1, refundKeys.length || 1),
		);

		// Init vars
		const data = lockKeys[0];
		const pubkeys = lockKeys.slice(1);
		const refund = refundKeys;

		// build P2PK Tags (NUT-11)
		const tags: string[][] = [];

		const ts = p2pk.locktime ?? NaN;
		if (Number.isSafeInteger(ts) && ts >= 0) {
			tags.push(['locktime', String(ts)]);
		}

		if (pubkeys.length > 0) {
			tags.push(['pubkeys', ...pubkeys]);
			if (reqLock > 1) {
				tags.push(['n_sigs', String(reqLock)]);
			}
		}

		if (refund.length > 0) {
			tags.push(['refund', ...refund]);
			if (reqRefund > 1) {
				tags.push(['n_sigs_refund', String(reqRefund)]);
			}
		}

		// Append additional tags if any
		if (p2pk.additionalTags?.length) {
			const normalized = p2pk.additionalTags.map(([k, ...vals], i) => {
				if (typeof k !== 'string' || !k) {
					throw new Error(`additionalTags[${i}][0] must be a non empty string`);
				}
				if (RESERVED_P2PK_TAGS.has(k)) {
					throw new Error(`additionalTags must not use reserved key "${k}"`);
				}
				return [k, ...vals.map(String)]; // all to strings
			});
			tags.push(...normalized);
		}

		// Construct secret
		const newSecret: [string, { nonce: string; data: string; tags: string[][] }] = [
			'P2PK',
			{
				nonce: bytesToHex(randomBytes(32)),
				data: data,
				tags,
			},
		];
		const parsed = JSON.stringify(newSecret);

		// Check secret length, counting Unicode code points
		// Same semantics as Nutshell python: len(str)
		const charCount = [...parsed].length;
		if (charCount > MAX_SECRET_LENGTH) {
			throw new Error(`Secret too long (${charCount} characters), maximum is ${MAX_SECRET_LENGTH}`);
		}
		// blind the message
		const secretBytes = new TextEncoder().encode(parsed);
		const { r, B_ } = blindMessage(secretBytes);

		// create OutputData
		return new OutputData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);
	}

	static createRandomData(amount: number, keyset: MintKeys, customSplit?: number[]) {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a) => this.createSingleRandomData(a, keyset.id));
	}

	static createSingleRandomData(amount: number, keysetId: string) {
		const randomHex = bytesToHex(randomBytes(32));
		const secretBytes = new TextEncoder().encode(randomHex);
		const { r, B_ } = blindMessage(secretBytes);
		return new OutputData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);
	}

	static createDeterministicData(
		amount: number,
		seed: Uint8Array,
		counter: number,
		keyset: MintKeys,
		customSplit?: number[],
	): OutputData[] {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a, i) =>
			this.createSingleDeterministicData(a, seed, counter + i, keyset.id),
		);
	}

	static createSingleDeterministicData(
		amount: number,
		seed: Uint8Array,
		counter: number,
		keysetId: string,
	) {
		const secretBytes = deriveSecret(seed, keysetId, counter);
		const secretBytesAsHex = bytesToHex(secretBytes);
		const utf8SecretBytes = new TextEncoder().encode(secretBytesAsHex);
		const deterministicR = bytesToNumber(deriveBlindingFactor(seed, keysetId, counter));
		const { r, B_ } = blindMessage(utf8SecretBytes, deterministicR);
		return new OutputData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			utf8SecretBytes,
		);
	}
}
