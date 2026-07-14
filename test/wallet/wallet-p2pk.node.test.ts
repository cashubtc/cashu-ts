import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';

import { Wallet, OutputData } from '../../src';

import { mint, useTestServer } from './_setup';

useTestServer();

// Valid on-curve 33-byte compressed pubkeys for testing
const key = (seed: number) =>
  '02' + bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(seed)));
const PK1 = key(1);
const PK2 = key(2);
const PK3 = key(3);
const REFUND1 = key(4);
const REFUND2 = key(5);
const REFUND3 = key(6);

describe('P2PK BlindingData', () => {
  test('Create BlindingData locked to single pk with locktime and single refund key', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { kind: 'P2PK', data: PK1, locktime: 212, refundKeys: [REFUND1] },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['refund', REFUND1]);
    });
  });
  test('Create BlindingData locked to single pk with locktime and multiple refund keys', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { kind: 'P2PK', data: PK1, locktime: 212, refundKeys: [REFUND1, REFUND2] },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['refund', REFUND1, REFUND2]);
    });
  });
  test('Create BlindingData locked to single pk without locktime and no refund keys', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData({ kind: 'P2PK', data: PK1 }, 21, keys);
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toEqual([]);
    });
  });
  test('Create BlindingData locked to single pk with unexpected requiredSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    expect(() =>
      OutputData.createP2PKData({ kind: 'P2PK', data: PK1, requiredSignatures: 5 }, 21, keys),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(1\)/i);
  });
  test('Create BlindingData locked to multiple pks with no requiredSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { kind: 'P2PK', data: PK1, pubkeys: [PK2, PK3] },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['pubkeys', PK2, PK3]);
      expect(s[1].tags).not.toContainEqual(['n_sigs', '1']);
    });
  });
  test('Create BlindingData locked to multiple pks with 2-of-3 requiredSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { kind: 'P2PK', data: PK1, pubkeys: [PK2, PK3], requiredSignatures: 2 },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['pubkeys', PK2, PK3]);
      expect(s[1].tags).toContainEqual(['n_sigs', '2']);
    });
  });
  test('Create BlindingData locked to multiple pks with out of range requiredSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    expect(() =>
      OutputData.createP2PKData(
        { kind: 'P2PK', data: PK1, pubkeys: [PK2, PK3], requiredSignatures: 5 },
        21,
        keys,
      ),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(3\)/i);
  });
  test('Create BlindingData locked to single refund key with default requiredRefundSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      {
        kind: 'P2PK',
        data: PK1,
        locktime: 212,
        refundKeys: [REFUND1],
        requiredRefundSignatures: 1,
      },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['refund', REFUND1]);
      expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
    });
  });
  test('Create BlindingData locked to multiple refund keys with no requiredRefundSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { kind: 'P2PK', data: PK1, locktime: 212, refundKeys: [REFUND1, REFUND2] },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['refund', REFUND1, REFUND2]);
      expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
    });
  });
  test('Create BlindingData locked to multiple refund keys with 2-of-3 requiredRefundSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      {
        kind: 'P2PK',
        data: PK1,
        locktime: 212,
        refundKeys: [REFUND1, REFUND2, REFUND3],
        requiredRefundSignatures: 2,
      },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['refund', REFUND1, REFUND2, REFUND3]);
      expect(s[1].tags).toContainEqual(['n_sigs_refund', '2']);
    });
  });
  test('Create BlindingData locked to multiple refund keys with out of range requiredRefundSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    expect(() =>
      OutputData.createP2PKData(
        {
          kind: 'P2PK',
          data: PK1,
          locktime: 212,
          refundKeys: [REFUND1, REFUND2, REFUND3],
          requiredRefundSignatures: 5,
        },
        21,
        keys,
      ),
    ).toThrow(
      /requiredRefundSignatures \(n_sigs_refund\) \(5\) exceeds available refund keys \(3\)/i,
    );
  });
  test('Create BlindingData locked to multiple refund keys with expired multisig', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      {
        kind: 'P2PK',
        data: PK1,
        pubkeys: [PK2, PK3],
        locktime: 212,
        refundKeys: [REFUND1, REFUND2],
        requiredSignatures: 2,
        requiredRefundSignatures: 1,
      },
      21,
      keys,
    );
    const decoder = new TextDecoder();
    const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
    allSecrets.forEach((s) => {
      expect(s[0] === 'P2PK');
      expect(s[1].data).toBe(PK1);
      expect(s[1].tags).toContainEqual(['locktime', '212']);
      expect(s[1].tags).toContainEqual(['pubkeys', PK2, PK3]);
      expect(s[1].tags).toContainEqual(['refund', REFUND1, REFUND2]);
      expect(s[1].tags).toContainEqual(['n_sigs', '2']);
      expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
    });
  });
});
