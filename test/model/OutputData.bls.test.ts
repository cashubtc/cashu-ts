import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import {
  blindMessageBls,
  createBlindSignatureBls,
  pointFromHexG1,
  verifyUnblindedSignatureBls,
} from '../../src/crypto/bls';
import { verifyUnblindedSignature } from '../../src/crypto/NUT01';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';
import { deriveKeysetId } from '../../src/utils';
import type { HasKeysetKeys, SerializedBlindedSignature } from '../../src/model/types';

// v3 (BLS12-381) round-trip through OutputData → simulated mint sign → toProof → pairing verify.
//
// Mint side is simulated with createBlindSignatureBls: there is no live mint, but the curve math
// is identical to what Nutshell PR #999 runs, so a successful pairing equality at the end is
// sufficient to demonstrate the wallet path (mint quote → swap → melt) is curve-correct end to end.

const AMOUNTS = [1, 2, 4, 8, 16, 32, 64];

function makeV3Keyset(): {
  keyset: HasKeysetKeys;
  privKeys: Record<string, Uint8Array>;
  G2PubKeys: Record<string, ReturnType<typeof bls12_381.G2.Point.BASE.multiply>>;
} {
  // Deterministic per-amount mint secrets so the test vector is stable.
  const privKeys: Record<string, Uint8Array> = {};
  const G2PubKeys: Record<string, ReturnType<typeof bls12_381.G2.Point.BASE.multiply>> = {};
  const keys: Record<string, string> = {};
  for (let i = 0; i < AMOUNTS.length; i++) {
    const a = AMOUNTS[i];
    const seed = new Uint8Array(32);
    seed[31] = i + 1; // 1..n, all in-range for Fr
    privKeys[String(a)] = seed;
    const aScalar = bls12_381.fields.Fr.fromBytes(seed);
    const K2 = bls12_381.G2.Point.BASE.multiply(aScalar);
    G2PubKeys[String(a)] = K2;
    keys[String(a)] = bytesToHex(K2.toBytes(true));
  }
  const id = deriveKeysetId(keys, { versionByte: 2, unit: 'sat' });
  return { keyset: { id, keys }, privKeys, G2PubKeys };
}

function signWithMint(
  output: OutputData,
  privKeys: Record<string, Uint8Array>,
  id: string,
): SerializedBlindedSignature {
  const amount = output.blindedMessage.amount;
  const a = privKeys[amount.toString()];
  const B_ = pointFromHexG1(output.blindedMessage.B_);
  const blind = createBlindSignatureBls(B_, a, id);
  return { id: blind.id, amount, C_: blind.C_.toHex(true) };
}

describe('OutputData v3 round-trip (BLS12-381)', () => {
  const { keyset, privKeys, G2PubKeys } = makeV3Keyset();

  test('keyset id is a valid v3 id (prefix 02, 66 hex chars)', () => {
    expect(keyset.id).toMatch(/^02[0-9a-f]{64}$/);
  });

  test('createSingleRandomData produces a 96-hex G1 B_ for v3 keyset', () => {
    const out = OutputData.createSingleRandomData(1, keyset.id);
    expect(out.blindedMessage.B_).toMatch(/^[0-9a-f]{96}$/);
    expect(out.blindedMessage.id).toBe(keyset.id);
  });

  // ~21 BLS pairings (7 amounts × 3 verifications each). Locally ~700ms, but under the
  // 4-environment parallel run (node + chromium + firefox + webkit), CPU contention can
  // push this past the 5s default. Bumped to absorb that noise.
  test('full mint → swap path: outputs round-trip and verify under pairing', () => {
    const outputs = AMOUNTS.map((a) => OutputData.createSingleRandomData(a, keyset.id));
    const sigs = outputs.map((o) => signWithMint(o, privKeys, keyset.id));

    const proofs = outputs.map((o, i) => o.toProof(sigs[i], keyset));

    expect(proofs).toHaveLength(AMOUNTS.length);
    for (let i = 0; i < proofs.length; i++) {
      const p = proofs[i];
      expect(p.id).toBe(keyset.id);
      expect(p.C).toMatch(/^[0-9a-f]{96}$/);
      expect(p.amount).toEqual(Amount.from(AMOUNTS[i]));
      expect((p as { dleq?: unknown }).dleq).toBeUndefined();
      // Wallet-side pairing check (mirrors what the next mint operation will run in batch).
      const K2 = G2PubKeys[p.amount.toString()];
      const C = pointFromHexG1(p.C);
      const secret = new TextEncoder().encode(p.secret);
      expect(verifyUnblindedSignatureBls(K2, C, secret)).toBe(true);
      // Mint-side equality check matches verifyUnblindedSignature dispatch.
      expect(verifyUnblindedSignature({ id: p.id, C, secret }, privKeys[p.amount.toString()])).toBe(
        true,
      );
    }
  }, 15000);

  test('deterministic v3 derivation produces a verifiable proof', () => {
    const seed = hexToBytes('11'.repeat(32));
    const out = OutputData.createSingleDeterministicData(4, seed, 0, keyset.id);
    expect(out.blindedMessage.B_).toMatch(/^[0-9a-f]{96}$/);

    const sig = signWithMint(out, privKeys, keyset.id);
    const proof = out.toProof(sig, keyset);
    expect(proof.dleq).toBeUndefined();

    const C = pointFromHexG1(proof.C);
    const secret = new TextEncoder().encode(proof.secret);
    expect(verifyUnblindedSignatureBls(G2PubKeys['4'], C, secret)).toBe(true);
  });

  test('toProof rejects a forged C_ via inline pairing check', () => {
    const out = OutputData.createSingleRandomData(8, keyset.id);

    // Forge: substitute another amount's signing key on the same B_. The resulting C does not
    // satisfy `e(C, G2) == e(Y, K2_8)`, so toProof's inline pairing check MUST throw. This is
    // the mint/swap-path defence against a malicious mint returning garbage — without it the
    // wallet would store an invalid proof, mark inputs spent, and lose funds.
    const B_ = pointFromHexG1(out.blindedMessage.B_);
    const forged = createBlindSignatureBls(B_, privKeys['16'], keyset.id);
    const tamperedSig: SerializedBlindedSignature = {
      id: keyset.id,
      amount: out.blindedMessage.amount,
      C_: forged.C_.toHex(true),
    };
    expect(() => out.toProof(tamperedSig, keyset)).toThrowError(/BLS pairing verification failed/);
  });

  test('toProof rejects a completely garbage C_ (CTF: malicious mint)', () => {
    const out = OutputData.createSingleRandomData(8, keyset.id);
    // A G1 point unrelated to the output's Y is overwhelmingly unlikely to satisfy the pairing.
    const garbageC_ = bls12_381.G1.Point.BASE.multiply(424242n);
    const garbageSig: SerializedBlindedSignature = {
      id: keyset.id,
      amount: out.blindedMessage.amount,
      C_: garbageC_.toHex(true),
    };
    expect(() => out.toProof(garbageSig, keyset)).toThrowError(/BLS pairing verification failed/);
  });

  test('round-trip preserves the wallet-chosen secret bytes', () => {
    const out = OutputData.createSingleRandomData(2, keyset.id);
    const originalSecret = new TextDecoder().decode(out.secret);
    const sig = signWithMint(out, privKeys, keyset.id);
    const proof = out.toProof(sig, keyset);
    expect(proof.secret).toBe(originalSecret);
  });

  test('toProof rejects amount downgrade (malicious mint)', () => {
    // Request amount=8; mint returns a perfectly valid v3 signature for amount=4 on the
    // same B_. The pairing check against K2_4 would succeed — funds-loss vector if the
    // request/response amount mismatch is not enforced before key lookup.
    const out = OutputData.createSingleRandomData(8, keyset.id);
    const B_ = pointFromHexG1(out.blindedMessage.B_);
    const downgraded = createBlindSignatureBls(B_, privKeys['4'], keyset.id);
    const downgradedSig: SerializedBlindedSignature = {
      id: keyset.id,
      amount: Amount.from(4),
      C_: downgraded.C_.toHex(true),
    };
    expect(() => out.toProof(downgradedSig, keyset)).toThrowError(
      /does not match requested amount/,
    );
  });

  test('toProof accepts amount=0 blank (NUT-08 fee change / NUT-09 restore)', () => {
    // Blank outputs declare amount=0 up front; the mint chooses the actual denomination.
    // toProof must trust sig.amount for key lookup and final Proof.amount in this case.
    const blank = OutputData.createSingleRandomData(0, keyset.id);
    const B_ = pointFromHexG1(blank.blindedMessage.B_);
    // Mint fills in amount=2 from the blank
    const filled = createBlindSignatureBls(B_, privKeys['2'], keyset.id);
    const sig: SerializedBlindedSignature = {
      id: keyset.id,
      amount: Amount.from(2),
      C_: filled.C_.toHex(true),
    };
    const proof = blank.toProof(sig, keyset);
    expect(proof.amount).toEqual(Amount.from(2));
    const C = pointFromHexG1(proof.C);
    const secret = new TextEncoder().encode(proof.secret);
    expect(verifyUnblindedSignatureBls(G2PubKeys['2'], C, secret)).toBe(true);
  });
});

describe('OutputData v3 — Nutshell PR #999 deterministic test vector', () => {
  // Cross-check the integration path against the locked Nutshell vector (secret="test_message",
  // r=3, mint scalar a=2). This is the same vector as test/crypto/bls.test.ts but exercised
  // through the OutputData factory + toProof path, so any future regression in the path
  // (and not the primitives) is caught here.
  const SECRET = 'test_message';
  const NUTSHELL_B_HEX =
    '8e88c5f6a93f653784a66b033a00e52128499e18b095c2a56f080d1c2a937ffc9ef4600804a48d087bbd1f662f6b068f';
  const NUTSHELL_C_HEX =
    'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';

  test('matches Nutshell B_ and C through toProof', () => {
    // Drive the deterministic blinding directly via blindMessageBls so we hit the exact r=3.
    const secretBytes = new TextEncoder().encode(SECRET);
    const { B_, r } = blindMessageBls(secretBytes, 3n);
    expect(bytesToHex(B_.toBytes(true))).toBe(NUTSHELL_B_HEX);

    const id = '02' + '00'.repeat(32); // arbitrary v3-shaped id — toProof dispatches on prefix only
    // Build an OutputData by hand so we can lock r=3 exactly.
    const od = OutputData.deserialize({
      blindedMessage: { amount: '1', B_: B_.toHex(true), id },
      blindingFactor: r.toString(),
      secret: bytesToHex(secretBytes),
    });

    const aBytes = hexToBytes('0'.repeat(63) + '2'); // mint scalar a=2
    const { C_ } = createBlindSignatureBls(B_, aBytes, id);

    const sig: SerializedBlindedSignature = {
      id,
      amount: Amount.from(1),
      C_: C_.toHex(true),
    };
    // K2 = a·G2_BASE for a=2 — required for the inline pairing check inside toProof.
    const K2Hex = bytesToHex(bls12_381.G2.Point.BASE.multiply(2n).toBytes(true));
    const proof = od.toProof(sig, { id, keys: { '1': K2Hex } });
    expect(proof.C).toBe(NUTSHELL_C_HEX);
    expect(proof.secret).toBe(SECRET);
  });
});
