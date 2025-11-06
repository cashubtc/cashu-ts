import {
	type MintKeys,
	type Proof,
	type SerializedBlindedMessage,
	type SerializedBlindedSignature,
	type SerializedDLEQ,
} from './types';
import { type P2PKOptions, type Keyset } from '../wallet';
import {
	blindMessage,
	constructProofFromPromise,
	serializeProof,
	deriveBlindingFactor,
	deriveSecret,
	type DLEQ,
	pointFromHex,
} from '../crypto';
import { BlindedMessage } from './BlindedMessage';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { bytesToNumber, numberToHexPadded64, splitAmount } from '../utils';

export interface OutputDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	toProof: (signature: SerializedBlindedSignature, keyset: MintKeys | Keyset) => Proof;
}

export type OutputDataFactory = (amount: number, keys: MintKeys | Keyset) => OutputDataLike;

/**
 * Core P2PK tags that must not be settable in additional tags.
 *
 * @internal
 */
export const RESERVED_P2PK_TAGS = new Set([
	'locktime',
	'pubkeys',
	'n_sigs',
	'refund',
	'n_sigs_refund',
]);

/**
 * Maximum secret length.
 *
 * @remarks
 * Based on the Nutshell default mint_max_secret_length.
 * @internal
 */
export const MAX_SECRET_LENGTH = 1024;

export function isOutputDataFactory(
	value: OutputData[] | OutputDataFactory,
): value is OutputDataFactory {
	return typeof value === 'function';
}

export class OutputData implements OutputDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	constructor(blindedMessage: SerializedBlindedMessage, blidingFactor: bigint, secret: Uint8Array) {
		this.secret = secret;
		this.blindingFactor = blidingFactor;
		this.blindedMessage = blindedMessage;
	}

	toProof(sig: SerializedBlindedSignature, keyset: MintKeys | Keyset) {
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
		p2pk: P2PKOptions,
		amount: number,
		keyset: MintKeys | Keyset,
		customSplit?: number[],
	) {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
	}

	static createSingleP2PKData(p2pk: P2PKOptions, amount: number, keysetId: string) {
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

		if (p2pk.locktime !== undefined) {
			tags.push(['locktime', String(p2pk.locktime)]);
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
			for (const [k] of p2pk.additionalTags) {
				if (RESERVED_P2PK_TAGS.has(k)) {
					throw new Error(`additionalTags must not use reserved key "${k}"`);
				}
			}
			tags.push(...p2pk.additionalTags);
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

		// blind the message
		const parsed = JSON.stringify(newSecret);
		if (parsed.length > MAX_SECRET_LENGTH) {
			throw new Error(
				`Secret too long (${parsed.length} characters), maximum is ${MAX_SECRET_LENGTH}`,
			);
		}
		const secretBytes = new TextEncoder().encode(parsed);
		const { r, B_ } = blindMessage(secretBytes);

		// create OutputData
		const od = new OutputData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);
		return od;
	}

	static createRandomData(amount: number, keyset: MintKeys | Keyset, customSplit?: number[]) {
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
		keyset: MintKeys | Keyset,
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

	/**
	 * Calculates the sum of amounts in an array of OutputDataLike objects.
	 *
	 * @param outputs Array of OutputDataLike objects.
	 * @returns The total sum of amounts.
	 */
	static sumOutputAmounts(outputs: OutputDataLike[]): number {
		return outputs.reduce((sum, output) => sum + output.blindedMessage.amount, 0);
	}
}
