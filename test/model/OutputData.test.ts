import { bytesToHex } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import {
  blindMessage,
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  hashToCurve,
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

  test('rejects a mint response that unblinds to a non-UTF-8 secret', () => {
    // Bypass the factories (which only ever build UTF-8 secrets) to exercise toProof's own guard.
    const secretBytes = Uint8Array.of(0xff);
    const { r, B_ } = blindMessage(secretBytes);
    const out = new OutputData(
      { amount: Amount.from(1), B_: B_.toHex(true), id: keyset.id },
      r,
      secretBytes,
    );
    const sig = signWithMint(out, privKeys, keyset.id);
    expect(() => out.toProof(sig, keyset)).toThrow(/utf-8/i);
  });

  test('keeps a leading BOM as secret content so the proof re-encodes to the bytes that were blinded', () => {
    // efbbbf61 is a UTF-8 BOM followed by 'a'; the mint hashes the UTF-8 bytes of the string it
    // receives, so the BOM must survive decoding or Y would no longer match.
    const secretBytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x61);
    const { r, B_ } = blindMessage(secretBytes);
    const out = new OutputData(
      { amount: Amount.from(1), B_: B_.toHex(true), id: keyset.id },
      r,
      secretBytes,
    );
    const sig = signWithMint(out, privKeys, keyset.id);
    const proof = out.toProof(sig, keyset);
    expect(proof.secret).toBe('\uFEFFa');
    expect(new TextEncoder().encode(proof.secret)).toEqual(secretBytes);
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

  test('accepts a blinded message that matches its secret and blinding factor', () => {
    const original = OutputData.createSingleRandomData(1, '009a1f293253e41e');
    const serialized = OutputData.serialize(original);
    const restored = OutputData.deserialize(serialized);
    expect(restored.blindedMessage.B_).toBe(original.blindedMessage.B_);
  });

  test('rejects a blinded message that does not match its secret and blinding factor', () => {
    const original = OutputData.createSingleRandomData(1, '009a1f293253e41e');
    const replacement = OutputData.createSingleRandomData(1, '009a1f293253e41e');
    const serialized = OutputData.serialize(original);

    expect(() =>
      OutputData.deserialize({
        ...serialized,
        blindedMessage: { ...serialized.blindedMessage, B_: replacement.blindedMessage.B_ },
      }),
    ).toThrow(/does not match/i);
  });

  test('rejects a zero blinding factor', () => {
    const secret = new TextEncoder().encode('output-secret');
    const Y = hashToCurve(secret);

    expect(() =>
      OutputData.deserialize({
        blindedMessage: { amount: '1', B_: Y.toHex(true), id: '009a1f293253e41e' },
        blindingFactor: '0',
        secret: bytesToHex(secret),
      }),
    ).toThrow(/blinding factor/i);
  });

  test('rejects a malformed persisted P2BK ephemeral public key', () => {
    const output = OutputData.createSingleP2PKData(
      { pubkey: bytesToHex(getPubKeyFromPrivKey(secpPriv(0))), blindKeys: true },
      1,
      '009a1f293253e41e',
    );
    const serialized = OutputData.serialize(output);
    expect(serialized.ephemeralE).toBeDefined();
    expect(OutputData.deserialize(serialized).ephemeralE).toBe(serialized.ephemeralE);
    expect(() => OutputData.deserialize({ ...serialized, ephemeralE: 'not-hex' })).toThrow(
      /invalid/i,
    );
  });

  test('rejects secret bytes that cannot round-trip through a UTF-8 proof string', () => {
    const secret = Uint8Array.of(0xff);
    const { B_, r } = blindMessage(secret, 1n);

    expect(() =>
      OutputData.deserialize({
        blindedMessage: { amount: '1', B_: B_.toHex(true), id: '009a1f293253e41e' },
        blindingFactor: r.toString(),
        secret: 'ff',
      }),
    ).toThrow(/utf-8/i);
  });

  test('accepts a secret with a leading BOM and preserves its bytes', () => {
    // efbbbf61 is a UTF-8 BOM followed by 'a'; the BOM is content, not framing, so the stored
    // bytes round-trip unchanged and still match B_.
    const secret = Uint8Array.of(0xef, 0xbb, 0xbf, 0x61);
    const { B_, r } = blindMessage(secret, 1n);

    const restored = OutputData.deserialize({
      blindedMessage: { amount: '1', B_: B_.toHex(true), id: '009a1f293253e41e' },
      blindingFactor: r.toString(),
      secret: 'efbbbf61',
    });
    expect(restored.secret).toEqual(secret);
  });
});
