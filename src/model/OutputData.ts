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
	verifyDLEQProof,
	type DLEQ,
} from '../crypto';
import { BlindedMessage } from './BlindedMessage';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { Bytes, numberToHexPadded64, splitAmount } from '../utils';
import { Amount, type AmountLike } from './Amount';

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
 * WARNING: In v4 we will fix the keyset type to `HasKeysetKeys` and remove the generic. Likewise,
 * we will change amount to `AmountLike`. v4 shape will be:
 *
 * `export type OutputDataFactory = (amount: AmountLike, keys: HasKeysetKeys) => OutputDataLike;`
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
	'sigflag',
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
		const A = pointFromHex(keyset.keys[sig.amount]);

		// NUT-12: Verify DLEQ proof if present
		if (dleq) {
			const B_ = pointFromHex(this.blindedMessage.B_);
			const C_ = pointFromHex(sig.C_);
			if (!verifyDLEQProof(dleq, B_, C_, A)) {
				throw new Error('DLEQ verification failed on mint response');
			}
		}

		const blindSignature = {
			id: sig.id,
			amount: sig.amount,
			C_: pointFromHex(sig.C_),
			dleq: dleq,
		};
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
		amount: AmountLike,
		keyset: T,
		customSplit?: AmountLike[],
	) {
		const amounts = splitAmount(amount, keyset.keys, customSplit).map((a) => Amount.from(a));
		return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
	}

	static createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string) {
		const amountValue = Amount.from(amount);
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
			const { blinded, Ehex: _E } = deriveP2BKBlindedPubkeys(ordered);
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
			new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);

		// stash Ehex - we add it to Proof later @see: toProof()
		if (p2pk.blindKeys && Ehex) setEphemeralE(od, Ehex);

		return od;
	}

	static createRandomData<T extends HasKeysetKeys>(
		amount: AmountLike,
		keyset: T,
		customSplit?: AmountLike[],
	) {
		const amounts = splitAmount(amount, keyset.keys, customSplit).map((a) => Amount.from(a));
		return amounts.map((a) => this.createSingleRandomData(a, keyset.id));
	}

	static createSingleRandomData(amount: AmountLike, keysetId: string) {
		const amountValue = Amount.from(amount);
		const randomHex = bytesToHex(randomBytes(32));
		const secretBytes = new TextEncoder().encode(randomHex);
		const { r, B_ } = blindMessage(secretBytes);
		return new OutputData(
			new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes,
		);
	}

	static createDeterministicData<T extends HasKeysetKeys>(
		amount: AmountLike,
		seed: Uint8Array,
		counter: number,
		keyset: T,
		customSplit?: AmountLike[],
	): OutputData[] {
		const amounts = splitAmount(amount, keyset.keys, customSplit).map((a) => Amount.from(a));
		return amounts.map((a, i) =>
			this.createSingleDeterministicData(a, seed, counter + i, keyset.id),
		);
	}

	/**
	 * @throws May throw if blinding factor is out of range. Caller should catch, increment counter,
	 *   and retry per BIP32-style derivation.
	 */
	static createSingleDeterministicData(
		amount: AmountLike,
		seed: Uint8Array,
		counter: number,
		keysetId: string,
	) {
		const amountValue = Amount.from(amount);
		const secretBytes = deriveSecret(seed, keysetId, counter);
		const secretBytesAsHex = bytesToHex(secretBytes);
		const utf8SecretBytes = new TextEncoder().encode(secretBytesAsHex);
		// Note: Bytes.toBigInt is used here so invalid values bubble up as throws
		// for BIP32-style retry logic (caller increments counter and retries).
		const deterministicR = Bytes.toBigInt(deriveBlindingFactor(seed, keysetId, counter));
		const { r, B_ } = blindMessage(utf8SecretBytes, deterministicR);
		return new OutputData(
			new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
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
	// TODO(v4): Move Number return types to Amount (breaking change)
	static sumOutputAmounts(outputs: OutputDataLike[]): number {
		return Amount.sum(outputs.map((output) => output.blindedMessage.amount)).toNumber();
	}
}
