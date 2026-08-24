import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { Wallet } from '../../src';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { deriveQuoteLockKey } from '../../src/crypto/NUT13';
import { Amount } from '../../src/model/Amount';
import type { Proof } from '../../src/model/types';

const mintUrl = 'http://localhost:3338';
const BLS_ID = `02${'ab'.repeat(32)}`;
const POINT = `02${'cd'.repeat(32)}`;

describe('Wallet._normalizeWitness', () => {
  const wallet = new Wallet(mintUrl, { unit: 'sat' });
  const normalize = (proof: Proof) =>
    (wallet as unknown as { _normalizeWitness(p: Proof): string | undefined })._normalizeWitness(
      proof,
    );

  test('keeps a v3 transaction witness, serializing object forms', () => {
    const base: Proof = { id: BLS_ID, amount: Amount.from(1), secret: POINT, C: '00'.repeat(48) };
    expect(normalize({ ...base, witness: '{"signatures":["ab"]}' })).toBe('{"signatures":["ab"]}');
    expect(normalize({ ...base, witness: { signatures: ['ab'] } })).toBe('{"signatures":["ab"]}');
    expect(normalize(base)).toBeUndefined();
  });

  test('strips a stray witness from a plain pre-v3 secret', () => {
    const legacy: Proof = {
      id: `00${'11'.repeat(16)}`,
      amount: Amount.from(1),
      secret: 'plain-text-secret',
      C: 'aa'.repeat(33),
      witness: '{"signatures":["ab"]}',
    };
    expect(normalize(legacy)).toBeUndefined();
  });
});

describe('Wallet v3 quote lock keys', () => {
  const SEED = hexToBytes('11'.repeat(64));
  type QuoteLockAccess = {
    createV3QuoteLock(): Promise<{ pubkey: string; privkey: Uint8Array } | undefined>;
    recoverV3QuoteLockKey(quoteId: string, pubkey?: string): Promise<Uint8Array | undefined>;
  };

  test('createV3QuoteLock leaves the quote unlocked when no keyset is loaded', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat' }) as unknown as QuoteLockAccess;
    await expect(wallet.createV3QuoteLock()).resolves.toBeUndefined();
  });

  test('recoverV3QuoteLockKey scans the seed to the quote pubkey, and misses cleanly', async () => {
    const wallet = new Wallet(mintUrl, {
      unit: 'sat',
      bip39seed: SEED,
    }) as unknown as QuoteLockAccess;
    const expected = deriveQuoteLockKey(SEED, 3);
    const pubkey = bytesToHex(getPubKeyFromPrivKey(expected));
    const found = await wallet.recoverV3QuoteLockKey('q1', pubkey.toUpperCase());
    expect(bytesToHex(found!)).toBe(bytesToHex(expected));
    // A pubkey this seed never derived scans to nothing rather than guessing.
    const foreign = bytesToHex(getPubKeyFromPrivKey(hexToBytes('22'.repeat(32))));
    await expect(wallet.recoverV3QuoteLockKey('q2', foreign)).resolves.toBeUndefined();
  });

  test('recoverV3QuoteLockKey without a seed returns nothing', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat' }) as unknown as QuoteLockAccess;
    await expect(wallet.recoverV3QuoteLockKey('q1', POINT)).resolves.toBeUndefined();
  });
});
