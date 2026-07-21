import { describe, test, expect } from 'vitest';

import { CTSError } from '../../src';
import { Amount } from '../../src/model/Amount';
import { type Proof } from '../../src/model/types';
import { selectProofsRotating } from '../../src/wallet/SelectProofs';

// -----------------------------------------------------------------
// Unit tests for the keyset-rotation wrapper. RGLI internals are
// covered by selectProofsRGLI.test.ts and the wallet tests.
// -----------------------------------------------------------------

// Keyset ids: one per staleness class used in tests
const B64 = 'RQvZXp8f'; // non-hex, legacy base64 (v0)
const V1A = '00aa111111111111';
const V1B = '00bb222222222222';
const V2A = '01cc333333333333';

// Minimal keychain stub with fee and active flag per keyset
function keychainStub(keysets: Record<string, { fee?: number; active?: boolean }>) {
  const entry = (id: string) => ({
    id,
    fee: keysets[id]?.fee ?? 0,
    isActive: keysets[id]?.active ?? true,
    hasHexId: /^[0-9a-fA-F]+$/.test(id),
  });
  return {
    getKeyset: (id: string) => {
      if (!keysets[id]) throw new CTSError(`Keyset '${id}' not found`);
      return entry(id);
    },
    getKeysets: () => Object.keys(keysets).map(entry),
  } as any;
}

let n = 0;
const P = (id: string, amount: number | bigint): Proof => ({
  id,
  amount: Amount.from(amount),
  secret: `s${++n}`,
  C: `C${n}`,
});

const secrets = (proofs: Proof[]) => proofs.map((p) => p.secret).sort();
const total = (proofs: Proof[]) => proofs.reduce((a, p) => a + p.amount.toNumber(), 0);

describe('selectProofsRotating', () => {
  test('base64 outranks inactive hex keysets regardless of active status', () => {
    // Active base64 must be forced ahead of the inactive v1 bucket
    const b64 = P(B64, 2);
    const v1 = P(V1A, 4);
    const v2 = P(V2A, 64);
    const kc = keychainStub({ [B64]: {}, [V1A]: { active: false }, [V2A]: {} });

    const res = selectProofsRotating([b64, v1, v2], 3, kc);

    expect(res.send.map((p) => p.secret)).toContain(b64.secret);
    expect(res.send.every((p) => p.id !== V2A)).toBe(true);
    expect(total(res.send)).toBe(6); // forced 2 + boundary 4
  });

  test('inactive before active within the same version', () => {
    const inactive = P(V1A, 4);
    const active = P(V1B, 4);
    const kc = keychainStub({ [V1A]: { active: false }, [V1B]: {} });

    const res = selectProofsRotating([inactive, active], 4, kc);

    expect(secrets(res.send)).toEqual([inactive.secret]);
    expect(secrets(res.keep)).toEqual([active.secret]);
  });

  test('stale dust below target is always force-included', () => {
    const dust = [P(B64, 1), P(B64, 1), P(B64, 1)];
    const fresh = [P(V2A, 8), P(V2A, 4), P(V2A, 2), P(V2A, 1)];
    const kc = keychainStub({ [B64]: {}, [V2A]: {} });

    const res = selectProofsRotating([...dust, ...fresh], 10, kc);

    const sent = new Set(res.send.map((p) => p.secret));
    for (const d of dust) expect(sent.has(d.secret)).toBe(true);
    expect(total(res.send)).toBeGreaterThanOrEqual(10);
  });

  test('large stale boundary bucket satisfies the send without fresh proofs', () => {
    const stale = [P(V1A, 16), P(V1A, 8), P(V1A, 4), P(V1A, 2), P(V1A, 1)];
    const fresh = [P(V2A, 64), P(V2A, 32)];
    const kc = keychainStub({ [V1A]: { active: false }, [V2A]: {} });

    const res = selectProofsRotating([...stale, ...fresh], 10, kc);

    expect(res.send.length).toBeGreaterThan(0);
    expect(res.send.every((p) => p.id === V1A)).toBe(true);
    for (const f of fresh) expect(res.keep.map((p) => p.secret)).toContain(f.secret);
  });

  test('exact match widens to fresher buckets when the boundary has no exact subset', () => {
    const b64 = P(B64, 3);
    const v1 = P(V1A, 4);
    const v2 = P(V2A, 2);
    const kc = keychainStub({ [B64]: {}, [V1A]: {}, [V2A]: {} });

    // Forced 3, residual 2. Boundary {4} has no exact subset; attempt 2 finds {2}.
    const res = selectProofsRotating([b64, v1, v2], 5, kc, false, true);

    expect(secrets(res.send)).toEqual(secrets([b64, v2]));
    expect(total(res.send)).toBe(5);
  });

  test('exact match falls back to plain RGLI when forcing makes exactness impossible', () => {
    const b64 = P(B64, 3);
    const v1a = P(V1A, 4);
    const v1b = P(V1A, 3);
    const kc = keychainStub({ [B64]: {}, [V1A]: {} });

    // Forced 3 leaves residual 1, which nothing satisfies. Plain RGLI finds {4}.
    const res = selectProofsRotating([b64, v1a, v1b], 4, kc, false, true);

    expect(secrets(res.send)).toEqual([v1a.secret]);
    expect(res.keep.map((p) => p.secret)).toContain(b64.secret);
  });

  test('unified fee verification rejects a split-computed off-by-one exact match', () => {
    // Forced: 1 sat at 400ppk nets 0 alone (residual 5). Boundary {3, 3} at 250ppk
    // nets exactly 5 split (6 - ceil(500/1000)), but merged nets 6 (7 - ceil(900/1000)),
    // so attempts 1 and 2 must be rejected and plain RGLI returns {3, 3} alone.
    const b64 = P(B64, 1);
    const v1a = P(V1A, 3);
    const v1b = P(V1A, 3);
    const kc = keychainStub({ [B64]: { fee: 400 }, [V1A]: { fee: 250 } });

    const res = selectProofsRotating([b64, v1a, v1b], 5, kc, true, true);

    expect(secrets(res.send)).toEqual(secrets([v1a, v1b]));
    expect(res.keep.map((p) => p.secret)).toContain(b64.secret);
  });

  test('uneconomical stale dust is forced and the residual expands to cover it', () => {
    const dust = P(B64, 1); // exFee -1 at 2000ppk, plain RGLI would filter it
    const fresh = [P(V2A, 8), P(V2A, 4), P(V2A, 2), P(V2A, 1)];
    const kc = keychainStub({ [B64]: { fee: 2000 }, [V2A]: {} });

    const res = selectProofsRotating([dust, ...fresh], 10, kc, true);

    expect(res.send.map((p) => p.secret)).toContain(dust.secret);
    // Merged net (gross - ceil(ppk/1000)) still covers the target
    const gross = total(res.send);
    const ppk = res.send.reduce((a, p) => a + (p.id === B64 ? 2000 : 0), 0);
    expect(gross - Math.ceil(ppk / 1000)).toBeGreaterThanOrEqual(10);
  });

  test('forced dust that makes the target infeasible falls back to plain RGLI', () => {
    const dust = P(B64, 1);
    const fresh = P(V1A, 4);
    const kc = keychainStub({ [B64]: { fee: 2000 }, [V1A]: {} });

    // Forcing dust nets 3 of a 4 target across the whole wallet; attempt 3 drops it.
    const res = selectProofsRotating([dust, fresh], 4, kc, true);

    expect(secrets(res.send)).toEqual([fresh.secret]);
    expect(res.keep.map((p) => p.secret)).toContain(dust.secret);
  });

  test('single bucket fast path behaves like plain RGLI', () => {
    const proofs = [P(V2A, 8), P(V2A, 4), P(V2A, 2), P(V2A, 1)];
    const kc = keychainStub({ [V2A]: {} });

    const res = selectProofsRotating(proofs, 6, kc);

    expect(total(res.send)).toBeGreaterThanOrEqual(6);
    expect(res.send.length + res.keep.length).toBe(4);
  });

  test('zero target returns keep all', () => {
    const proofs = [P(V2A, 4), P(B64, 2)];
    const kc = keychainStub({ [V2A]: {}, [B64]: {} });

    const res = selectProofsRotating(proofs, 0, kc);

    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('target above spendable total returns keep all', () => {
    const proofs = [P(V2A, 4), P(B64, 2)];
    const kc = keychainStub({ [V2A]: {}, [B64]: {} });

    const res = selectProofsRotating(proofs, 100, kc);

    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('unknown keyset id throws CTSError', () => {
    const kc = keychainStub({ [V2A]: {} });
    expect(() => selectProofsRotating([P(V1A, 4)], 2, kc)).toThrow(CTSError);
  });

  test('two stale buckets are forced in sequence before the boundary supplies the residual', () => {
    const dust = [P(B64, 1), P(B64, 1)];
    const stale = P(V1A, 4);
    const fresh = [P(V2A, 16), P(V2A, 8), P(V2A, 4), P(V2A, 2), P(V2A, 1)];
    const kc = keychainStub({ [B64]: {}, [V1A]: { active: false }, [V2A]: {} });

    // Forced: base64 (2) then inactive v1 (4); boundary v2 covers the residual 4
    const res = selectProofsRotating([...dust, stale, ...fresh], 10, kc);

    const sent = new Set(res.send.map((p) => p.secret));
    for (const d of dust) expect(sent.has(d.secret)).toBe(true);
    expect(sent.has(stale.secret)).toBe(true);
    expect(total(res.send)).toBe(10);
  });

  test('equality return after forcing two buckets sends exactly those buckets', () => {
    const b64 = P(B64, 2);
    const stale = P(V1A, 4);
    const fresh = P(V2A, 32);
    const kc = keychainStub({ [B64]: {}, [V1A]: { active: false }, [V2A]: {} });

    const res = selectProofsRotating([b64, stale, fresh], 6, kc);

    expect(secrets(res.send)).toEqual(secrets([b64, stale]));
    expect(secrets(res.keep)).toEqual([fresh.secret]);
  });

  test('u64-scale amounts flush via the forced walk without touching RGLI', () => {
    // Both proofs exceed Number.MAX_SAFE_INTEGER; equality return needs no RGLI call
    const b64 = P(B64, 2n ** 60n);
    const stale = P(V1A, 2n ** 60n);
    const kc = keychainStub({ [B64]: {}, [V1A]: { active: false } });

    const res = selectProofsRotating([b64, stale], 2n ** 61n, kc);

    expect(secrets(res.send)).toEqual(secrets([b64, stale]));
    expect(res.keep).toHaveLength(0);
  });

  test('u64-scale forced bucket combines with a safe RGLI residual', () => {
    const huge = P(B64, 2n ** 60n);
    const fresh = [P(V2A, 8), P(V2A, 4), P(V2A, 2), P(V2A, 1)];
    const kc = keychainStub({ [B64]: {}, [V2A]: {} });

    const res = selectProofsRotating([huge, ...fresh], 2n ** 60n + 10n, kc);

    expect(res.send.map((p) => p.secret)).toContain(huge.secret);
    const sent = res.send.reduce((a, p) => a + p.amount.toBigInt(), 0n);
    expect(sent).toBeGreaterThanOrEqual(2n ** 60n + 10n);
  });

  test('copes with a huge forced dust bucket (50k proofs)', () => {
    const dust: Proof[] = [];
    for (let i = 0; i < 50000; i++) dust.push(P(B64, 1));
    const fresh = P(V2A, 100000);
    const kc = keychainStub({ [B64]: {}, [V2A]: {} });

    const res = selectProofsRotating([...dust, fresh], 50001, kc);

    expect(res.send).toHaveLength(50001);
    expect(total(res.send)).toBe(150000);
    expect(res.keep).toHaveLength(0);
  });
});
