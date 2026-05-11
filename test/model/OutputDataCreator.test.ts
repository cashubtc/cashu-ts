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
