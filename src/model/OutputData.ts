import {
	type HasKeysetKeys,
	type Proof,
	type SerializedBlindedMessage,
	type SerializedBlindedSignature,
	type SerializedDLEQ,
} from './types';
import { type P2PKOptions } from '../wallet';
import {
	blindMessage,
	constructProofFromPromise,
	deriveP2BKBlindedPubkeys,
	deriveBlindingFactor,
	deriveSecret,
	pointFromHex,
	serializeProof,
	type DLEQ,
} from '../crypto';
import { BlindedMessage } from './BlindedMessage';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { bytesToNumber, numberToHexPadded64, splitAmount } from '../utils';

// TODO(v4): Consider removing the generic and fixing `keyset` to `HasKeysetKeys`.
// For now the generic preserves the relationship between factory input type and `toProof` keyset type,
// and keeps narrower implementations assignable under `strictFunctionTypes`.

/**
 * Note: OutputData helpers only require keyset `id` and `keys`. If you want richer keyset typing at
 * the call site, use `OutputDataLike<YourType>`.
 *
 * @remarks
 * WARNING: In v4 we may simplify this further by fixing the keyset type to `HasKeysetKeys` and
 * removing the generic.
 */
export interface OutputDataLike<TKeyset extends HasKeysetKeys = HasKeysetKeys> {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	toProof: (signature: SerializedBlindedSignature, keyset: TKeyset) => Proof;
}

/**
 * Note: OutputData helpers only require keyset `id` and `keys`. If you want richer keyset typing at
 * the call site, use `OutputDataLike<YourType>`.
 *
 * @remarks
 * WARNING: In v4 we may simplify this further by fixing the keyset type to `HasKeysetKeys` and
 * removing the generic.
 */
export type OutputDataFactory<TKeyset extends HasKeysetKeys = HasKeysetKeys> = (
	amount: number,
	keys: TKeyset,
) => OutputDataLike<TKeyset>;

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
 * Asserts P2PK Tag key is valid.
 *
 * @param key Tag Key.
 * @throws If not a string, or is a reserved string.
 */
export function assertValidTagKey(key: string) {
	if (!key || typeof key !== 'string') throw new Error('tag key must be a non empty string');
	if (RESERVED_P2PK_TAGS.has(key)) {
		throw new Error(`additionalTags must not use reserved key "${key}"`);
	}
}

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

// Holds the map of Pubkey blinding factors for a given OutputData
// This avoids changing the shape of the OutputDataLike interface
const EPHEMERAL_E = new WeakMap<OutputData, string>(); // one-shot
function setEphemeralE(target: OutputData, Ehex?: string) {
	if (Ehex) EPHEMERAL_E.set(target, Ehex);
}
function takeEphemeralE(target: OutputData): string | undefined {
	const e = EPHEMERAL_E.get(target);
	if (!e) return;
	EPHEMERAL_E.delete(target); // one-shot to avoid leakage
	return e;
}

export class OutputData implements OutputDataLike<HasKeysetKeys> {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	constructor(
		blindedMessage: SerializedBlindedMessage,
		blindingFactor: bigint,
		secret: Uint8Array,
	) {
		this.secret = secret;
		this.blindingFactor = blindingFactor;
		this.blindedMessage = blindedMessage;
	}

	toProof(sig: SerializedBlindedSignature, keyset: HasKeysetKeys) {
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

		// Add P2BK (Pay to Blinded Key) blinding factors if needed
		const Ehex = takeEphemeralE(this);
		if (Ehex) serializedProof.p2pk_e = Ehex;

		return serializedProof;
	}

	static createP2PKData<T extends HasKeysetKeys>(
		p2pk: P2PKOptions,
		amount: number,
		keyset: T,
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
		// Sanity check - we always need at least one locking key
		if (lockKeys.length === 0) {
			throw new Error('P2PK requires at least one pubkey');
		}

		// Init vars
		const isHTLC = typeof p2pk.hashlock === 'string' && p2pk.hashlock.length > 0;
		let data = isHTLC ? (p2pk.hashlock as string) : lockKeys[0];
		let pubkeys = isHTLC ? lockKeys : lockKeys.slice(1);
		let refund = refundKeys;

		// Optional key blinding (P2BK)
		let Ehex: string | undefined;
		if (p2pk.blindKeys) {
			const ordered = [...lockKeys, ...refundKeys];
			const { blinded, Ehex: _E } = deriveP2BKBlindedPubkeys(ordered, keysetId);
			if (isHTLC) {
				// hashlock is in data, all locking keys into pubkeys
				pubkeys = blinded.slice(0, lockKeys.length);
			} else {
				// first locking key in data, rest into pubkeys
				data = blinded[0];
				pubkeys = blinded.slice(1, lockKeys.length);
			}
			refund = blinded.slice(lockKeys.length);
			Ehex = _E;
		}

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

		if (p2pk.sigFlag == 'SIG_ALL') {
			tags.push(['sigflag', 'SIG_ALL']);
		}

		// Append additional tags if any
		if (p2pk.additionalTags?.length) {
			const normalized = p2pk.additionalTags.map(([k, ...vals]) => {
				assertValidTagKey(k); // Validate key
				return [k, ...vals.map(String)]; // all to strings
			});
			tags.push(...normalized);
		}

		// Construct secret
		const kind = isHTLC ? 'HTLC' : 'P2PK';
		const newSecret: [string, { nonce: string; data: string; tags: string[][] }] = [
			kind,
			{
				nonce: bytesToHex(randomBytes(32)),
				data,
				tags,
			},
		];

		// blind the message
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
		const od = new OutputData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);

		// stash Ehex - we add it to Proof later @see: toProof()
		if (p2pk.blindKeys && Ehex) setEphemeralE(od, Ehex);

		return od;
	}

	static createRandomData<T extends HasKeysetKeys>(
		amount: number,
		keyset: T,
		customSplit?: number[],
	) {
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

	static createDeterministicData<T extends HasKeysetKeys>(
		amount: number,
		seed: Uint8Array,
		counter: number,
		keyset: T,
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
