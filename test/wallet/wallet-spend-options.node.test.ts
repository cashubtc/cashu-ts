import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';

import { Amount, Wallet } from '../../src';
import { deriveSecretAndBlindingFactor } from '../../src/crypto/NUT13';
import {
  buildTaprootSecret,
  deriveReceiverKeyedSecret,
  serializeTaprootLeaf,
  type TaprootLeaf,
} from '../../src/crypto/taproot';
import type { Proof, SpendInfo } from '../../src/model/types';

import { mint, useTestServer } from './_setup';

useTestServer();

const V3_KEYSET = '02' + 'ab'.repeat(32);
const priv = (seed: number) => bytesToHex(new Uint8Array(32).fill(seed));
const pub = (seed: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(priv(seed)), true));

const ALICE = 1;
const BOB = 2;
const STRANGER = 9;

/**
 * A v3 proof with the given secret and spend info. `C` is never inspected here.
 */
const v3Proof = (secret: string, spend_info?: SpendInfo): Proof => ({
  id: V3_KEYSET,
  amount: Amount.from(8).toBigInt(),
  secret,
  C: 'aa'.repeat(48),
  ...(spend_info && { spend_info }),
});

// A seedless wallet: spendOptions only reaches the keyset for its seed scan, so nothing here
// needs a loaded mint.
const wallet = () => new Wallet(mint);

describe('wallet.spendOptions: the key path', () => {
  test('rejects anything that is not a v3 point secret', async () => {
    await expect(wallet().spendOptions(v3Proof('deadbeef'))).rejects.toThrow(/point secrets/);
    await expect(
      wallet().spendOptions(v3Proof(JSON.stringify(['P2PK', { nonce: '', data: pub(1) }]))),
    ).rejects.toThrow(/point secrets/);
    await expect(wallet().spendOptions(v3Proof(`02${'ff'.repeat(32)}`))).rejects.toThrow(
      /point secrets/,
    );
  });

  test('finds a bearer key, and reports none when the spend info is empty', async () => {
    const k = priv(ALICE);
    const bare = v3Proof(pub(ALICE), { k });
    expect(await wallet().spendOptions(bare)).toEqual({ keyPath: true, script: [] });
    // Same proof with no spend info at all, and no seed to derive from: nothing to spend with.
    expect(await wallet().spendOptions(v3Proof(pub(ALICE)))).toEqual({
      keyPath: false,
      script: [],
    });
    // A bearer key that does not match the secret is not a key path.
    expect(await wallet().spendOptions(v3Proof(pub(BOB), { k }))).toEqual({
      keyPath: false,
      script: [],
    });
  });

  test('falls back to the seed for a self-owned proof with no spend info', async () => {
    // The common case: the wallet minted the proof itself, so nothing travels with it. This is
    // also the only branch that reaches the keyset, via the counter bound.
    const seed = new Uint8Array(64).fill(7);
    const seeded = new Wallet(mint, { bip39seed: seed });
    const { secret } = deriveSecretAndBlindingFactor(seed, V3_KEYSET, 3);
    const mine = v3Proof(bytesToHex(secret));
    expect((await seeded.spendOptions(mine)).keyPath).toBe(true);
    // A different seed does not find it, and neither does a seedless wallet.
    const other = new Wallet(mint, { bip39seed: new Uint8Array(64).fill(8) });
    expect((await other.spendOptions(mine)).keyPath).toBe(false);
    expect((await wallet().spendOptions(mine)).keyPath).toBe(false);
  });

  test('trial-matches a receiver-keyed proof against the keys supplied', async () => {
    const out = deriveReceiverKeyedSecret(pub(BOB));
    const proof = v3Proof(out.secret, { E: out.E });
    expect((await wallet().spendOptions(proof, { privkeys: priv(BOB) })).keyPath).toBe(true);
    expect((await wallet().spendOptions(proof, { privkeys: priv(STRANGER) })).keyPath).toBe(false);
    expect((await wallet().spendOptions(proof)).keyPath).toBe(false);
  });
});

describe('wallet.spendOptions: the script path', () => {
  const threshold = (keys: string[], n = 1): TaprootLeaf => ({ type: 'threshold', n, keys });
  const after = (time: number, keys: string[]): TaprootLeaf => ({
    type: 'after',
    n: 1,
    keys,
    time,
  });
  const hashlock = (keys: string[]): TaprootLeaf => ({
    type: 'hashlock',
    n: 1,
    keys,
    hash: 'bb'.repeat(32),
  });

  /**
   * A locked proof over `leaves`, disclosed with its internal key.
   */
  const locked = (leaves: TaprootLeaf[], internalSeed = BOB) => {
    const { secret, tree } = buildTaprootSecret(pub(internalSeed), leaves);
    return v3Proof(secret, { K: pub(internalSeed), tree });
  };

  test('a leaf whose key the wallet holds is satisfiable', async () => {
    const proof = locked([threshold([pub(ALICE)])]);
    const { script } = await wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(script).toHaveLength(1);
    expect(script[0]).toMatchObject({ leafIndex: 0, satisfiable: true });
    expect(script[0].blockedBy).toBeUndefined();
    expect(script[0].keys).toEqual([{ keyIndex: 0, secretKey: priv(ALICE), blinded: false }]);
    expect(script[0].leaf).toEqual(threshold([pub(ALICE)]));
  });

  test('a stranger holds no keys and the leaf is blocked on the threshold', async () => {
    const proof = locked([threshold([pub(ALICE)])]);
    const { script } = await wallet().spendOptions(proof, { privkeys: priv(STRANGER) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold', keys: [] });
  });

  test('a 2-of-2 leaf with one key held is blocked on the threshold', async () => {
    const proof = locked([threshold([pub(ALICE), pub(BOB)], 2)]);
    const { script } = await wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold' });
    expect(script[0].keys).toHaveLength(1);
    // Both keys held: the threshold is met.
    const both = await wallet().spendOptions(proof, { privkeys: [priv(ALICE), priv(BOB)] });
    expect(both.script[0].satisfiable).toBe(true);
  });

  test('a locktime blocks until it passes, and reports when that is', async () => {
    const unlockAt = 4102444800; // 2100-01-01
    const proof = locked([after(unlockAt, [pub(ALICE)])]);
    const before = await wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt - 1 });
    expect(before.script[0]).toMatchObject({
      satisfiable: false,
      blockedBy: 'locktime',
      availableAt: unlockAt,
    });
    const at = await wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt });
    expect(at.script[0]).toMatchObject({ satisfiable: true, availableAt: unlockAt });
    // A locktime that has passed but whose key is missing falls through to the threshold.
    const stranger = await wallet().spendOptions(proof, {
      privkeys: priv(STRANGER),
      now: unlockAt,
    });
    expect(stranger.script[0].blockedBy).toBe('threshold');
  });

  test('a hashlock always needs a preimage, even holding the key', async () => {
    const proof = locked([hashlock([pub(ALICE)])]);
    const { script } = await wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'preimage' });
    expect(script[0].keys).toHaveLength(1); // the key is still reported, for the caller's plan
  });

  test('leaves are reported in tree order, each judged on its own', async () => {
    const unlockAt = 4102444800;
    const proof = locked([
      threshold([pub(ALICE)]),
      after(unlockAt, [pub(BOB)]),
      hashlock([pub(ALICE)]),
    ]);
    const { script } = await wallet().spendOptions(proof, {
      privkeys: [priv(ALICE), priv(BOB)],
      now: unlockAt - 1,
    });
    expect(script.map((s) => s.leafIndex)).toEqual([0, 1, 2]);
    expect(script.map((s) => s.satisfiable)).toEqual([true, false, false]);
    expect(script.map((s) => s.blockedBy)).toEqual([undefined, 'locktime', 'preimage']);
  });

  test('a blinded leaf key is found at its slot and reported as blinded', async () => {
    const out = deriveReceiverKeyedSecret(pub(BOB), {
      leaves: [threshold([pub(ALICE)])],
      blindKeys: [pub(ALICE)],
    });
    const proof = v3Proof(out.secret, { E: out.E, tree: out.tree });
    const { keyPath, script } = await wallet().spendOptions(proof, {
      privkeys: [priv(ALICE), priv(BOB)],
    });
    expect(keyPath).toBe(true); // Bob's key path, over the disclosed tree
    expect(script[0].satisfiable).toBe(true);
    expect(script[0].keys[0].blinded).toBe(true);
    expect(script[0].keys[0].secretKey).not.toBe(priv(ALICE));
  });

  test('an unparseable leaf throws rather than being reported as spendable', async () => {
    // Leaf type 0x7f is not in the registry: the receive cascade fails closed on it, so this must
    // not quietly report a tree it cannot reason about.
    const good = serializeTaprootLeaf(threshold([pub(ALICE)]));
    const unknown = new Uint8Array(good);
    unknown[1] = 0x7f;
    const proof = v3Proof(pub(BOB), { K: pub(BOB), tree: [bytesToHex(unknown)] });
    await expect(wallet().spendOptions(proof, { privkeys: priv(ALICE) })).rejects.toThrow(/type/);
  });
});
