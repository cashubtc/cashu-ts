import { test, describe, expect } from 'vitest';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  deriveMintBackupKeys,
  buildMintBackupPayload,
  parseMintBackupPayload,
  MINT_BACKUP_KIND,
  MINT_BACKUP_D_TAG,
} from '../../src/crypto';

// Deterministic 64-byte test seed (bytes 0x00..0x3f). cashu-ts works in seed
// space, so we avoid a bip39 dependency in the test.
const SEED = hexToBytes(
  '000102030405060708090a0b0c0d0e0f' +
    '101112131415161718191a1b1c1d1e1f' +
    '202122232425262728292a2b2c2d2e2f' +
    '303132333435363738393a3b3c3d3e3f',
);

// Reference vector reproduced from CME's derivation
// (sha256(seed || "cashu-mint-backup") -> nostr-tools getPublicKey x-only).
// Pins drop-in compatibility: existing CME backups must still restore.
const EXPECTED_PRIVKEY = '2cbff0a8a0037c25730cd14519aaa50eaf9364db89101ad734883fbd1fbb9099';
const EXPECTED_PUBKEY = 'e3aba74c622b09bd1c1acbb4331fa00aedec6c410051dd7b37a5ad2fee09ec2f';

describe('NUT-27 deriveMintBackupKeys', () => {
  test('matches the CME reference vector (drop-in compatible)', () => {
    const { privkey, pubkey } = deriveMintBackupKeys(SEED);
    expect(privkey).toBe(EXPECTED_PRIVKEY);
    expect(pubkey).toBe(EXPECTED_PUBKEY);
  });

  test('pubkey is 32-byte x-only (not 33-byte compressed)', () => {
    const { pubkey } = deriveMintBackupKeys(SEED);
    expect(pubkey).toHaveLength(64);
  });

  test('is deterministic', () => {
    expect(deriveMintBackupKeys(SEED)).toEqual(deriveMintBackupKeys(SEED));
  });

  test('rejects an empty or non-Uint8Array seed', () => {
    expect(() => deriveMintBackupKeys(new Uint8Array(0))).toThrow();
    // @ts-expect-error testing runtime guard
    expect(() => deriveMintBackupKeys('not bytes')).toThrow();
  });
});

describe('NUT-27 payload', () => {
  test('round-trips mints and timestamp', () => {
    const mints = ['https://mint.example.com', 'https://another-mint.org'];
    const json = buildMintBackupPayload(mints, 1703721600);
    expect(parseMintBackupPayload(json)).toEqual({ mints, timestamp: 1703721600 });
  });

  test('parse rejects non-JSON', () => {
    expect(() => parseMintBackupPayload('{not json')).toThrow();
  });

  test('parse rejects a missing or malformed mints field', () => {
    expect(() => parseMintBackupPayload(JSON.stringify({ timestamp: 1 }))).toThrow();
    expect(() => parseMintBackupPayload(JSON.stringify({ mints: [1, 2], timestamp: 1 }))).toThrow();
  });

  test('parse rejects a non-integer timestamp', () => {
    expect(() => parseMintBackupPayload(JSON.stringify({ mints: [], timestamp: 1.5 }))).toThrow();
  });

  test('build rejects non-string mints', () => {
    // @ts-expect-error testing runtime guard
    expect(() => buildMintBackupPayload([1, 2], 1)).toThrow();
  });

  test('build rejects a non-integer timestamp', () => {
    expect(() => buildMintBackupPayload([], 1.5)).toThrow();
  });

  test('parse rejects JSON that is not an object', () => {
    expect(() => parseMintBackupPayload('42')).toThrow();
    expect(() => parseMintBackupPayload('null')).toThrow();
  });
});

describe('NUT-27 conventions', () => {
  test('exposes the kind and d-tag constants for consumers to assemble events', () => {
    expect(MINT_BACKUP_KIND).toBe(30078);
    expect(MINT_BACKUP_D_TAG).toBe('mint-list');
  });
});
