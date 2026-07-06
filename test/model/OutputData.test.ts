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
import {
  MAX_SECRET_LENGTH,
  OutputData,
  assertValidTagKey,
  RESERVED_P2PK_TAGS,
} from '../../src/model/OutputData';
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

/**
 * Reads the parsed NUT-10 secret `[kind, {data, tags}]` from an OutputData.
 */
function readSecret(output: OutputData): { kind: string; data: string; tags: string[][] } {
  const [kind, body] = JSON.parse(new TextDecoder().decode(output.secret)) as [
    string,
    { data: string; tags: string[][] },
  ];
  return { kind, data: body.data, tags: body.tags };
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

  test('wraps a missing secp keyset key with the underlying cause', () => {
    // Blank output (amount=0) lets the mint pick; amount 128 is not in the keyset, so `keys[128]`
    // is undefined. toProof must surface a CTSError whose cause names the offending amount.
    const blank = OutputData.createSingleRandomData(0, keyset.id);
    const B_ = pointFromHex(blank.blindedMessage.B_);
    const C_ = createBlindSignature(B_, privKeys['2'], keyset.id).C_;
    const sig: SerializedBlindedSignature = {
      id: keyset.id,
      amount: Amount.from(128),
      C_: C_.toHex(true),
    };
    let caught: unknown;
    try {
      blank.toProof(sig, keyset);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CTSError);
    expect((caught as CTSError).message).toMatch(/Mint returned invalid signature or amount/);
    const cause = (caught as CTSError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toMatch(/Amount 128 not in keyset/);
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

describe('OutputData.createSingleP2PKData tag construction', () => {
  const KEYSET_ID = '009a1f293253e41e';
  const pub = (i: number): string => bytesToHex(getPubKeyFromPrivKey(secpPriv(i)));

  test('does not blind keys when blindKeys is unset', () => {
    const data = pub(0);
    const out = OutputData.createSingleP2PKData({ kind: 'P2PK', data }, 1, KEYSET_ID);
    expect(out.ephemeralE).toBeUndefined();
    // data key stays in the clear (kills `if (blindKeys)` -> true).
    expect(readSecret(out).data).toBe(data);
  });

  test('P2PK blinding: data key blinded, pubkeys/refund sliced by role', () => {
    const data = pub(0);
    const extraPub = pub(1);
    const refundKey = pub(2);
    const out = OutputData.createSingleP2PKData(
      {
        kind: 'P2PK',
        data,
        pubkeys: [extraPub],
        refundKeys: [refundKey],
        locktime: 1700000000,
        blindKeys: true,
      },
      1,
      KEYSET_ID,
    );
    const { data: secretData, tags } = readSecret(out);
    const pubkeysTag = tags.find(([t]) => t === 'pubkeys');
    const refundTag = tags.find(([t]) => t === 'refund');

    expect(out.ephemeralE).toBeDefined();
    // First locking key sits in data, blinded (kills `if (isHTLC)` -> true and the else-block wipe).
    expect(secretData).not.toBe(data);
    expect(secretData).toMatch(/^0[23][0-9a-f]{64}$/);
    // Exactly one extra locking key in pubkeys (kills slice(1, lockKeys.length) -> blinded).
    expect(pubkeysTag?.slice(1)).toHaveLength(1);
    expect(pubkeysTag?.[1]).not.toBe(extraPub);
    // Exactly one refund key (kills slice(lockKeys.length) -> blinded).
    expect(refundTag?.slice(1)).toHaveLength(1);
    expect(refundTag?.[1]).not.toBe(refundKey);
  });

  test('HTLC blinding: hashlock stays clear, all lock keys blinded into pubkeys', () => {
    const hashlock = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';
    const lock1 = pub(1);
    const lock2 = pub(2);
    const refundKey = pub(3);
    const out = OutputData.createSingleP2PKData(
      {
        kind: 'HTLC',
        data: hashlock,
        pubkeys: [lock1, lock2],
        refundKeys: [refundKey],
        locktime: 1700000000,
        blindKeys: true,
      },
      1,
      KEYSET_ID,
    );
    const { kind, data: secretData, tags } = readSecret(out);
    const pubkeysTag = tags.find(([t]) => t === 'pubkeys');
    const refundTag = tags.find(([t]) => t === 'refund');

    expect(kind).toBe('HTLC');
    expect(secretData).toBe(hashlock);
    // Both lock keys land in pubkeys, blinded (kills slice(0, lockKeys.length) -> blinded, which
    // would also fold the refund key into pubkeys).
    expect(pubkeysTag?.slice(1)).toHaveLength(2);
    expect(pubkeysTag?.[1]).not.toBe(lock1);
    expect(pubkeysTag?.[2]).not.toBe(lock2);
    expect(refundTag?.slice(1)).toHaveLength(1);
  });

  test('emits a locktime tag for locktime 0 (boundary)', () => {
    const out = OutputData.createSingleP2PKData(
      { kind: 'P2PK', data: pub(0), locktime: 0 },
      1,
      KEYSET_ID,
    );
    const locktimeTag = readSecret(out).tags.find(([t]) => t === 'locktime');
    // locktime 0 is valid (kills `ts >= 0` -> `ts > 0`).
    expect(locktimeTag).toEqual(['locktime', '0']);
  });

  test('emits a locktime tag for a positive locktime', () => {
    const out = OutputData.createSingleP2PKData(
      { kind: 'P2PK', data: pub(0), locktime: 1700000000 },
      1,
      KEYSET_ID,
    );
    expect(readSecret(out).tags.find(([t]) => t === 'locktime')).toEqual([
      'locktime',
      '1700000000',
    ]);
  });

  test('omits the locktime tag for a negative locktime', () => {
    const out = OutputData.createSingleP2PKData(
      { kind: 'P2PK', data: pub(0), locktime: -1 },
      1,
      KEYSET_ID,
    );
    // -1 fails the `>= 0` guard; a mutated `||`/forced-true guard would emit the tag anyway.
    expect(readSecret(out).tags.find(([t]) => t === 'locktime')).toBeUndefined();
  });

  test('emits an exact sigflag tag for SIG_ALL', () => {
    const out = OutputData.createSingleP2PKData(
      { kind: 'P2PK', data: pub(0), sigFlag: 'SIG_ALL' },
      1,
      KEYSET_ID,
    );
    // Exact contents guard against dropped/blanked strings and the emptied push array.
    expect(readSecret(out).tags.find(([t]) => t === 'sigflag')).toEqual(['sigflag', 'SIG_ALL']);
  });

  test('omits the sigflag tag when not SIG_ALL', () => {
    const out = OutputData.createSingleP2PKData({ kind: 'P2PK', data: pub(0) }, 1, KEYSET_ID);
    expect(readSecret(out).tags.find(([t]) => t === 'sigflag')).toBeUndefined();
  });

  test('accepts a secret of exactly MAX_SECRET_LENGTH code points', () => {
    // Pad an additional tag value so the JSON secret hits the limit exactly. Each ASCII 'A' adds
    // one code point with no JSON escaping, so length is linear in the pad size.
    const build = (pad: number): OutputData =>
      OutputData.createSingleP2PKData(
        { kind: 'P2PK', data: pub(0), additionalTags: [['x', 'A'.repeat(pad)]] },
        1,
        KEYSET_ID,
      );
    const base = [...new TextDecoder().decode(build(0).secret)].length;
    const target = MAX_SECRET_LENGTH - base;

    const atLimit = build(target);
    // Exactly MAX_SECRET_LENGTH must be accepted (kills `>` -> `>=`).
    expect([...new TextDecoder().decode(atLimit.secret)].length).toBe(MAX_SECRET_LENGTH);
    // One over must be rejected.
    expect(() => build(target + 1)).toThrowError(/Secret too long/);
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
