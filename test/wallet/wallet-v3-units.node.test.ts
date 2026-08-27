import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { Wallet, QUOTE_COUNTER_KEY, type OperationCounters } from '../../src';
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

describe('Wallet quote lock keys', () => {
  const SEED = hexToBytes('11'.repeat(64));

  test('createQuoteLockKey derives from the seed and consumes the quote counter', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed: SEED });
    const first = await wallet.createQuoteLockKey();
    expect(bytesToHex(deriveQuoteLockKey(SEED, 0))).toBe(first.privkey);
    expect(bytesToHex(getPubKeyFromPrivKey(hexToBytes(first.privkey)))).toBe(first.pubkey);
    // The counter moved: the next key is a different derivation.
    const second = await wallet.createQuoteLockKey();
    expect(bytesToHex(deriveQuoteLockKey(SEED, 1))).toBe(second.privkey);
  });

  test('createQuoteLockKey is random without a seed', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat' });
    const a = await wallet.createQuoteLockKey();
    const b = await wallet.createQuoteLockKey();
    expect(a.privkey).not.toBe(b.privkey);
    expect(bytesToHex(getPubKeyFromPrivKey(hexToBytes(a.privkey)))).toBe(a.pubkey);
  });

  test('createQuoteLockKey emits countersReserved so persistence hooks see the cursor', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed: SEED });
    const seen: OperationCounters[] = [];
    wallet.on.countersReserved((p) => seen.push(p));
    await wallet.createQuoteLockKey();
    await wallet.createQuoteLockKey();
    expect(seen).toEqual([
      { counterKey: QUOTE_COUNTER_KEY, start: 0, count: 1, next: 1 },
      { counterKey: QUOTE_COUNTER_KEY, start: 1, count: 1, next: 2 },
    ]);
  });

  test('createQuoteLockKey({ random: true }) skips the seed and the quote counter', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed: SEED });
    const seen: OperationCounters[] = [];
    wallet.on.countersReserved((p) => seen.push(p));
    const throwaway = await wallet.createQuoteLockKey({ random: true });
    expect(throwaway.privkey).not.toBe(bytesToHex(deriveQuoteLockKey(SEED, 0)));
    expect(bytesToHex(getPubKeyFromPrivKey(hexToBytes(throwaway.privkey)))).toBe(throwaway.pubkey);
    expect(seen).toEqual([]);
    // The counter did not move: the next seeded key still derives at 0.
    const first = await wallet.createQuoteLockKey();
    expect(bytesToHex(deriveQuoteLockKey(SEED, 0))).toBe(first.privkey);
  });

  test('recoverQuoteLockKey scans the seed to the quote pubkey, and misses cleanly', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed: SEED });
    const expected = deriveQuoteLockKey(SEED, 3);
    const pubkey = bytesToHex(getPubKeyFromPrivKey(expected));
    await expect(wallet.recoverQuoteLockKey(pubkey.toUpperCase())).resolves.toBe(
      bytesToHex(expected),
    );
    // A pubkey this seed never derived scans to nothing rather than guessing.
    const foreign = bytesToHex(getPubKeyFromPrivKey(hexToBytes('22'.repeat(32))));
    await expect(wallet.recoverQuoteLockKey(foreign)).resolves.toBeUndefined();
  });

  test('recoverQuoteLockKey without a seed throws, not a silent miss', async () => {
    const wallet = new Wallet(mintUrl, { unit: 'sat' });
    await expect(wallet.recoverQuoteLockKey(POINT)).rejects.toThrow(
      'recoverQuoteLockKey requires a seeded wallet',
    );
  });
});
