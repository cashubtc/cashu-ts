import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test, vi } from 'vitest';

import {
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  hashToCurve,
  P2BK_DST,
  pointFromHex,
  type P2PKOptions,
} from '../../src/crypto';
import { Amount, type AmountLike } from '../../src/model/Amount';
import { OutputData, isOutputDataFactory } from '../../src/model/OutputData';
import type { OutputDataFactory, OutputDataLike } from '../../src/model/OutputData';
import { DefaultOutputDataCreator } from '../../src/model/OutputDataCreator';
import type { HasKeysetKeys, SerializedBlindedSignature, Proof } from '../../src/model/types';

describe('DefaultOutputDataCreator', () => {
  test('delegates single deterministic output creation to OutputData', () => {
    const creator = new DefaultOutputDataCreator();
    const seed = new Uint8Array([1]);
    const keysetId = '012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30';

    expect(creator.createSingleDeterministicData(1, seed, 7, keysetId)).toEqual(
      OutputData.createSingleDeterministicData(1, seed, 7, keysetId),
    );
  });

  test('uses the batch path when the single-output hook is not overridden', () => {
    const keyset: HasKeysetKeys = {
      id: '012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
      keys: { '1': 'unused', '2': 'unused' },
    };
    const seed = new Uint8Array([1]);
    const creator = new DefaultOutputDataCreator();
    const batchSpy = vi.spyOn(OutputData, 'createDeterministicData');

    const outputs = creator.createDeterministicData(3, seed, 7, keyset, [1, 2]);

    // Default hook must delegate to the optimized batch method, not the per-output loop.
    expect(batchSpy).toHaveBeenCalledWith(3, seed, 7, keyset, [1, 2]);
    batchSpy.mockRestore();
    expect(outputs).toEqual(OutputData.createDeterministicData(3, seed, 7, keyset, [1, 2]));
  });

  test('default P2PK batch shares one ephemeral key for a blinded SIG_ALL split', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const keyset: HasKeysetKeys = {
      id: '009a1f293253e41e',
      keys: { '1': 'unused', '2': 'unused', '4': 'unused' },
    };

    const outputs = new DefaultOutputDataCreator().createP2PKData(
      { pubkey, blindKeys: true, sigFlag: 'SIG_ALL' },
      7,
      keyset,
    );

    expect(outputs).toHaveLength(3);
    expect(new Set(outputs.map((o) => o.ephemeralE)).size).toBe(1);
  });

  test('a subclassed single-output P2PK hook is still called once per split amount', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const keyset: HasKeysetKeys = {
      id: '009a1f293253e41e',
      keys: { '1': 'unused', '2': 'unused', '4': 'unused' },
    };
    const seen: AmountLike[] = [];
    class CustomCreator extends DefaultOutputDataCreator {
      createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string): OutputData {
        seen.push(amount);
        return OutputData.createSingleP2PKData(p2pk, amount, keysetId);
      }
    }

    const outputs = new CustomCreator().createP2PKData({ pubkey }, 7, keyset);

    expect(outputs).toHaveLength(3);
    expect(seen).toHaveLength(3);
  });

  test('a batch whose counters run past the safe range is rejected, not silently aliased', () => {
    const keyset: HasKeysetKeys = {
      id: '012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
      keys: { '1': 'unused', '2': 'unused' },
    };
    const creator = new DefaultOutputDataCreator();
    const seed = new Uint8Array([1]);

    // The first output is fine; the second lands on 2^53, where counter + 1 stops
    // producing a distinct value, so a batch would derive one counter twice.
    expect(() =>
      creator.createDeterministicData(3, seed, Number.MAX_SAFE_INTEGER, keyset, [1, 2]),
    ).toThrow(/counter/i);
  });

  test('delegates deterministic batch creation to subclassed single-output override', () => {
    const calls: Array<{ amount: string; counter: number; keysetId: string }> = [];
    const keyset: HasKeysetKeys = {
      id: '012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
      keys: { '1': 'unused', '2': 'unused' },
    };

    class CustomOutputDataCreator extends DefaultOutputDataCreator {
      override createSingleDeterministicData(
        amount: AmountLike,
        _seed: Uint8Array,
        counter: number,
        keysetId: string,
      ): OutputDataLike {
        calls.push({ amount: String(amount), counter, keysetId });
        return {
          blindedMessage: {
            amount: Amount.from(amount),
            B_: `blind-${counter}`,
            id: keysetId,
          },
          blindingFactor: BigInt(counter),
          secret: new Uint8Array([counter]),
          toProof: (_signature: SerializedBlindedSignature): Proof => {
            throw new Error('not used');
          },
        };
      }
    }

    const creator = new CustomOutputDataCreator();
    const outputs = creator.createDeterministicData(3, new Uint8Array([1]), 7, keyset, [1, 2]);

    expect(outputs.map((output) => output.blindedMessage.B_)).toEqual(['blind-7', 'blind-8']);
    expect(calls).toEqual([
      { amount: '1', counter: 7, keysetId: keyset.id },
      { amount: '2', counter: 8, keysetId: keyset.id },
    ]);
  });
});

describe('OutputData helpers', () => {
  test('detects output data factories', () => {
    const factory: OutputDataFactory = (amount, keys) =>
      OutputData.createSingleRandomData(amount, keys.id);

    expect(isOutputDataFactory(factory)).toBe(true);
    expect(isOutputDataFactory([])).toBe(false);
  });

  test('serializes and deserializes output data', () => {
    const output = OutputData.createSingleRandomData(21, '009a1f293253e41e');
    const serialized = OutputData.serialize(output);
    const deserialized = OutputData.deserialize(serialized);

    expect(serialized.blindingFactor).toMatch(/^(0|[1-9]\d*)$/);
    expect(OutputData.serialize(deserialized)).toEqual(serialized);
  });

  test('rejects invalid serialized blinding factors', () => {
    const serialized = OutputData.serialize(
      OutputData.createSingleRandomData(21, '009a1f293253e41e'),
    );

    expect(() => OutputData.deserialize({ ...serialized, blindingFactor: '0x01' })).toThrow(
      /Invalid SerializedOutputData: .*blindingFactor/,
    );
  });

  test('rejects malformed serialized secret hex', () => {
    const serialized = OutputData.serialize(
      OutputData.createSingleRandomData(21, '009a1f293253e41e'),
    );

    expect(() => OutputData.deserialize({ ...serialized, secret: 'zz' })).toThrow(
      /Invalid SerializedOutputData:/,
    );
  });

  test('preserves ephemeral P2PK blinding data when serializing output data', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const output = OutputData.createSingleP2PKData(
      {
        pubkey,
        blindKeys: true,
      },
      1,
      '009a1f293253e41e',
    );

    const deserialized = OutputData.deserialize(OutputData.serialize(output));

    expect(deserialized.ephemeralE).toBe(output.ephemeralE);
  });

  test('HTLC blinding starts lock keys at slot 1 (NUT-28: hashlock occupies slot 0)', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const output = OutputData.createSingleP2PKData(
      {
        pubkey,
        hashlock: 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5',
        blindKeys: true,
      },
      1,
      '009a1f293253e41e',
    );

    const [, secret] = JSON.parse(new TextDecoder().decode(output.secret)) as [
      string,
      { data: string; tags: string[][] },
    ];
    const blinded = secret.tags.find(([tag]) => tag === 'pubkeys')![1];
    // Independent receiver-side NUT-28 math: r1 = sha256(DST || Zx || 0x01), P' = P + r1·G
    const p = secp256k1.Point.Fn.fromBytes(privkey);
    const Zx = secp256k1.Point.fromHex(output.ephemeralE!).multiply(p).toBytes(true).slice(1);
    const r1 = bytesToNumberBE(sha256(concatBytes(P2BK_DST, Zx, Uint8Array.of(1))));
    const expected = pointFromHex(pubkey).add(secp256k1.Point.BASE.multiply(r1)).toHex(true);
    expect(blinded).toBe(expected);
  });

  test('keeps blinded HTLC lock keys in pubkeys tags', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const output = OutputData.createSingleP2PKData(
      {
        pubkey,
        hashlock: 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5',
        blindKeys: true,
      },
      1,
      '009a1f293253e41e',
    );

    const [kind, secret] = JSON.parse(new TextDecoder().decode(output.secret)) as [
      string,
      { data: string; tags: string[][] },
    ];
    const pubkeysTag = secret.tags.find(([tag]) => tag === 'pubkeys');

    expect(kind).toBe('HTLC');
    expect(secret.data).toBe('ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5');
    expect(pubkeysTag?.slice(1)).toHaveLength(1);
    expect(pubkeysTag?.[1]).not.toBe(pubkey);
    expect(output.ephemeralE).toBeDefined();
  });

  test('a blinded SIG_ALL batch shares one ephemeral key across all outputs', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const keyset: HasKeysetKeys = {
      id: '009a1f293253e41e',
      keys: { '1': 'unused', '2': 'unused', '4': 'unused' },
    };

    // 7 splits into three outputs. NUT-11 requires SIG_ALL proofs to carry identical
    // data/tags, so the batch must reuse one ephemeral key per NUT-28.
    const outputs = OutputData.createP2PKData(
      { pubkey, blindKeys: true, sigFlag: 'SIG_ALL' },
      7,
      keyset,
    );

    expect(outputs).toHaveLength(3);
    const secrets = outputs.map(
      (o) =>
        (
          JSON.parse(new TextDecoder().decode(o.secret)) as [
            string,
            { data: string; tags: string[][] },
          ]
        )[1],
    );
    for (let i = 1; i < outputs.length; i++) {
      expect(secrets[i].data).toBe(secrets[0].data);
      expect(secrets[i].tags).toEqual(secrets[0].tags);
      expect(outputs[i].ephemeralE).toBe(outputs[0].ephemeralE);
    }
  });

  test('a blinded SIG_INPUTS batch blinds each output with its own ephemeral key', () => {
    const privkey = hexToBytes('01'.repeat(32));
    const pubkey = bytesToHex(getPubKeyFromPrivKey(privkey));
    const keyset: HasKeysetKeys = {
      id: '009a1f293253e41e',
      keys: { '1': 'unused', '2': 'unused', '4': 'unused' },
    };

    const outputs = OutputData.createP2PKData({ pubkey, blindKeys: true }, 7, keyset);

    expect(outputs).toHaveLength(3);
    const data = outputs.map(
      (o) => (JSON.parse(new TextDecoder().decode(o.secret)) as [string, { data: string }])[1].data,
    );
    expect(new Set(data).size).toBe(outputs.length);
    expect(new Set(outputs.map((o) => o.ephemeralE)).size).toBe(outputs.length);
  });
});

describe('OutputData.toProof across a keyset rotation', () => {
  test('a non-blank output rejects a signature from another keyset even with matching keys', () => {
    const G = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const output = OutputData.createSingleRandomData(1, '009a1f293253e41e');
    const keysetB: HasKeysetKeys = { id: '00ad268c4d1f5826', keys: { 1: G } };
    const sig: SerializedBlindedSignature = { id: keysetB.id, amount: Amount.from(1), C_: G };
    expect(() => output.toProof(sig, keysetB)).toThrow(/does not match output/);
  });

  test('a real signature under another keyset unblinds to a proof the mint would accept', () => {
    // Mint side: the blank names keyset A, but the mint signs it with keyset B's key for amount 1
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const keysetB: HasKeysetKeys = {
      id: '00ad268c4d1f5826',
      keys: { '1': bytesToHex(getPubKeyFromPrivKey(mintPrivKey)) },
    };
    const output = OutputData.createSingleRandomData(0, '009a1f293253e41e');
    const B_ = pointFromHex(output.blindedMessage.B_);
    const blindSig = createBlindSignature(B_, mintPrivKey, keysetB.id);
    const dleq = createDLEQProof(B_, mintPrivKey);
    const sig: SerializedBlindedSignature = {
      id: keysetB.id,
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
    };

    // toProof verifies the DLEQ against keyset B; a mismatched key would throw here
    const proof = output.toProof(sig, keysetB);
    expect(proof.id).toBe(keysetB.id);
    // and the unblinded C is k * hash_to_curve(secret), which is what the mint checks on redeem
    const Y = hashToCurve(new TextEncoder().encode(proof.secret));
    const expectedC = Y.multiply(secp256k1.Point.Fn.fromBytes(mintPrivKey));
    expect(pointFromHex(proof.C).equals(expectedC)).toBe(true);
  });
});
