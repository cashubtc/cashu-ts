import { describe, expect, test } from 'vitest';

import { Amount, type AmountLike } from '../../src/model/Amount';
import { DefaultOutputDataCreator } from '../../src/model/OutputDataCreator';
import { OutputData, isOutputDataFactory } from '../../src/model/OutputData';
import { getPubKeyFromPrivKey } from '../../src/crypto';
import { Bytes } from '../../src/utils';
import type { OutputDataFactory, OutputDataLike } from '../../src/model/OutputData';
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
    const privkey = Bytes.fromHex('01'.repeat(32));
    const pubkey = Bytes.toHex(getPubKeyFromPrivKey(privkey));
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

  test('keeps blinded HTLC lock keys in pubkeys tags', () => {
    const privkey = Bytes.fromHex('01'.repeat(32));
    const pubkey = Bytes.toHex(getPubKeyFromPrivKey(privkey));
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
});

describe('OutputData.toProof', () => {
  test('rejects a signature whose keyset id does not match the output', () => {
    const outputKeysetId = '009a1f293253e41e';
    const wrongKeysetId = '00ad268c4d1f5826';
    const output = OutputData.createSingleRandomData(1, outputKeysetId);
    const keyset: HasKeysetKeys = { id: outputKeysetId, keys: { 1: 'deadbeef' } };
    const sig: SerializedBlindedSignature = {
      id: wrongKeysetId,
      amount: Amount.from(1),
      C_: '03' + '00'.repeat(32),
    };
    expect(() => output.toProof(sig, keyset)).toThrow(
      /Mint signature keyset id .* does not match output/,
    );
  });

  test('maps malformed secp C_ to a CTSError with NUT-09 hint', () => {
    // A buggy or malicious mint that returns un-parseable hex must not leak a generic
    // TypeError/Error after the inputs have been destroyed; toProof should surface a
    // CTSError that tells the wallet how to recover.
    const keysetId = '009a1f293253e41e';
    const output = OutputData.createSingleRandomData(1, keysetId);
    const keyset: HasKeysetKeys = {
      id: keysetId,
      // Valid secp generator-shaped hex so the A lookup itself parses; the failure must
      // come from the bad C_ specifically.
      keys: { 1: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' },
    };
    const sig: SerializedBlindedSignature = {
      id: keysetId,
      amount: Amount.from(1),
      C_: 'not-hex',
    };
    expect(() => output.toProof(sig, keyset)).toThrow(
      /Mint returned invalid signature or amount\. .*NUT-09/,
    );
  });

  test('maps missing keyset key for blank output to a CTSError with NUT-09 hint', () => {
    // Blank outputs (amount=0) let the mint pick the denomination. If that pick isn't
    // in our keyset, `keys[amount]` is undefined and pointFromHex(undefined) used to
    // throw an opaque TypeError — now it must be a CTSError with recovery hint.
    const keysetId = '009a1f293253e41e';
    const blank = OutputData.createSingleRandomData(0, keysetId);
    const keyset: HasKeysetKeys = {
      id: keysetId,
      keys: { 1: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' },
    };
    const sig: SerializedBlindedSignature = {
      id: keysetId,
      amount: Amount.from(99),
      C_: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    };
    expect(() => blank.toProof(sig, keyset)).toThrow(
      /Mint returned invalid signature or amount\. .*NUT-09/,
    );
  });
});
