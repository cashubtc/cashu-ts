import { assertValidTagKey, OutputData } from '../model/OutputData';
import { normalizePubkey, type P2PKOptions, type P2PKTag, type SigFlag } from '../crypto';

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
	private extraTags: P2PKTag[] = [];
	private _blindKeys?: boolean;
	private sigFlag?: SigFlag;
	private hashlock?: string;

	addLockPubkey(pk: string | string[]) {
		const arr = Array.isArray(pk) ? pk : [pk];
		for (const k of arr) this.lockSet.add(normalizePubkey(k));
		return this;
	}

	addRefundPubkey(pk: string | string[]) {
		const arr = Array.isArray(pk) ? pk : [pk];
		for (const k of arr) this.refundSet.add(normalizePubkey(k));
		return this;
	}

	lockUntil(when: Date | number) {
		this.locktime = toUnixSeconds(when);
		return this;
	}

	requireLockSignatures(n: number) {
		if (!Number.isInteger(n) || n < 1)
			throw new Error(`requiredSignatures (n_sigs) must be a positive integer, got ${n}`);
		this.nSigs = n;
		return this;
	}

	requireRefundSignatures(n: number) {
		if (!Number.isInteger(n) || n < 1)
			throw new Error(
				`requiredRefundSignatures (n_sigs_refund) must be a positive integer, got ${n}`,
			);
		this.nSigsRefund = n;
		return this;
	}

	addTag(key: string, values?: string[] | string) {
		assertValidTagKey(key); //  Validate key
		const vals = values === undefined ? [] : Array.isArray(values) ? values : [values];
		this.extraTags.push([key, ...vals.map(String)]); // all to strings
		return this;
	}

	addTags(tags: P2PKTag[]) {
		for (const [k, ...vals] of tags) this.addTag(k, vals);
		return this;
	}

	blindKeys() {
		this._blindKeys = true;
		return this;
	}

	sigAll() {
		this.sigFlag = 'SIG_ALL';
		return this;
	}

	/**
	 * Converts a `P2PK` output into a NUT-14 `HTLC` kind output.
	 */
	addHashlock(hashlock: string) {
		this.hashlock = hashlock;
		return this;
	}

	toOptions(): P2PKOptions {
		const locks = Array.from(this.lockSet);
		const refunds = Array.from(this.refundSet);

		if (locks.length === 0) throw new Error('At least one lock pubkey is required');

		const pubkey: string | string[] = locks.length === 1 ? locks[0] : locks;

		const p2pk: P2PKOptions = {
			pubkey,
			...(this.locktime !== undefined ? { locktime: this.locktime } : {}),
			...(refunds.length ? { refundKeys: refunds } : {}),
			...(this.nSigs && this.nSigs > 1 ? { requiredSignatures: this.nSigs } : {}),
			...(this.nSigsRefund && this.nSigsRefund > 1
				? { requiredRefundSignatures: this.nSigsRefund }
				: {}),
			...(this.extraTags.length ? { additionalTags: this.extraTags.slice() } : {}),
			...(this._blindKeys ? { blindKeys: true } : {}),
			...(this.sigFlag == 'SIG_ALL' ? { sigFlag: 'SIG_ALL' } : {}),
			...(this.hashlock ? { hashlock: this.hashlock } : {}),
		};

		// Ensure the secret is valid (not too long etc); also validates options
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
		if (opts.blindKeys) b.blindKeys();
		if (opts.sigFlag == 'SIG_ALL') b.sigAll();
		if (opts.hashlock) b.addHashlock(opts.hashlock);
		return b;
	}
}
