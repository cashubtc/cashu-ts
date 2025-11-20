import { describe, it, expect } from 'vitest';
import { P2PKBuilder, P2PKOptions } from '../../src/';

// helpers to make valid hex keys
const xonly = (ch: string) => ch.repeat(64); // 32-byte X-only
const comp = (ch: string, prefix: '02' | '03' = '02') => `${prefix}${ch.repeat(64)}`;

describe('P2PKBuilder.toOptions()', () => {
	it('returns single lock key as a string', () => {
		const opts = new P2PKBuilder().addLockPubkey(comp('a', '02')).toOptions();
		expect(typeof opts.pubkey).toBe('string');
		expect(opts.pubkey).toBe(comp('a', '02'));
	});

	it('returns multiple lock keys as an array and preserves insertion order', () => {
		const k1 = comp('a', '02');
		const k2 = comp('b', '03');
		const k3 = comp('c', '02');

		const opts = new P2PKBuilder().addLockPubkey([k1, k2]).addLockPubkey(k3).toOptions();

		expect(Array.isArray(opts.pubkey)).toBe(true);
		expect(opts.pubkey).toEqual([k1, k2, k3]);
	});

	it('normalises x-only lock keys to 02-prefixed compressed', () => {
		const x = xonly('1'); // 32-byte X-only
		const expected = comp('1', '02'); // normalised

		const opts = new P2PKBuilder().addLockPubkey(x).toOptions();
		expect(opts.pubkey).toBe(expected);
	});

	it('normalises x-only refund keys to 02-prefixed compressed', () => {
		const x = xonly('2');
		const expected = comp('2', '02');

		const opts = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.lockUntil(Date.now() + 60) // required when refund keys exist
			.addRefundPubkey(x)
			.toOptions();

		expect(opts.refundKeys).toEqual([expected]);
	});

	it('de-duplicates lock and refund keys silently', () => {
		const kA = comp('a', '02');
		const kB = comp('b', '03');

		const opts = new P2PKBuilder()
			.addLockPubkey([kA, kA, kB, kB])
			.lockUntil(Date.now() + 60)
			.addRefundPubkey([kA, kA, kB])
			.toOptions();

		// pubkey is array because >1
		expect(opts.pubkey).toEqual([kA, kB]);
		expect(opts.refundKeys).toEqual([kA, kB]);
	});

	it('throws when building with no lock pubkeys', () => {
		expect(() => new P2PKBuilder().toOptions()).toThrow(/At least one lock pubkey is required/i);
	});

	it('throws if refund keys are provided without locktime', () => {
		expect(() =>
			new P2PKBuilder().addLockPubkey(comp('a', '02')).addRefundPubkey(comp('b', '02')).toOptions(),
		).toThrow(/Refund pubkeys require a locktime/i);
	});

	it('accepts lockUntil as Date or number (unix seconds or ms)', () => {
		const nowSec = Math.floor(Date.now() / 1000) + 60;
		const nowMs = (nowSec + 60) * 1000;

		const o1 = new P2PKBuilder().addLockPubkey(comp('a', '02')).lockUntil(nowSec).toOptions();
		const o2 = new P2PKBuilder()
			.addLockPubkey(comp('b', '02'))
			.lockUntil(new Date(nowMs))
			.toOptions();

		expect(o1.locktime).toBeTypeOf('number');
		expect(o2.locktime).toBeTypeOf('number');
		expect(o2.locktime).toBe(nowSec + 60);
	});

	it('clamps requiredSignatures to available lock keys and omits when <= 1', () => {
		const k1 = comp('a', '02');
		const k2 = comp('b', '02');

		// ask for 5, only 2 available, expect 2
		const o1 = new P2PKBuilder().addLockPubkey([k1, k2]).requireLockSignatures(5).toOptions();
		expect(o1.requiredSignatures).toBe(2);

		// ask for 1 => property omitted (default 1)
		const o2 = new P2PKBuilder().addLockPubkey([k1, k2]).requireLockSignatures(1).toOptions();
		expect('requiredSignatures' in o2).toBe(false);
	});

	it('clamps requiredRefundSignatures to available refund keys and omits when <= 1', () => {
		const r1 = comp('c', '02');
		const r2 = comp('d', '03');

		const o1 = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.lockUntil(Date.now() + 60)
			.addRefundPubkey([r1, r2])
			.requireRefundSignatures(5)
			.toOptions();

		expect(o1.requiredRefundSignatures).toBe(2);

		const o2 = new P2PKBuilder()
			.addLockPubkey(comp('b', '02'))
			.lockUntil(Date.now() + 60)
			.addRefundPubkey([r1, r2])
			.requireRefundSignatures(1)
			.toOptions();

		expect('requiredRefundSignatures' in o2).toBe(false);
	});

	it('enforces combined lock+refund keys limit of 10', () => {
		// build 11 distinct keys
		const chars = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b'];
		const keys = chars.map((c, i) => comp(c as any, i % 2 === 0 ? '02' : '03'));

		const b = new P2PKBuilder()
			.addLockPubkey(keys.slice(0, 8)) // 8 locks
			.lockUntil(Date.now() + 60)
			.addRefundPubkey(keys.slice(8)); // 3 refunds => total 11

		expect(() => b.toOptions()).toThrow(/Too many pubkeys/i);
	});

	it('round-trips via fromOptions', () => {
		const original = new P2PKBuilder()
			.addLockPubkey([comp('a', '02'), comp('b', '03')])
			.lockUntil(Date.now() + 3600)
			.addRefundPubkey([comp('c', '02')])
			.requireLockSignatures(2)
			.requireRefundSignatures(1)
			.toOptions();

		const rebuilt = P2PKBuilder.fromOptions(original).toOptions();
		expect(rebuilt).toEqual(original);
	});

	it('fromOptions with minimal shape leaves required* undefined', () => {
		const minimal = { pubkey: '02' + 'b'.repeat(64) } as const;
		const round = P2PKBuilder.fromOptions(minimal).toOptions();
		expect(round).toEqual(minimal); // no extra props added
		expect('requiredSignatures' in round).toBe(false);
		expect('requiredRefundSignatures' in round).toBe(false);
		expect('locktime' in round).toBe(false);
		expect('refundKeys' in round).toBe(false);
	});

	it('fromOptions applies requiredRefundSignatures when provided', () => {
		const lock = '02' + 'e'.repeat(64);
		const r1 = '02' + 'f'.repeat(64);
		const r2 = '03' + 'g'.repeat(64);
		const now = Math.floor(Date.now() / 1000) + 300;

		const src = {
			pubkey: lock,
			locktime: now,
			refundKeys: [r1, r2] as string[],
			requiredRefundSignatures: 2,
		} as P2PKOptions;

		const out = P2PKBuilder.fromOptions(src).toOptions();
		expect(out.requiredRefundSignatures).toBe(2);
		expect(out.refundKeys).toEqual([r1, r2]);
		expect(out.locktime).toBe(now);
	});

	it('rejects invalid pubkey formats up front', () => {
		expect(() => new P2PKBuilder().addLockPubkey('zz')).toThrow(/Invalid pubkey/i);
	});
});

describe('P2PKBuilder, simple fuzzish case', () => {
	it('normalises mixed inputs, de duplicates, preserves insertion order, clamps counts, and stays canonical', () => {
		// locks contain, x only upper, compressed upper, duplicates of x only in both forms
		const xA_upper = 'A'.repeat(64); // x only, becomes 02 + a…
		const cB_upper = '02' + 'B'.repeat(64); // compressed, becomes 02 + b…
		const xA_lower = 'a'.repeat(64); // duplicate of xA
		const cA_again = '02' + 'A'.repeat(64); // duplicate after normalisation

		// refunds contain, compressed 03 with upper hex, x only that collides with 02 form, and duplicate 02 form
		const r03C_upper = '03' + 'C'.repeat(64); // becomes 03 + c…
		const rXc_lower = 'c'.repeat(64); // x only, becomes 02 + c…
		const r02c_dup = '02' + 'c'.repeat(64); // duplicate of previous after normalisation

		const ms = (Math.floor(Date.now() / 1000) + 123) * 1000; // exercise ms branch

		const opts = new P2PKBuilder()
			.addLockPubkey([xA_upper, cB_upper, xA_lower, cA_again])
			.addRefundPubkey([r03C_upper, rXc_lower, r02c_dup])
			.lockUntil(ms)
			.requireLockSignatures(5) // clamp to unique lock count
			.requireRefundSignatures(1) // omitted when <= 1
			.toOptions();

		// expected, all lower case, x only normalised to 02 prefix, duplicates removed, order preserved
		const expLocks = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
		const expRefunds = ['03' + 'c'.repeat(64), '02' + 'c'.repeat(64)];

		expect(Array.isArray(opts.pubkey)).toBe(true);
		expect(opts.pubkey).toEqual(expLocks);
		expect(opts.refundKeys).toEqual(expRefunds);
		expect(opts.locktime).toBe(ms / 1000); // ms to seconds

		// clamp, two unique lock keys
		expect(opts.requiredSignatures).toBe(2);
		expect('requiredRefundSignatures' in opts).toBe(false);

		// round trip stays identical
		const round = P2PKBuilder.fromOptions(opts).toOptions();
		expect(round).toEqual(opts);
	});
});

describe('P2PKBuilder addTag and addTags', () => {
	it('omits additionalTags when unused', () => {
		const opts = new P2PKBuilder().addLockPubkey(comp('a', '02')).toOptions();
		expect('additionalTags' in opts).toBe(false);
	});

	it('adds a single tag with no values', () => {
		const opts = new P2PKBuilder().addLockPubkey(comp('a', '02')).addTag('memo').toOptions();

		expect(opts.additionalTags).toEqual([['memo']]);
	});

	it('adds a single tag with one value', () => {
		const opts = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.addTag('memo', 'invoice-42')
			.toOptions();

		expect(opts.additionalTags).toEqual([['memo', 'invoice-42']]);
	});

	it('adds a single tag with multiple values and preserves order', () => {
		const opts = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.addTag('meta', ['region=eu', 'channel=web', 'v=1'])
			.toOptions();

		expect(opts.additionalTags).toEqual([['meta', 'region=eu', 'channel=web', 'v=1']]);
	});

	it('accepts multiple calls to addTag and addTags, preserves insertion order', () => {
		const opts = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.addTag('a', '1')
			.addTags([['b', '2'], ['c']])
			.addTag('d', ['3', '4'])
			.toOptions();

		expect(opts.additionalTags).toEqual([['a', '1'], ['b', '2'], ['c'], ['d', '3', '4']]);
	});

	it('allows duplicate non reserved keys, preserves both entries', () => {
		const opts = new P2PKBuilder()
			.addLockPubkey(comp('a', '02'))
			.addTag('note', 'x')
			.addTag('note', 'y')
			.toOptions();

		expect(opts.additionalTags).toEqual([
			['note', 'x'],
			['note', 'y'],
		]);
	});

	it('rejects reserved keys in addTag', () => {
		const b = new P2PKBuilder().addLockPubkey(comp('a', '02'));
		expect(() => b.addTag('locktime', '123')).toThrow(/reserved/i);
		expect(() => b.addTag('pubkeys', ['x'])).toThrow(/reserved/i);
		expect(() => b.addTag('n_sigs', '2')).toThrow(/reserved/i);
		expect(() => b.addTag('refund', 'x')).toThrow(/reserved/i);
		expect(() => b.addTag('n_sigs_refund', '2')).toThrow(/reserved/i);
	});

	it('rejects reserved keys in addTags', () => {
		const b = new P2PKBuilder().addLockPubkey(comp('a', '02'));
		expect(() => b.addTags([['pubkeys', 'x']])).toThrow(/reserved/i);
	});

	it('rejects empty tag key', () => {
		const b = new P2PKBuilder().addLockPubkey(comp('a', '02'));
		expect(() => b.addTag('', 'v')).toThrow(/key must be a non empty string/i);
	});

	it('round trips additionalTags via fromOptions', () => {
		const original = new P2PKBuilder()
			.addLockPubkey([comp('a', '02'), comp('b', '03')])
			.addTag('memo', 'invoice-007')
			.addTags([
				['purpose', 'donation'],
				['meta', 'env=prod', 'ver=2'],
			])
			.toOptions();

		const rebuilt = P2PKBuilder.fromOptions(original).toOptions();
		expect(rebuilt).toEqual(original);
	});

	it('fromOptions accepts options with additionalTags only and leaves shape untouched', () => {
		const minimalWithTags: P2PKOptions = {
			pubkey: comp('a', '02'),
			additionalTags: [['x'], ['y', '1'], ['z', 'a', 'b']],
		};

		const round = P2PKBuilder.fromOptions(minimalWithTags).toOptions();
		expect(round).toEqual(minimalWithTags);
	});
	it('throws if a reserved key is set in additionalTags', () => {
		const b = new P2PKBuilder().addLockPubkey(comp('a', '02'));
		expect(() => b.addTag('refund', comp('b', '02'))).toThrow(/must not use reserved key/i);
	});
	it('throws if secret is too long', () => {
		const b = new P2PKBuilder().addLockPubkey(comp('a', '02'));
		// add 10
		for (let i = 0; i < 12; i++) {
			b.addTag(`k${i}`, comp('a', '02'));
		}
		expect(() => b.toOptions()).toThrow(/Secret too long/i);
	});
});

describe('P2PKBuilder.blindKeys()', () => {
	it('sets blindKeys flag and round-trips via fromOptions', () => {
		const k = '02' + 'a'.repeat(64);
		const opts = new P2PKBuilder().addLockPubkey(k).blindKeys().toOptions();
		expect(opts.blindKeys).toBe(true);

		const round = P2PKBuilder.fromOptions(opts).toOptions();
		expect(round.blindKeys).toBe(true);
	});
});
