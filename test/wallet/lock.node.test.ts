import { describe, expect, test } from 'vitest';

import { Wallet } from '../../src';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { NUTROOT_NUMS_KEY, parseNutrootLeaf, serializeNutrootLeaf } from '../../src/crypto/nutroot';
import { Amount } from '../../src/model/Amount';
import type { OutputData } from '../../src/model/OutputData';
import { Bytes } from '../../src/utils';
import {
  lockToNutrootOptions,
  lockToP2PKOptions,
  nutrootToLockOptions,
  p2pkToLockOptions,
  type LockOptions,
} from '../../src/wallet/lock';
import type { OutputType } from '../../src/wallet/types';

const PUB_A = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex('11'.repeat(32))));
const PUB_B = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex('22'.repeat(32))));
const PUB_C = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex('33'.repeat(32))));
const PUB_R = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex('44'.repeat(32))));
const HASH = 'ab'.repeat(32);
const TIME = 1_800_000_000;

describe('lockToNutrootOptions (v3 encoder)', () => {
  test('single main key, no conditions: receiver-keyed bare secret', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A] })).toEqual({ receiverKey: PUB_A });
  });

  test('normalizes an uppercase key to lowercase', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A.toUpperCase()] })).toEqual({
      receiverKey: PUB_A,
    });
  });

  test('n-of-m: NUMS internal key plus threshold leaf, never a key path', () => {
    expect(
      lockToNutrootOptions({ mainKeys: [PUB_A, PUB_B, PUB_C], requiredMainSignatures: 2 }),
    ).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [{ type: 'threshold', n: 2, keys: [PUB_A, PUB_B, PUB_C] }],
    });
  });

  test('multiple keys with threshold 1 still map to NUMS + threshold leaf', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A, PUB_B] })).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [{ type: 'threshold', n: 1, keys: [PUB_A, PUB_B] }],
    });
  });

  test('locktime with refund keys: key path plus after leaf', () => {
    expect(
      lockToNutrootOptions({ mainKeys: [PUB_A], locktime: TIME, refundKeys: [PUB_R] }),
    ).toEqual({
      receiverKey: PUB_A,
      leaves: [{ type: 'after', n: 1, time: TIME, keys: [PUB_R] }],
    });
  });

  test('refund threshold carries into the after leaf', () => {
    expect(
      lockToNutrootOptions({
        mainKeys: [PUB_A],
        locktime: TIME,
        refundKeys: [PUB_R, PUB_B],
        requiredRefundSignatures: 2,
      }),
    ).toEqual({
      receiverKey: PUB_A,
      leaves: [{ type: 'after', n: 2, time: TIME, keys: [PUB_R, PUB_B] }],
    });
  });

  test('refund keys without a locktime are dropped: inert under NUT-11 too', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A], refundKeys: [PUB_R] })).toEqual({
      receiverKey: PUB_A,
    });
  });

  test('hashlock maps to NUMS + hashlock leaf even for a single key: a key path would bypass the preimage', () => {
    expect(lockToNutrootOptions({ hashlock: HASH, mainKeys: [PUB_A] })).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [{ type: 'hashlock', n: 1, hash: HASH, keys: [PUB_A] }],
    });
  });

  test('hashlock with refund path gets both leaves', () => {
    expect(
      lockToNutrootOptions({
        hashlock: HASH,
        mainKeys: [PUB_A, PUB_B],
        requiredMainSignatures: 2,
        locktime: TIME,
        refundKeys: [PUB_R],
      }),
    ).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [
        { type: 'hashlock', n: 2, hash: HASH, keys: [PUB_A, PUB_B] },
        { type: 'after', n: 1, time: TIME, keys: [PUB_R] },
      ],
    });
  });

  test('explicit leaves ride alongside the sugar-derived ones', () => {
    expect(
      lockToNutrootOptions({
        mainKeys: [PUB_A],
        leaves: [
          { type: 'after', n: 1, time: TIME, keys: [PUB_R] },
          { type: 'after', n: 2, time: TIME + 100, keys: [PUB_B, PUB_C] },
        ],
      }),
    ).toEqual({
      receiverKey: PUB_A,
      leaves: [
        { type: 'after', n: 1, time: TIME, keys: [PUB_R] },
        { type: 'after', n: 2, time: TIME + 100, keys: [PUB_B, PUB_C] },
      ],
    });
  });

  test('explicit leaves with no main key: script-only NUMS lock', () => {
    expect(lockToNutrootOptions({ leaves: [{ type: 'threshold', n: 1, keys: [PUB_B] }] })).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [{ type: 'threshold', n: 1, keys: [PUB_B] }],
    });
  });

  test('blindKeys true tags every leaf key, deduplicated', () => {
    expect(
      lockToNutrootOptions({
        mainKeys: [PUB_A, PUB_B],
        locktime: TIME,
        refundKeys: [PUB_B, PUB_R],
        blindKeys: true,
      }),
    ).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [
        { type: 'threshold', n: 1, keys: [PUB_A, PUB_B] },
        { type: 'after', n: 1, time: TIME, keys: [PUB_B, PUB_R] },
      ],
      blindKeys: [PUB_A, PUB_B, PUB_R],
    });
  });

  test('blindKeys as a list tags exactly those keys', () => {
    expect(
      lockToNutrootOptions({
        mainKeys: [PUB_A, PUB_B],
        blindKeys: [PUB_B.toUpperCase()],
      }),
    ).toEqual({
      receiverKey: NUTROOT_NUMS_KEY,
      leaves: [{ type: 'threshold', n: 1, keys: [PUB_A, PUB_B] }],
      blindKeys: [PUB_B],
    });
  });

  test('blindKeys true on a bare single-key lock adds nothing: derivation already blinds it', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A], blindKeys: true })).toEqual({
      receiverKey: PUB_A,
    });
  });

  test('sigAll is absorbed: every v3 input signs the whole transaction', () => {
    expect(lockToNutrootOptions({ mainKeys: [PUB_A], sigAll: true })).toEqual({
      receiverKey: PUB_A,
    });
  });

  test('refuses extra tags: v3 has no tag surface', () => {
    expect(() =>
      lockToNutrootOptions({ mainKeys: [PUB_A], additionalTags: [['memo', 'hi']] }),
    ).toThrow(/tags/i);
  });

  test('refuses anyone-after-locktime: a keyless spend path is malleable in flight', () => {
    expect(() => lockToNutrootOptions({ mainKeys: [PUB_A], locktime: TIME })).toThrow(/refund/i);
  });

  test('refuses a keyless hashlock: v3 leaves require at least one key', () => {
    expect(() => lockToNutrootOptions({ hashlock: HASH })).toThrow(/key/i);
  });

  test('refuses an empty lock', () => {
    expect(() => lockToNutrootOptions({})).toThrow(/key|leaf/i);
  });

  test('refuses a threshold above the key count', () => {
    expect(() =>
      lockToNutrootOptions({ mainKeys: [PUB_A, PUB_B], requiredMainSignatures: 3 }),
    ).toThrow();
  });
});

describe('lockToP2PKOptions (v2 encoder)', () => {
  test('single main key: data slot only', () => {
    expect(lockToP2PKOptions({ mainKeys: [PUB_A] })).toEqual({ kind: 'P2PK', data: PUB_A });
  });

  test('n-of-m: first key in data, rest in pubkeys, threshold kept', () => {
    expect(
      lockToP2PKOptions({ mainKeys: [PUB_A, PUB_B, PUB_C], requiredMainSignatures: 2 }),
    ).toEqual({
      kind: 'P2PK',
      data: PUB_A,
      pubkeys: [PUB_B, PUB_C],
      requiredSignatures: 2,
    });
  });

  test('hashlock: hash in data, every key in pubkeys', () => {
    expect(lockToP2PKOptions({ hashlock: HASH, mainKeys: [PUB_A, PUB_B] })).toEqual({
      kind: 'HTLC',
      data: HASH,
      pubkeys: [PUB_A, PUB_B],
    });
  });

  test('keyless hashlock is valid NUT-14: preimage alone spends', () => {
    expect(lockToP2PKOptions({ hashlock: HASH })).toEqual({ kind: 'HTLC', data: HASH });
  });

  test('locktime and refund path map to tags, thresholds only when above 1', () => {
    expect(
      lockToP2PKOptions({
        mainKeys: [PUB_A],
        locktime: TIME,
        refundKeys: [PUB_R, PUB_B],
        requiredRefundSignatures: 2,
      }),
    ).toEqual({
      kind: 'P2PK',
      data: PUB_A,
      locktime: TIME,
      refundKeys: [PUB_R, PUB_B],
      requiredRefundSignatures: 2,
    });
  });

  test('anyone-after-locktime is valid NUT-11 and passes through', () => {
    expect(lockToP2PKOptions({ mainKeys: [PUB_A], locktime: TIME })).toEqual({
      kind: 'P2PK',
      data: PUB_A,
      locktime: TIME,
    });
  });

  test('extra tags, blindKeys true and sigAll pass through', () => {
    expect(
      lockToP2PKOptions({
        mainKeys: [PUB_A],
        additionalTags: [['memo', 'hi']],
        blindKeys: true,
        sigAll: true,
      }),
    ).toEqual({
      kind: 'P2PK',
      data: PUB_A,
      additionalTags: [['memo', 'hi']],
      blindKeys: true,
      sigFlag: 'SIG_ALL',
    });
  });

  test('refuses leaves: trees are richer than tags', () => {
    expect(() =>
      lockToP2PKOptions({
        mainKeys: [PUB_A],
        leaves: [{ type: 'after', n: 1, time: TIME, keys: [PUB_R] }],
      }),
    ).toThrow(/v3|leaf|leaves/i);
  });

  test('refuses a partial blind-me list: NUT-11 blinds all keys or none', () => {
    expect(() => lockToP2PKOptions({ mainKeys: [PUB_A, PUB_B], blindKeys: [PUB_B] })).toThrow(
      /blind/i,
    );
  });

  test('refuses an empty lock', () => {
    expect(() => lockToP2PKOptions({})).toThrow(/key/i);
  });
});

describe('p2pkToLockOptions (wire decoder)', () => {
  test('decodes the NUT-11 layout back to semantics', () => {
    expect(
      p2pkToLockOptions({
        kind: 'P2PK',
        data: PUB_A,
        pubkeys: [PUB_B],
        requiredSignatures: 2,
        locktime: TIME,
        refundKeys: [PUB_R],
        sigFlag: 'SIG_ALL',
      }),
    ).toEqual({
      mainKeys: [PUB_A, PUB_B],
      requiredMainSignatures: 2,
      locktime: TIME,
      refundKeys: [PUB_R],
      sigAll: true,
    });
  });

  test('decodes an HTLC: hash out of the data slot', () => {
    expect(p2pkToLockOptions({ kind: 'HTLC', data: HASH, pubkeys: [PUB_A] })).toEqual({
      hashlock: HASH,
      mainKeys: [PUB_A],
    });
  });

  test('round-trips through the v2 encoder', () => {
    const lock: LockOptions = {
      mainKeys: [PUB_A, PUB_B],
      requiredMainSignatures: 2,
      locktime: TIME,
      refundKeys: [PUB_R],
      blindKeys: true,
    };
    expect(p2pkToLockOptions(lockToP2PKOptions(lock))).toEqual(lock);
  });

  test('rejects malformed input at the converter, not at encode time', () => {
    expect(() => p2pkToLockOptions({ kind: 'P2PK', data: 'not-a-key' })).toThrow(/pubkey/i);
    expect(() => p2pkToLockOptions({ kind: 'HTLC', data: 'not-a-hash' })).toThrow(/hashlock/i);
    expect(() => p2pkToLockOptions({ kind: 'P2PK', data: PUB_A, requiredSignatures: 5 })).toThrow(
      /exceeds/,
    );
  });
});

describe('nutrootToLockOptions (readable conditions)', () => {
  test('a receiver-keyed lock reads back faithfully, leaves and all', () => {
    const encoded = lockToNutrootOptions({
      mainKeys: [PUB_A],
      locktime: TIME,
      refundKeys: [PUB_R],
    });
    expect(nutrootToLockOptions(encoded)).toEqual({
      mainKeys: [PUB_A],
      leaves: [{ type: 'after', n: 1, time: TIME, keys: [PUB_R] }],
    });
  });

  test('a NUMS lock reads back with no main keys', () => {
    const encoded = lockToNutrootOptions({ mainKeys: [PUB_A, PUB_B], blindKeys: [PUB_B] });
    expect(nutrootToLockOptions(encoded)).toEqual({
      leaves: [{ type: 'threshold', n: 1, keys: [PUB_A, PUB_B] }],
      blindKeys: [PUB_B],
    });
  });

  test('reads serialized leaf TLVs, the wire form a proof discloses', () => {
    const tree = [
      Bytes.toHex(serializeNutrootLeaf({ type: 'after', n: 1, time: TIME, keys: [PUB_R] })),
    ];
    expect(nutrootToLockOptions({ receiverKey: PUB_A, leaves: tree })).toEqual({
      mainKeys: [PUB_A],
      leaves: [{ type: 'after', n: 1, time: TIME, keys: [PUB_R] }],
    });
  });

  test('rejects malformed input at the converter, not at encode time', () => {
    expect(() => nutrootToLockOptions({ receiverKey: 'not-a-key' })).toThrow(/pubkey/i);
    expect(() => nutrootToLockOptions({ receiverKey: PUB_A, blindKeys: ['junk'] })).toThrow(
      /pubkey/i,
    );
    // A parsed-form leaf is validated like addLeaf; a threshold above its key count cannot spend.
    expect(() =>
      nutrootToLockOptions({
        receiverKey: PUB_A,
        leaves: [{ type: 'threshold', n: 2, keys: [PUB_B] }],
      }),
    ).toThrow(/exceeds/);
  });
});

describe('Wallet.createOutputData lock chokepoint', () => {
  const wallet = new Wallet('http://localhost:3338', { unit: 'sat' });
  const V3_KEYSET = { id: `02${'ab'.repeat(32)}`, keys: { '1': 'x', '2': 'x' } };
  const LEGACY_KEYSET = { id: `00${'cd'.repeat(16)}`, keys: { '1': 'x', '2': 'x' } };
  const create = (keyset: { id: string; keys: Record<string, string> }, ot: OutputType) =>
    (
      wallet as unknown as {
        createOutputData(a: Amount, k: typeof keyset, ot: OutputType): OutputData[];
      }
    ).createOutputData(Amount.from(3), keyset, ot);

  test('a lock on a v3 keyset emits nutroot outputs', () => {
    const outputs = create(V3_KEYSET, { type: 'lock', options: { mainKeys: [PUB_A] } });
    expect(outputs).toHaveLength(2);
    for (const out of outputs) {
      // A v3 point secret with receiver-keyed spend info, not a NUT-11 JSON secret.
      expect(new TextDecoder().decode(out.secret)).toMatch(/^0[23][0-9a-f]{64}$/);
      expect(out.spendInfo?.E).toBeDefined();
    }
  });

  test('lock conditions arrive as the tree', () => {
    const [out] = create(V3_KEYSET, {
      type: 'lock',
      options: { mainKeys: [PUB_A], locktime: TIME, refundKeys: [PUB_R] },
    });
    const tree = out.spendInfo?.tree;
    expect(tree).toHaveLength(1);
    expect(parseNutrootLeaf(Bytes.fromHex(tree![0]))).toEqual({
      type: 'after',
      n: 1,
      time: TIME,
      keys: [PUB_R],
    });
  });

  test('the same lock on a legacy keyset emits NUT-11 secrets', () => {
    const outputs = create(LEGACY_KEYSET, { type: 'lock', options: { mainKeys: [PUB_A] } });
    for (const out of outputs) {
      const secret = JSON.parse(new TextDecoder().decode(out.secret));
      expect(secret[0]).toBe('P2PK');
      expect(secret[1].data).toBe(PUB_A);
    }
  });

  test('an inexpressible lock refuses at the chokepoint instead of reaching the mint', () => {
    expect(() =>
      create(V3_KEYSET, {
        type: 'lock',
        options: { mainKeys: [PUB_A], additionalTags: [['memo', 'hi']] },
      }),
    ).toThrow(/tags/i);
    expect(() =>
      create(LEGACY_KEYSET, {
        type: 'lock',
        options: { mainKeys: [PUB_A], leaves: [{ type: 'threshold', n: 1, keys: [PUB_B] }] },
      }),
    ).toThrow(/v3/i);
  });
});

describe('LockBuilder', () => {
  test('emits semantic LockOptions', async () => {
    const { LockBuilder } = await import('../../src');
    const options = new LockBuilder()
      .addMainPubkey([PUB_A, PUB_B])
      .requireMainSignatures(2)
      .lockUntil(TIME)
      .addRefundPubkey(PUB_R)
      .toOptions();
    expect(options).toEqual({
      mainKeys: [PUB_A, PUB_B],
      requiredMainSignatures: 2,
      locktime: TIME,
      refundKeys: [PUB_R],
    });
  });

  test('addLeaf makes trees NUT-11 cannot express', async () => {
    const { LockBuilder } = await import('../../src');
    const options = new LockBuilder()
      .addMainPubkey(PUB_A)
      .addLeaf({ type: 'after', n: 1, time: TIME, keys: [PUB_R] })
      .addLeaf({ type: 'after', n: 2, time: TIME + 100, keys: [PUB_B, PUB_C] })
      .toOptions();
    expect(options.leaves).toHaveLength(2);
    expect(() => lockToP2PKOptions(options)).toThrow(/v3/i);
    expect(lockToNutrootOptions(options).leaves).toHaveLength(2);
  });

  test('round-trips through fromOptions', async () => {
    const { LockBuilder } = await import('../../src');
    const options = new LockBuilder()
      .addHashlock(HASH)
      .addMainPubkey(PUB_A)
      .blindKeys()
      .toOptions();
    expect(LockBuilder.fromOptions(options).toOptions()).toEqual(options);
  });

  test('P2PKBuilder is gone: the v5 break is clean', async () => {
    const api = (await import('../../src')) as Record<string, unknown>;
    expect(api.P2PKBuilder).toBeUndefined();
  });
});
