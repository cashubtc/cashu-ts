import { describe, it, expect } from 'vitest';

import { P2PKBuilder, type P2PKOptions } from '../../src/';

// helpers to make valid hex keys
const xonly = (ch: string) => ch.repeat(64); // 32-byte X-only
const comp = (ch: string, prefix: '02' | '03' = '02') => `${prefix}${ch.repeat(64)}`;
// a valid 64-char hex hashlock (SHA-256 output shape)
const hashlock = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';

describe('P2PKBuilder.toOptions()', () => {
  it('returns single lock key as a string', () => {
    const opts = new P2PKBuilder().addLockPubkey(comp('a', '02')).toOptions();
    expect(typeof opts.data).toBe('string');
    expect(opts.data).toBe(comp('a', '02'));
  });

  it('splits multiple lock keys into a single data key + pubkeys tag, preserving order', () => {
    const k1 = comp('a', '02');
    const k2 = comp('b', '03');
    const k3 = comp('c', '02');

    const opts = new P2PKBuilder().addLockPubkey([k1, k2]).addLockPubkey(k3).toOptions();

    // First key is the NUT-10 data slot; the rest ride the optional pubkeys tag.
    expect(opts.data).toBe(k1);
    expect(opts.pubkeys).toEqual([k2, k3]);
  });

  it('normalizes x-only lock keys to 02-prefixed compressed', () => {
    const x = xonly('1'); // 32-byte X-only
    const expected = comp('1', '02'); // normalized

    const opts = new P2PKBuilder().addLockPubkey(x).toOptions();
    expect(opts.data).toBe(expected);
  });

  it('normalizes x-only refund keys to 02-prefixed compressed', () => {
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

    // data slot holds the first key; the deduped remainder rides the pubkeys tag.
    expect(opts.data).toBe(kA);
    expect(opts.pubkeys).toEqual([kB]);
    expect(opts.refundKeys).toEqual([kA, kB]);
  });

  it('throws when building with no lock pubkeys', () => {
    expect(() => new P2PKBuilder().toOptions()).toThrow(/At least one lock pubkey is required/i);
  });

  it('throws when an empty lock pubkey is added', () => {
    expect(() => new P2PKBuilder().addLockPubkey('')).toThrow(/invalid pubkey/i);
  });

  it('throws when an empty refund pubkey is added', () => {
    expect(() => new P2PKBuilder().addLockPubkey(comp('a', '02')).addRefundPubkey('')).toThrow(
      /invalid pubkey/i,
    );
  });

  it('throws if refund keys are provided without locktime', () => {
    expect(() =>
      new P2PKBuilder().addLockPubkey(comp('a', '02')).addRefundPubkey(comp('b', '02')).toOptions(),
    ).toThrow(/refund keys require a locktime/i);
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
    expect(o2.sigFlag).toBe(undefined);
  });

  it('treats a Date by its getTime()/1000, not by numeric coercion', () => {
    // getTime() = 500_000 ms => 500 s. A Date under the ms threshold must still be read
    // as milliseconds via getTime(), never coerced to a raw number of seconds.
    const opts = new P2PKBuilder()
      .addLockPubkey(comp('a', '02'))
      .lockUntil(new Date(500_000))
      .toOptions();
    expect(opts.locktime).toBe(500);
  });

  it('treats a numeric locktime of exactly 1e12 as milliseconds', () => {
    // Boundary: values >= 1e12 are milliseconds, so 1e12 ms => 1e9 s.
    const opts = new P2PKBuilder().addLockPubkey(comp('a', '02')).lockUntil(1e12).toOptions();
    expect(opts.locktime).toBe(1e9);
  });

  it('keeps a numeric locktime below 1e12 as seconds', () => {
    const opts = new P2PKBuilder()
      .addLockPubkey(comp('a', '02'))
      .lockUntil(999_999_999_999)
      .toOptions();
    expect(opts.locktime).toBe(999_999_999_999);
  });

  it('returns a defensive copy of additionalTags, isolated from later mutations', () => {
    const b = new P2PKBuilder().addLockPubkey(comp('a', '02')).addTag('foo', ['bar']);
    const opts = b.toOptions();
    b.addTag('baz', ['qux']); // must not leak into the already-returned options
    expect(opts.additionalTags).toEqual([['foo', 'bar']]);
  });

  it('requireLockSignatures throws on non-integer and values less than 1', () => {
    expect(() => new P2PKBuilder().requireLockSignatures(1.5)).toThrow(
      /requiredSignatures \(n_sigs\) must be a positive integer/i,
    );
    expect(() => new P2PKBuilder().requireLockSignatures(0)).toThrow(
      /requiredSignatures \(n_sigs\) must be a positive integer/i,
    );
  });

  it('requireRefundSignatures throws on non-integer and values less than 1', () => {
    expect(() => new P2PKBuilder().requireRefundSignatures(1.5)).toThrow(
      /requiredRefundSignatures \(n_sigs_refund\) must be a positive integer/i,
    );
    expect(() => new P2PKBuilder().requireRefundSignatures(0)).toThrow(
      /requiredRefundSignatures \(n_sigs_refund\) must be a positive integer/i,
    );
  });

  it('throws when requiredSignatures exceeds available lock keys and omits when <= 1', () => {
    const k1 = comp('a', '02');
    const k2 = comp('b', '02');

    expect(() =>
      new P2PKBuilder().addLockPubkey([k1, k2]).requireLockSignatures(5).toOptions(),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(2\)/i);

    // ask for 1 => property omitted (default 1)
    const o2 = new P2PKBuilder().addLockPubkey([k1, k2]).requireLockSignatures(1).toOptions();
    expect('requiredSignatures' in o2).toBe(false);
  });

  it('throws when requiredRefundSignatures exceeds available refund keys and omits when <= 1', () => {
    const r1 = comp('c', '02');
    const r2 = comp('d', '03');

    expect(() =>
      new P2PKBuilder()
        .addLockPubkey(comp('a', '02'))
        .lockUntil(Date.now() + 60)
        .addRefundPubkey([r1, r2])
        .requireRefundSignatures(5)
        .toOptions(),
    ).toThrow(
      /requiredRefundSignatures \(n_sigs_refund\) \(5\) exceeds available refund keys \(2\)/i,
    );

    const o2 = new P2PKBuilder()
      .addLockPubkey(comp('b', '02'))
      .lockUntil(Date.now() + 60)
      .addRefundPubkey([r1, r2])
      .requireRefundSignatures(1)
      .toOptions();

    expect('requiredRefundSignatures' in o2).toBe(false);
  });

  it('rejects an empty or malformed hashlock at addHashlock, not silently', () => {
    // An empty hashlock must NOT be treated as "no hashlock" and degrade the intended
    // HTLC into a plain P2PK lock (spendable with a signature, no preimage).
    expect(() => new P2PKBuilder().addHashlock('')).toThrow(
      /HTLC hashlock must be a 64-character hex string/i,
    );
    expect(() => new P2PKBuilder().addHashlock('not-a-hash')).toThrow(
      /HTLC hashlock must be a 64-character hex string/i,
    );
    // Regression: empty hashlock + a lock key previously yielded { kind: 'P2PK' }.
    expect(() =>
      new P2PKBuilder().addHashlock('').addLockPubkey(comp('a', '02')).toOptions(),
    ).toThrow(/HTLC hashlock must be a 64-character hex string/i);
  });

  it('lowercases the hashlock so it matches createHTLCHash output', () => {
    const opts = new P2PKBuilder().addHashlock(hashlock.toUpperCase()).toOptions();
    expect(opts).toEqual({ kind: 'HTLC', data: hashlock });
  });

  it('rejects an explicit n_sigs on a keyless HTLC (no lock keys to sign)', () => {
    // The <=1 omission above is a redundant default *when keys back it*. With zero
    // lock keys (hashlock-only HTLC) an explicit n_sigs=1 is contradictory and must
    // surface, not be dropped into a spendable preimage-only lock. n_sigs>1 already
    // survives the filter; n_sigs=1 is the value that previously slipped through.
    expect(() =>
      new P2PKBuilder().addHashlock(hashlock).requireLockSignatures(1).toOptions(),
    ).toThrow(/exceeds available pubkeys/i);
    expect(() =>
      new P2PKBuilder().addHashlock(hashlock).requireLockSignatures(2).toOptions(),
    ).toThrow(/exceeds available pubkeys/i);
    // No explicit threshold => keyless HTLC builds fine.
    const ok = new P2PKBuilder().addHashlock(hashlock).toOptions();
    expect('requiredSignatures' in ok).toBe(false);
  });

  it('rejects an explicit n_sigs_refund when there are no refund keys', () => {
    // Same defect, refund side: n_sigs_refund=1 with zero refund keys is impossible
    // and must throw rather than be silently dropped.
    expect(() =>
      new P2PKBuilder().addLockPubkey(comp('a', '02')).requireRefundSignatures(1).toOptions(),
    ).toThrow(/requires refund keys/i);
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
      .sigAll()
      .addHashlock(hashlock)
      .toOptions();

    const rebuilt = P2PKBuilder.fromOptions(original).toOptions();
    expect(rebuilt).toEqual(original);
  });

  it('round-trips a keyless HTLC via fromOptions (no pubkeys)', () => {
    const lock = { kind: 'HTLC', data: hashlock } as const;
    expect(P2PKBuilder.fromOptions(lock).toOptions()).toEqual(lock);
  });

  it('fromOptions with minimal shape leaves required* undefined', () => {
    const minimal = { kind: 'P2PK', data: '02' + 'b'.repeat(64) } as const;
    const round = P2PKBuilder.fromOptions(minimal).toOptions();
    expect(round).toEqual(minimal); // no extra props added
    expect('requiredSignatures' in round).toBe(false);
    expect('requiredRefundSignatures' in round).toBe(false);
    expect('locktime' in round).toBe(false);
    expect('refundKeys' in round).toBe(false);
    expect('sigFlag' in round).toBe(false);
  });

  it('fromOptions applies requiredRefundSignatures when provided', () => {
    const lock = '02' + 'e'.repeat(64);
    const r1 = '02' + 'f'.repeat(64);
    const r2 = '03' + 'g'.repeat(64);
    const now = Math.floor(Date.now() / 1000) + 300;

    const src = {
      kind: 'P2PK',
      data: lock,
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
  // locks contain x-only upper, compressed upper, duplicates of x-only in both forms
  const xA_upper = 'A'.repeat(64); // x only, becomes 02 + a…
  const cB_upper = '02' + 'B'.repeat(64); // compressed, becomes 02 + b…
  const xA_lower = 'a'.repeat(64); // duplicate of xA_upper
  const cA_again = '02' + 'A'.repeat(64); // duplicate after normalisation
  // refunds: compressed 03 upper, x-only that collides by x-only identity, duplicate 02 form
  const r03C_upper = '03' + 'C'.repeat(64); // becomes 03 + c…
  const rXc_lower = 'c'.repeat(64); // x only, deduped against 03 + c… by x-only identity
  const r02c_dup = '02' + 'c'.repeat(64); // same x-only key, deduped
  const ms = (Math.floor(Date.now() / 1000) + 123) * 1000; // exercise ms branch

  it('normalizes mixed inputs, deduplicates, preserves insertion order, and round-trips', () => {
    const opts = new P2PKBuilder()
      .addLockPubkey([xA_upper, cB_upper, xA_lower, cA_again])
      .addRefundPubkey([r03C_upper, rXc_lower, r02c_dup])
      .lockUntil(ms)
      .requireLockSignatures(2) // exactly the two unique lock keys
      .sigAll()
      .toOptions();

    const expRefunds = ['03' + 'c'.repeat(64)];

    // Two unique lock keys: first is the data slot, second rides the pubkeys tag.
    expect(opts.data).toBe('02' + 'a'.repeat(64));
    expect(opts.pubkeys).toEqual(['02' + 'b'.repeat(64)]);
    expect(opts.refundKeys).toEqual(expRefunds);
    expect(opts.locktime).toBe(ms / 1000);
    expect(opts.sigFlag).toEqual('SIG_ALL');
    expect(opts.requiredSignatures).toBe(2);
    expect('requiredRefundSignatures' in opts).toBe(false);

    // round-trip stays identical
    const round = P2PKBuilder.fromOptions(opts).toOptions();
    expect(round).toEqual(opts);
  });

  it('rejects impossible thresholds after deduplication', () => {
    expect(() =>
      new P2PKBuilder()
        .addLockPubkey([xA_upper, cB_upper, xA_lower, cA_again])
        .addRefundPubkey([r03C_upper, rXc_lower, r02c_dup])
        .lockUntil(ms)
        .requireLockSignatures(5) // 5 > 2 unique lock keys
        .sigAll()
        .toOptions(),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(2\)/i);
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
      kind: 'P2PK',
      data: comp('a', '02'),
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
