import { bytesToHex } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import {
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  pointFromHex,
} from '../../src/crypto';
import { verifyUnblindedSignature } from '../../src/crypto/NUT01';
import { Amount } from '../../src/model/Amount';
import { CTSError } from '../../src/model/Errors';
import { OutputData, assertValidTagKey, RESERVED_P2PK_TAGS } from '../../src/model/OutputData';
import type { HasKeysetKeys, SerializedBlindedSignature } from '../../src/model/types';
import { deriveKeysetId, numberToHexPadded64 } from '../../src/utils';

// secp256k1 (v0/v1) round-trip through OutputData -> simulated mint sign+DLEQ -> toProof.
// The mint side is simulated with createBlindSignature/createDLEQProof: the curve math matches a
// real mint, so a passing DLEQ verification plus keyed unblind equality is sufficient to show the
// wallet path is curve-correct end to end.

const AMOUNTS = [1, 2, 4, 8, 16, 32, 64];

function secpPriv(i: number): Uint8Array {
  const k = new Uint8Array(32);
  k[31] = i + 1; // 1..n, in-range non-zero scalar
  return k;
}

function makeSecpKeyset(): { keyset: HasKeysetKeys; privKeys: Record<string, Uint8Array> } {
  const privKeys: Record<string, Uint8Array> = {};
  const keys: Record<string, string> = {};
  for (let i = 0; i < AMOUNTS.length; i++) {
    const a = String(AMOUNTS[i]);
    const priv = secpPriv(i);
    privKeys[a] = priv;
    keys[a] = bytesToHex(getPubKeyFromPrivKey(priv)); // A = a·G, compressed
  }
  const id = deriveKeysetId(keys, { versionByte: 0, unit: 'sat' });
  return { keyset: { id, keys }, privKeys };
}

function signWithMint(
  output: OutputData,
  privKeys: Record<string, Uint8Array>,
  id: string,
  withDleq = true,
): SerializedBlindedSignature {
  const amount = output.blindedMessage.amount;
  const a = privKeys[amount.toString()];
  const B_ = pointFromHex(output.blindedMessage.B_);
  const C_ = createBlindSignature(B_, a, id).C_;
  const sig: SerializedBlindedSignature = { id, amount, C_: C_.toHex(true) };
  if (withDleq) {
    const dleq = createDLEQProof(B_, a);
    sig.dleq = { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) };
  }
  return sig;
}

describe('OutputData secp round-trip (secp256k1 + NUT-12 DLEQ)', () => {
  const { keyset, privKeys } = makeSecpKeyset();

  test('createSingleRandomData produces a 66-hex compressed secp B_', () => {
    const out = OutputData.createSingleRandomData(1, keyset.id);
    expect(out.blindedMessage.B_).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(out.blindedMessage.id).toBe(keyset.id);
  });

  test('full mint -> swap path: outputs round-trip, verify DLEQ, and unblind to C = a·Y', () => {
    const outputs = AMOUNTS.map((a) => OutputData.createSingleRandomData(a, keyset.id));
    const sigs = outputs.map((o) => signWithMint(o, privKeys, keyset.id));

    const proofs = outputs.map((o, i) => o.toProof(sigs[i], keyset));

    expect(proofs).toHaveLength(AMOUNTS.length);
    for (let i = 0; i < proofs.length; i++) {
      const p = proofs[i];
      const priv = privKeys[p.amount.toString()];
      expect(p.id).toBe(keyset.id);
      expect(p.amount).toEqual(Amount.from(AMOUNTS[i]));
      // C is a compressed secp point (kills the toHex(true) -> toHex(false) mutant).
      expect(p.C).toMatch(/^0[23][0-9a-f]{64}$/);
      expect('p2pk_e' in p).toBe(false);
      // Keyed unblind correctness: C must equal a·hashToCurve(secret).
      const C = pointFromHex(p.C);
      const secret = new TextEncoder().encode(p.secret);
      expect(verifyUnblindedSignature({ id: p.id, C, secret }, priv)).toBe(true);
    }
  });

  test('attaches the DLEQ proof with wallet r on the Proof', () => {
    const out = OutputData.createSingleRandomData(8, keyset.id);
    const sig = signWithMint(out, privKeys, keyset.id);
    const proof = out.toProof(sig, keyset);

    expect(proof.dleq).toBeDefined();
    // s/e are copied straight from the mint signature (kills dleq -> {} mutant).
    expect(proof.dleq?.s).toBe(sig.dleq?.s);
    expect(proof.dleq?.e).toBe(sig.dleq?.e);
    // The wallet's own blinding factor is the DLEQ r on the proof path, serialized 64-hex padded.
    // It must be the real r, never 64 zero-hex (kills the `?? BigInt(0)` -> `&& BigInt(0)` mutant).
    expect(proof.dleq?.r).toBe(numberToHexPadded64(out.blindingFactor));
    expect(proof.dleq?.r).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.dleq?.r).not.toBe('0'.repeat(64));
  });

  test('omits DLEQ when the mint returns no DLEQ', () => {
    const out = OutputData.createSingleRandomData(4, keyset.id);
    const sig = signWithMint(out, privKeys, keyset.id, false);
    const proof = out.toProof(sig, keyset);
    expect(proof.dleq).toBeUndefined();
  });

  test('rejects a tampered DLEQ proof', () => {
    const out = OutputData.createSingleRandomData(2, keyset.id);
    const sig = signWithMint(out, privKeys, keyset.id);
    // Flip one nibble of e so the challenge no longer matches.
    const badE = (sig.dleq?.e ?? '').replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    const tampered: SerializedBlindedSignature = { ...sig, dleq: { s: sig.dleq!.s, e: badE } };
    expect(() => out.toProof(tampered, keyset)).toThrowError(/DLEQ verification failed/);
  });
});

describe('OutputData.assertValidTagKey and reserved tags', () => {
  test('rejects every reserved P2PK tag key', () => {
    for (const key of RESERVED_P2PK_TAGS) {
      expect(() => assertValidTagKey(key)).toThrowError(/reserved key/);
    }
    // Explicit check for the last reserved entry, guarding against a dropped set member.
    expect(() => assertValidTagKey('sigflag')).toThrowError(/reserved key/);
    expect(() => assertValidTagKey('n_sigs_refund')).toThrowError(/reserved key/);
  });

  test('rejects an empty tag key', () => {
    expect(() => assertValidTagKey('')).toThrowError(/non empty string/);
  });

  test('accepts a non-reserved key', () => {
    expect(() => assertValidTagKey('memo')).not.toThrow();
  });
});

describe('OutputData.deserialize', () => {
  test('wraps a malformed serialized payload with the underlying cause', () => {
    const serialized = OutputData.serialize(
      OutputData.createSingleRandomData(1, '009a1f293253e41e'),
    );
    let caught: unknown;
    try {
      OutputData.deserialize({ ...serialized, blindingFactor: '0x01' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CTSError);
    expect((caught as CTSError).message).toMatch(/Invalid SerializedOutputData/);
    // Cause must be preserved for diagnostics (kills `{ cause: e }` -> `{}`).
    expect((caught as CTSError).cause).toBeInstanceOf(Error);
  });
});
