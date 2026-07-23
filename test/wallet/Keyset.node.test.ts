import { test, describe, expect } from 'vitest';

import { Keyset, type MintKeys, type Keys } from '../../src';
import { deriveKeysetId } from '../../src/utils';
import { PUBKEYS } from '../consts';

// Genuine v0 keyset id for PUBKEYS (independent derivation).
const GENUINE_ID = deriveKeysetId(PUBKEYS, { versionByte: 0 });
// v0 id of an empty keyset — used to probe the empty-keys guard.
const EMPTY_ID = deriveKeysetId({}, { versionByte: 0 });

describe('Keyset.verifyKeysetId', () => {
  test('returns true for a keyset whose id matches its keys', () => {
    const mk: MintKeys = { id: GENUINE_ID, unit: 'sat', active: true, keys: PUBKEYS };
    expect(Keyset.verifyKeysetId(mk)).toBe(true);
  });

  test('returns false for empty keys even when the id derives the empty keyset', () => {
    // The empty-keys guard must short-circuit before derivation; otherwise an
    // empty keyset would spuriously "verify" against its own empty-derived id.
    const mk: MintKeys = { id: EMPTY_ID, unit: 'sat', active: true, keys: {} };
    expect(Keyset.verifyKeysetId(mk)).toBe(false);
  });

  test('returns false (not undefined) when id derivation throws', () => {
    // Version byte 0x03 is unrecognized: deriveKeysetId throws and the catch
    // must yield false, not swallow the error into undefined.
    const badVersionId = '03' + 'a'.repeat(62);
    const mk: MintKeys = { id: badVersionId, unit: 'sat', active: true, keys: PUBKEYS };
    expect(Keyset.verifyKeysetId(mk)).toBe(false);
  });

  test('returns false for a keyset with more than 256 denominations', () => {
    // Id derives genuinely for the oversized set, so rejection is due solely
    // to the denomination-count bound.
    const pubkey = (PUBKEYS as Keys)[1];
    const oversized: Keys = {};
    for (let i = 0; i < 257; i++) oversized[i + 1] = pubkey;
    const mk: MintKeys = {
      id: deriveKeysetId(oversized, { versionByte: 0 }),
      unit: 'sat',
      active: true,
      keys: oversized,
    };
    expect(Keyset.verifyKeysetId(mk)).toBe(false);
  });

  test('returns false when derived id does not match a tampered key', () => {
    const tampered: Keys = { ...(PUBKEYS as Keys), 1: (PUBKEYS as Keys)[2] };
    const mk: MintKeys = { id: GENUINE_ID, unit: 'sat', active: true, keys: tampered };
    expect(Keyset.verifyKeysetId(mk)).toBe(false);
  });
});

describe('Keyset.verify', () => {
  test('returns true for a genuine keyset and false once keys are cleared', () => {
    const meta = { id: GENUINE_ID, unit: 'sat', active: true };
    const ks = Keyset.fromMintApi(meta, { ...meta, keys: PUBKEYS });
    expect(ks.verify()).toBe(true);

    ks.keys = {};
    expect(ks.verify()).toBe(false);
  });
});
