import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';

import { Amount, Wallet, createHTLCHash, createHTLCsecret, createP2PKsecret } from '../../src';
import { deriveP2BKBlindedPubkeys } from '../../src/crypto/NUT28';
import {
  buildNutrootSecret,
  deriveReceiverKeyedSecret,
  serializeNutrootLeaf,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
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
  amount: Amount.from(8),
  secret,
  C: 'aa'.repeat(48),
  ...(spend_info && { spend_info }),
});

// spendOptions is offline, so nothing here needs a loaded mint.
const wallet = () => new Wallet(mint);

describe('wallet.spendOptions: the key path', () => {
  test('rejects anything that is not a v3 point secret', async () => {
    // On a v3 keyset the secret must be a point: anything else is not a proof this mint issued.
    expect(() => wallet().spendOptions(v3Proof('deadbeef'))).toThrow(/point secrets/);
    expect(() =>
      wallet().spendOptions(v3Proof(JSON.stringify(['P2PK', { nonce: '', data: pub(1) }]))),
    ).toThrow(/point secrets/);
    expect(() => wallet().spendOptions(v3Proof(`02${'ff'.repeat(32)}`))).toThrow(/point secrets/);
  });

  test('finds a bearer key, and reports none when the spend info is empty', async () => {
    const k = priv(ALICE);
    const bare = v3Proof(pub(ALICE), { k });
    expect(wallet().spendOptions(bare)).toEqual({
      keyPath: true,
      script: [],
      spendable: true,
    });
    // Same proof with no spend info at all, and no seed to derive from: nothing to spend with.
    expect(wallet().spendOptions(v3Proof(pub(ALICE)))).toEqual({
      keyPath: false,
      script: [],
      spendable: false,
      blockedBy: 'not-keyed-to-you',
    });
    // A bearer key that does not match the secret is not a key path.
    expect(wallet().spendOptions(v3Proof(pub(BOB), { k }))).toEqual({
      keyPath: false,
      script: [],
      spendable: false,
      blockedBy: 'not-keyed-to-you',
    });
  });

  test('trial-matches a receiver-keyed proof against the keys supplied', async () => {
    const out = deriveReceiverKeyedSecret(pub(BOB));
    const proof = v3Proof(out.secret, { E: out.E });
    expect(wallet().spendOptions(proof, { privkeys: priv(BOB) }).keyPath).toBe(true);
    expect(wallet().spendOptions(proof, { privkeys: priv(STRANGER) }).keyPath).toBe(false);
    expect(wallet().spendOptions(proof).keyPath).toBe(false);
  });
});

describe('wallet.spendOptions: the script path', () => {
  const threshold = (keys: string[], n = 1): NutrootLeaf => ({ type: 'threshold', n, keys });
  const after = (time: number, keys: string[]): NutrootLeaf => ({
    type: 'after',
    n: 1,
    keys,
    time,
  });
  const hashlock = (keys: string[]): NutrootLeaf => ({
    type: 'hashlock',
    n: 1,
    keys,
    hash: 'bb'.repeat(32),
  });

  /**
   * A locked proof over `leaves`, disclosed with its internal key.
   */
  const locked = (leaves: NutrootLeaf[], internalSeed = BOB) => {
    const { secret, tree } = buildNutrootSecret(pub(internalSeed), leaves);
    return v3Proof(secret, { K: pub(internalSeed), tree });
  };

  test('a leaf whose key the wallet holds is satisfiable', async () => {
    const proof = locked([threshold([pub(ALICE)])]);
    const { script } = wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(script).toHaveLength(1);
    expect(script[0]).toMatchObject({ leafIndex: 0, satisfiable: true });
    expect(script[0].blockedBy).toBeUndefined();
    // The inspection surface reports which keys matched, never the scalars themselves.
    expect(script[0].keys).toEqual([{ keyIndex: 0, pubkey: pub(ALICE), blinded: false }]);
    expect(script[0].leaf).toEqual(threshold([pub(ALICE)]));
  });

  test('a stranger holds no keys and the leaf is blocked on the threshold', async () => {
    const proof = locked([threshold([pub(ALICE)])]);
    const { script } = wallet().spendOptions(proof, { privkeys: priv(STRANGER) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold', keys: [] });
  });

  test('a 2-of-2 leaf with one key held is blocked on the threshold', async () => {
    const proof = locked([threshold([pub(ALICE), pub(BOB)], 2)]);
    const { script } = wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold' });
    expect(script[0].keys).toHaveLength(1);
    // Both keys held: the threshold is met.
    const both = wallet().spendOptions(proof, { privkeys: [priv(ALICE), priv(BOB)] });
    expect(both.script[0].satisfiable).toBe(true);
  });

  test('duplicate copies of one private key count as one threshold signer', async () => {
    const proof = locked([threshold([pub(ALICE), pub(BOB)], 2)]);
    const { script } = wallet().spendOptions(proof, {
      privkeys: [priv(ALICE), priv(ALICE)],
    });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold' });
    expect(script[0].keys).toEqual([{ keyIndex: 0, pubkey: pub(ALICE), blinded: false }]);
  });

  test('a locktime blocks until it passes, and reports when that is', async () => {
    const unlockAt = 4102444800; // 2100-01-01
    const proof = locked([after(unlockAt, [pub(ALICE)])]);
    const before = wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt - 1 });
    expect(before.script[0]).toMatchObject({
      satisfiable: false,
      blockedBy: 'locktime',
      availableAt: unlockAt,
    });
    const at = wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt });
    expect(at.script[0]).toMatchObject({ satisfiable: true, availableAt: unlockAt });
    // A locktime that has passed but whose key is missing falls through to the threshold.
    const stranger = wallet().spendOptions(proof, {
      privkeys: priv(STRANGER),
      now: unlockAt,
    });
    expect(stranger.script[0].blockedBy).toBe('threshold');
  });

  test('a hashlock short on keys reports the threshold, not the preimage', async () => {
    // leaf.type already says a preimage is needed; the key shortfall is the
    // information the caller cannot read off the leaf itself.
    const proof = locked([hashlock([pub(ALICE)])]);
    const { script } = wallet().spendOptions(proof, { privkeys: priv(STRANGER) });
    expect(script[0]).toMatchObject({ satisfiable: false, blockedBy: 'threshold' });
  });

  test('a hashlock always needs a preimage, even holding the key', async () => {
    const proof = locked([hashlock([pub(ALICE)])]);
    const { script } = wallet().spendOptions(proof, { privkeys: priv(ALICE) });
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
    const { script } = wallet().spendOptions(proof, {
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
    const { keyPath, script } = wallet().spendOptions(proof, {
      privkeys: [priv(ALICE), priv(BOB)],
    });
    expect(keyPath).toBe(true); // Bob's key path, over the disclosed tree
    expect(script[0].satisfiable).toBe(true);
    expect(script[0].keys[0].blinded).toBe(true);
    // The reported key is the on-tree blinded form, not Alice's verbatim pubkey.
    expect(script[0].keys[0].pubkey).not.toBe(pub(ALICE));
  });

  test('an unparseable leaf throws rather than being reported as spendable', async () => {
    // Leaf type 0x7f is not in the registry: the receive cascade fails closed on it, so this must
    // not quietly report a tree it cannot reason about.
    const good = serializeNutrootLeaf(threshold([pub(ALICE)]));
    const unknown = new Uint8Array(good);
    unknown[1] = 0x7f;
    const proof = v3Proof(pub(BOB), { K: pub(BOB), tree: [bytesToHex(unknown)] });
    expect(() => wallet().spendOptions(proof, { privkeys: priv(ALICE) })).toThrow(/type/);
  });
});

describe('wallet.spendOptions: the verdict', () => {
  const threshold = (keys: string[], n = 1): NutrootLeaf => ({ type: 'threshold', n, keys });
  const after = (time: number, keys: string[]): NutrootLeaf => ({
    type: 'after',
    n: 1,
    keys,
    time,
  });
  const locked = (leaves: NutrootLeaf[]) => {
    const { secret, tree } = buildNutrootSecret(pub(BOB), leaves);
    return v3Proof(secret, { K: pub(BOB), tree });
  };
  const unlockAt = 4102444800;

  test('a proof keyed to someone else is not-keyed-to-you, whatever its tree says', async () => {
    // The payer-clawback shape: derived to the payer's own key, presented as a payment.
    const out = deriveReceiverKeyedSecret(pub(STRANGER));
    const theirs = v3Proof(out.secret, { E: out.E });
    expect(wallet().spendOptions(theirs, { privkeys: priv(ALICE) })).toMatchObject({
      spendable: false,
      blockedBy: 'not-keyed-to-you',
    });
    // A stranger's refund leaf is not "unlocks later" for a wallet holding none of its keys.
    const refundable = locked([threshold([pub(STRANGER)]), after(unlockAt, [pub(STRANGER)])]);
    const v = wallet().spendOptions(refundable, { privkeys: priv(ALICE), now: unlockAt - 1 });
    expect(v).toMatchObject({ spendable: false, blockedBy: 'not-keyed-to-you' });
    expect(v.availableAt).toBeUndefined();
  });

  test('a covered leaf waiting on its locktime reports when', async () => {
    const proof = locked([threshold([pub(STRANGER)]), after(unlockAt, [pub(ALICE)])]);
    const before = wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt - 1 });
    expect(before).toMatchObject({
      spendable: false,
      blockedBy: 'locktime',
      availableAt: unlockAt,
    });
    const at = wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt });
    expect(at).toMatchObject({ spendable: true });
    expect(at.blockedBy).toBeUndefined();
  });

  test('a key shortfall is threshold, a covered hashlock is preimage', async () => {
    const short = locked([threshold([pub(ALICE), pub(STRANGER)], 2)]);
    expect(wallet().spendOptions(short, { privkeys: priv(ALICE) })).toMatchObject({
      spendable: false,
      blockedBy: 'threshold',
    });
    const htlc = locked([{ type: 'hashlock', n: 1, keys: [pub(ALICE)], hash: 'bb'.repeat(32) }]);
    expect(wallet().spendOptions(htlc, { privkeys: priv(ALICE) })).toMatchObject({
      spendable: false,
      blockedBy: 'preimage',
    });
  });
});

describe('wallet.spendOptions: legacy and bearer proofs', () => {
  const LEGACY_KEYSET = `00${'11'.repeat(16)}`;
  const legacy = (secret: string, extra?: Partial<Proof>): Proof => ({
    id: LEGACY_KEYSET,
    amount: Amount.from(8),
    secret,
    C: 'aa'.repeat(33),
    ...extra,
  });
  const unlockAt = 4102444800;

  test('an unlocked bearer proof spends as it stands', async () => {
    expect(wallet().spendOptions(legacy('plain-secret'))).toEqual({
      keyPath: true,
      script: [],
      spendable: true,
    });
    // A legacy secret that happens to look like a point is still a plain secret.
    expect(wallet().spendOptions(legacy(pub(STRANGER))).spendable).toBe(true);
  });

  test('an unknown NUT-10 kind throws rather than being reported as spendable', async () => {
    const secret = JSON.stringify(['FOO', { nonce: 'ab', data: 'cd' }]);
    expect(() => wallet().spendOptions(legacy(secret))).toThrow(/kind/i);
  });

  test('a P2PK lock is one threshold leaf, matched across parity', async () => {
    const proof = legacy(createP2PKsecret(pub(ALICE)));
    const mine = wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(mine).toMatchObject({ keyPath: false, spendable: true });
    expect(mine.script).toEqual([
      {
        leafIndex: 0,
        leaf: { type: 'threshold', n: 1, keys: [pub(ALICE)] },
        keys: [{ keyIndex: 0, pubkey: pub(ALICE), blinded: false }],
        satisfiable: true,
      },
    ]);
    expect(wallet().spendOptions(proof, { privkeys: priv(STRANGER) })).toMatchObject({
      spendable: false,
      blockedBy: 'not-keyed-to-you',
    });
    // An x-only import (any nostr key) may hold the other parity's scalar for the published point.
    const flipped = (pub(ALICE).startsWith('02') ? '03' : '02') + pub(ALICE).slice(2);
    const twin = wallet().spendOptions(legacy(createP2PKsecret(flipped)), {
      privkeys: priv(ALICE),
    });
    expect(twin.spendable).toBe(true);
    expect(twin.script[0].keys[0].pubkey).toBe(flipped);
  });

  test('a locktime with refund keys is an after leaf at index 1', async () => {
    const secret = createP2PKsecret(pub(ALICE), [
      ['locktime', String(unlockAt)],
      ['refund', pub(BOB)],
    ]);
    const proof = legacy(secret);
    const bob = wallet().spendOptions(proof, { privkeys: priv(BOB), now: unlockAt - 1 });
    expect(bob.script.map((o) => o.leaf)).toEqual([
      { type: 'threshold', n: 1, keys: [pub(ALICE)] },
      { type: 'after', n: 1, keys: [pub(BOB)], time: unlockAt },
    ]);
    expect(bob).toMatchObject({ spendable: false, blockedBy: 'locktime', availableAt: unlockAt });
    expect(wallet().spendOptions(proof, { privkeys: priv(BOB), now: unlockAt }).spendable).toBe(
      true,
    );
    // Alice's main path is live on both sides of the locktime.
    expect(wallet().spendOptions(proof, { privkeys: priv(ALICE), now: unlockAt }).spendable).toBe(
      true,
    );
  });

  test('a locktime with no refund keys unlocks for anyone', async () => {
    const proof = legacy(createP2PKsecret(pub(ALICE), [['locktime', String(unlockAt)]]));
    const before = wallet().spendOptions(proof, {
      privkeys: priv(STRANGER),
      now: unlockAt - 1,
    });
    expect(before).toMatchObject({
      spendable: false,
      blockedBy: 'locktime',
      availableAt: unlockAt,
    });
    expect(before.script[1].leaf).toEqual({ type: 'after', n: 0, keys: [], time: unlockAt });
    const after = wallet().spendOptions(proof, { now: unlockAt });
    expect(after).toMatchObject({ spendable: true });
    expect(after.script[1].satisfiable).toBe(true);
  });

  test('a multisig short on keys is threshold', async () => {
    const secret = createP2PKsecret(pub(ALICE), [
      ['pubkeys', pub(BOB)],
      ['n_sigs', '2'],
    ]);
    expect(wallet().spendOptions(legacy(secret), { privkeys: priv(ALICE) })).toMatchObject({
      spendable: false,
      blockedBy: 'threshold',
    });
    const both = wallet().spendOptions(legacy(secret), {
      privkeys: [priv(ALICE), priv(BOB)],
    });
    expect(both.spendable).toBe(true);
    expect(both.script[0].keys.map((k) => k.keyIndex)).toEqual([0, 1]);
  });

  test('an HTLC is a hashlock leaf, keyed or not', async () => {
    const hash = 'cd'.repeat(32);
    const keyed = legacy(createHTLCsecret(hash, [['pubkeys', pub(ALICE)]]));
    const mine = wallet().spendOptions(keyed, { privkeys: priv(ALICE) });
    expect(mine.script[0].leaf).toEqual({ type: 'hashlock', n: 1, keys: [pub(ALICE)], hash });
    expect(mine).toMatchObject({ spendable: false, blockedBy: 'preimage' });
    expect(wallet().spendOptions(keyed, { privkeys: priv(STRANGER) })).toMatchObject({
      blockedBy: 'not-keyed-to-you',
    });
    // Keyless: the preimage alone spends it.
    const keyless = wallet().spendOptions(legacy(createHTLCsecret(hash)));
    expect(keyless.script[0].leaf).toEqual({ type: 'hashlock', n: 0, keys: [], hash });
    expect(keyless).toMatchObject({ spendable: false, blockedBy: 'preimage' });
  });

  test('a blinded (P2BK) key is recovered through p2pk_e and reported as blinded', async () => {
    const { blinded, Ehex } = deriveP2BKBlindedPubkeys([pub(ALICE)], new Uint8Array(32).fill(5));
    const proof = legacy(createP2PKsecret(blinded[0]), { p2pk_e: Ehex });
    const mine = wallet().spendOptions(proof, { privkeys: priv(ALICE) });
    expect(mine.spendable).toBe(true);
    expect(mine.script[0].keys).toEqual([{ keyIndex: 0, pubkey: blinded[0], blinded: true }]);
    expect(wallet().spendOptions(proof, { privkeys: priv(STRANGER) })).toMatchObject({
      blockedBy: 'not-keyed-to-you',
    });
  });
});

describe('wallet.planScriptPaths', () => {
  test('plans the first satisfiable leaf per key-path-less proof, skipping the rest', async () => {
    const threshold = (keys: string[]): NutrootLeaf => ({ type: 'threshold', n: 1, keys });
    const locked = (leaves: NutrootLeaf[]) => {
      const { secret, tree } = buildNutrootSecret(pub(BOB), leaves);
      return v3Proof(secret, { K: pub(BOB), tree });
    };
    const plain: Proof = {
      id: `00${'11'.repeat(16)}`,
      amount: Amount.from(1),
      secret: 'plain-secret',
      C: 'aa'.repeat(33),
    };
    const bearer = v3Proof(pub(ALICE), { k: priv(ALICE) });
    const claimable = locked([threshold([pub(STRANGER)]), threshold([pub(ALICE)])]);
    const stuck = locked([threshold([pub(STRANGER)])]);
    const plans = wallet().planScriptPaths([plain, bearer, claimable, stuck], {
      privkeys: priv(ALICE),
    });
    // plain (not v3) and bearer (key path) are skipped without throwing; the
    // stuck proof yields no plan; the claimable one names its second leaf.
    expect(plans).toEqual([{ secret: claimable.secret, leafIndex: 1 }]);
  });

  test('a preimage plans the hashlock leaf it opens, after any satisfiable leaf', async () => {
    const { hash, preimage } = createHTLCHash();
    const threshold = (keys: string[]): NutrootLeaf => ({ type: 'threshold', n: 1, keys });
    const hashlock = (keys: string[], h = hash): NutrootLeaf => ({
      type: 'hashlock',
      n: 1,
      keys,
      hash: h,
    });
    const locked = (leaves: NutrootLeaf[]) => {
      const { secret, tree } = buildNutrootSecret(pub(BOB), leaves);
      return v3Proof(secret, { K: pub(BOB), tree });
    };
    const opens = locked([hashlock([pub(ALICE)])]);
    const otherHash = locked([hashlock([pub(ALICE)], 'cc'.repeat(32))]);
    const alsoOpen = locked([hashlock([pub(ALICE)]), threshold([pub(ALICE)])]);
    const unkeyed = locked([hashlock([pub(STRANGER)])]);
    const proofs = [opens, otherHash, alsoOpen, unkeyed];
    // The satisfiable leaf wins without revealing anything; the preimage only
    // plans a hashlock it opens whose keys are held.
    expect(wallet().planScriptPaths(proofs, { privkeys: priv(ALICE), preimage })).toEqual([
      { secret: opens.secret, leafIndex: 0, preimage },
      { secret: alsoOpen.secret, leafIndex: 1 },
    ]);
    expect(wallet().planScriptPaths([opens], { privkeys: priv(ALICE) })).toEqual([]);
    expect(() =>
      wallet().planScriptPaths([opens], { privkeys: priv(ALICE), preimage: 'not-hex' }),
    ).toThrow(/64 hex/);
  });
});
