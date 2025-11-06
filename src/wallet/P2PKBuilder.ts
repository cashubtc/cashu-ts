import { OutputData, RESERVED_P2PK_TAGS } from '../model/OutputData';
import { type P2PKOptions, type TagTuple } from './types/config';

// Accept 33 byte compressed (02|03...), or 32 byte x-only,
// normalised to lowercase 33 byte with 02 prefix for x only
function normalisePubkey(pk: string): string {
	const hex = pk.toLowerCase();
	if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) return hex;
	if (hex.length === 64) return `02${hex}`;
	throw new Error(
		`Invalid pubkey, expected 33 byte compressed or 32 byte x only, got length ${hex.length}`,
	);
}

function toUnixSeconds(input: Date | number): number {
	if (input instanceof Date) return Math.floor(input.getTime() / 1000);
	return input < 1e12 ? Math.floor(input) : Math.floor(input / 1000); // > 1e12 = ms
}

export class P2PKBuilder {
	// A Set enforces uniqueness and preserves insertion order, which means
	// the first added lock key also becomes primary (data) pubkey
	private lockSet = new Set<string>();
	private refundSet = new Set<string>();
	private locktime?: number;
	private nSigs?: number;
	private nSigsRefund?: number;
	private extraTags: TagTuple[] = [];

	addLockPubkey(pk: string | string[]) {
		const arr = Array.isArray(pk) ? pk : [pk];
		for (const k of arr) this.lockSet.add(normalisePubkey(k));
		return this;
	}

	addRefundPubkey(pk: string | string[]) {
		const arr = Array.isArray(pk) ? pk : [pk];
		for (const k of arr) this.refundSet.add(normalisePubkey(k));
		return this;
	}

	lockUntil(when: Date | number) {
		this.locktime = toUnixSeconds(when);
		return this;
	}

	requireLockSignatures(n: number) {
		this.nSigs = Math.max(1, Math.trunc(n));
		return this;
	}

	requireRefundSignatures(n: number) {
		this.nSigsRefund = Math.max(1, Math.trunc(n));
		return this;
	}

	addTag(key: string, values?: string[] | string) {
		if (!key || typeof key !== 'string') throw new Error('tag key must be a non empty string');
		if (RESERVED_P2PK_TAGS.has(key)) {
			throw new Error(`tag key "${key}" is reserved. Use appropriate builder option.`);
		}
		const vals = values === undefined ? [] : Array.isArray(values) ? values : [values];
		this.extraTags.push([key, ...vals.map(String)]); // all to strings
		return this;
	}

	addTags(tags: TagTuple[]) {
		for (const [k, ...vals] of tags) this.addTag(k, vals);
		return this;
	}

	toOptions(): P2PKOptions {
		const locks = Array.from(this.lockSet);
		const refunds = Array.from(this.refundSet);

		if (locks.length === 0) throw new Error('At least one lock pubkey is required');
		if (refunds.length > 0 && this.locktime === undefined) {
			throw new Error(
				'Refund pubkeys require a locktime, add lockUntil(...) or remove refund keys',
			);
		}

		const total = locks.length + refunds.length;
		if (total > 10)
			throw new Error(`Too many pubkeys, ${total} provided, maximum allowed is 10 in total`);

		// Clamp required signatures to available keys
		const reqLock = this.nSigs ? Math.min(Math.max(1, this.nSigs), locks.length) : undefined;
		const reqRefund = this.nSigsRefund
			? Math.min(Math.max(1, this.nSigsRefund), Math.max(1, refunds.length))
			: undefined;

		const pubkey: string | string[] = locks.length === 1 ? locks[0] : locks;

		const p2pk: P2PKOptions = {
			pubkey,
			...(this.locktime !== undefined ? { locktime: this.locktime } : {}),
			...(refunds.length ? { refundKeys: refunds } : {}),
			...(reqLock && reqLock > 1 ? { requiredSignatures: reqLock } : {}),
			...(reqRefund && reqRefund > 1 ? { requiredRefundSignatures: reqRefund } : {}),
			...(this.extraTags.length ? { additionalTags: this.extraTags.slice() } : {}),
		};

		// Ensure the secret is valid (not too long etc)
		const smokeTest = OutputData.createSingleP2PKData(p2pk, 1, 'deedbeef');
		void smokeTest; // intentionally unused

		return p2pk;
	}

	static fromOptions(opts: P2PKOptions): P2PKBuilder {
		const b = new P2PKBuilder();
		const locks = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
		b.addLockPubkey(locks);
		if (opts.locktime !== undefined) b.lockUntil(opts.locktime);
		if (opts.refundKeys?.length) b.addRefundPubkey(opts.refundKeys);
		if (opts.requiredSignatures !== undefined) b.requireLockSignatures(opts.requiredSignatures);
		if (opts.requiredRefundSignatures !== undefined)
			b.requireRefundSignatures(opts.requiredRefundSignatures);
		if (opts.additionalTags?.length) b.addTags(opts.additionalTags);
		return b;
	}
}
