import { test, describe, expect } from 'vitest';

import { Amount, Wallet, OutputData, type P2PKOptions } from '../../src';

import { mint, mintUrl, useTestServer } from './_setup';

useTestServer();

// Valid-format 33-byte compressed pubkeys for testing
const PK1 = '02' + 'aa'.repeat(32);
const PK2 = '02' + 'bb'.repeat(32);
const PK3 = '02' + 'cc'.repeat(32);
const REFUND1 = '02' + 'dd'.repeat(32);
const REFUND2 = '02' + 'ee'.repeat(32);
const REFUND3 = '02' + 'ff'.repeat(32);

describe('P2PK BlindingData', () => {
  test('Create BlindingData locked to single pk with locktime and single refund key', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      { pubkey: PK1, locktime: 212, refundKeys: [REFUND1] },
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
      { pubkey: PK1, locktime: 212, refundKeys: [REFUND1, REFUND2] },
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
    const data = OutputData.createP2PKData({ pubkey: PK1 }, 21, keys);
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
      OutputData.createP2PKData({ pubkey: PK1, requiredSignatures: 5 }, 21, keys),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(1\)/i);
  });
  test('Create BlindingData locked to multiple pks with no requiredSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData({ pubkey: [PK1, PK2, PK3] }, 21, keys);
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
      { pubkey: [PK1, PK2, PK3], requiredSignatures: 2 },
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
      OutputData.createP2PKData({ pubkey: [PK1, PK2, PK3], requiredSignatures: 5 }, 21, keys),
    ).toThrow(/requiredSignatures \(n_sigs\) \(5\) exceeds available pubkeys \(3\)/i);
  });
  test('Create BlindingData locked to single refund key with default requiredRefundSignatures', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const keys = wallet.keyChain.getKeyset();
    const data = OutputData.createP2PKData(
      {
        pubkey: PK1,
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
      { pubkey: PK1, locktime: 212, refundKeys: [REFUND1, REFUND2] },
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
        pubkey: PK1,
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
          pubkey: PK1,
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
        pubkey: [PK1, PK2, PK3],
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

describe('Wallet.createOutputData p2pk chokepoint', () => {
  // A mint signs a lock blind and reads it only at spend time, so a kind it does not
  // support spends as a bearer proof (NUT-10).
  const walletFor = (nuts: Record<string, { supported: boolean }>) => {
    const w = new Wallet(mintUrl, { unit: 'sat' });
    w.loadMintFromCache(
      {
        name: 'lock mint',
        pubkey: PK2,
        version: 'test/1',
        contact: [],
        nuts: {
          '4': { methods: [], disabled: false },
          '5': { methods: [], disabled: false },
          ...nuts,
        },
      },
      { mintUrl, savedAt: Date.now(), keysets: [] },
    );
    return w;
  };
  const KEYSET = { id: `00${'cd'.repeat(8)}`, keys: { '1': 'x', '2': 'x' } };
  const create = (wallet: Wallet, options: P2PKOptions) =>
    (
      wallet as unknown as {
        createOutputData(
          a: Amount,
          k: typeof KEYSET,
          ot: { type: 'p2pk'; options: P2PKOptions },
        ): OutputData[];
      }
    ).createOutputData(Amount.from(3), KEYSET, { type: 'p2pk', options });

  test('refuses when the mint does not advertise NUT-11', () => {
    expect(() => create(walletFor({ '10': { supported: true } }), { pubkey: PK1 })).toThrow(
      /NUT-11/,
    );
  });

  test('refuses a hashlock when the mint does not advertise NUT-14', () => {
    const wallet = walletFor({ '11': { supported: true } });
    expect(() => create(wallet, { pubkey: PK1 })).not.toThrow();
    expect(() => create(wallet, { pubkey: PK1, hashlock: 'ab'.repeat(32) })).toThrow(/NUT-14/);
  });
});
