import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, test, expect } from 'vitest';

import { recoverV3SecretKeys } from '../../src/crypto/NUT13';
import {
  buildTransactionTranscript,
  signTransactionInput,
  transactionDigest,
  TRANSCRIPT_DOMAIN_TAG,
  verifyTransactionInputWitness,
  type TransactionShape,
} from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import vectors from '../vectors/taproot-v3.json';

const tv = vectors.transcript;

function fromVectorTx(tx: {
  proof_inputs?: Array<{ amount: number; keyset_id: string; secret: string; C: string }>;
  mint_quote_inputs?: Array<{ amount: number; quote_id: string }>;
  blinded_outputs?: Array<{ amount: number; keyset_id: string; B_: string }>;
  melt_quote_outputs?: Array<{ amount: number; quote_id: string }>;
}): TransactionShape {
  return {
    proofInputs: tx.proof_inputs?.map((p) => ({
      amount: BigInt(p.amount),
      keysetId: p.keyset_id,
      secret: p.secret,
      C: p.C,
    })),
    mintQuoteInputs: tx.mint_quote_inputs?.map((q) => ({
      amount: BigInt(q.amount),
      quoteId: q.quote_id,
    })),
    blindedOutputs: tx.blinded_outputs?.map((o) => ({
      amount: BigInt(o.amount),
      keysetId: o.keyset_id,
      B_: o.B_,
    })),
    meltQuoteOutputs: tx.melt_quote_outputs?.map((q) => ({
      amount: BigInt(q.amount),
      quoteId: q.quote_id,
    })),
  };
}

describe('transaction transcript (vectors)', () => {
  test('domain tag matches the vectors', () => {
    expect(tv.domain_tag).toBe(TRANSCRIPT_DOMAIN_TAG);
  });

  test.each(['swap', 'mint', 'melt'] as const)('%s transcript and digest match', (name) => {
    const example = tv[name];
    const tx = fromVectorTx(example.tx);
    expect(bytesToHex(buildTransactionTranscript(tx))).toBe(example.transcript);
    expect(bytesToHex(transactionDigest(tx))).toBe(example.digest);
  });

  test('the swap signature is a key-path witness by the proof secret', () => {
    const digest = hexToBytes(tv.swap.digest);
    const secret = hexToBytes(tv.swap.tx.proof_inputs[0].secret);
    expect(schnorr.verify(hexToBytes(tv.swap.signature), digest, secret.subarray(1))).toBe(true);
    // Reproduce deterministically from the vector secret key (aux = 32 zero bytes).
    const sig = schnorr.sign(
      digest,
      hexToBytes(vectors.nut13_v3.outputs[0].secret_key),
      new Uint8Array(32),
    );
    expect(bytesToHex(sig)).toBe(tv.swap.signature);
  });

  test('any field change lands on a different digest', () => {
    const base = fromVectorTx(tv.swap.tx);
    const d0 = bytesToHex(transactionDigest(base));
    const bumped: TransactionShape = {
      ...base,
      blindedOutputs: base.blindedOutputs!.map((o, i) =>
        i === 0 ? { ...o, amount: o.amount + 1n } : o,
      ),
    };
    expect(bytesToHex(transactionDigest(bumped))).not.toBe(d0);
    const reordered: TransactionShape = {
      ...base,
      blindedOutputs: [
        { ...base.blindedOutputs![0], amount: 1n },
        { ...base.blindedOutputs![1], amount: 7n },
      ],
    };
    expect(bytesToHex(transactionDigest(reordered))).not.toBe(d0);
  });

  test('rejects a transaction with no inputs or no outputs', () => {
    const swap = fromVectorTx(tv.swap.tx);
    expect(() => buildTransactionTranscript({ blindedOutputs: swap.blindedOutputs })).toThrow(
      /input/,
    );
    expect(() => buildTransactionTranscript({ proofInputs: swap.proofInputs })).toThrow(/output/);
  });

  test('signTransactionInput produces a witness the verifier accepts', () => {
    const digest = hexToBytes(tv.swap.digest);
    const secretKey = hexToBytes(vectors.nut13_v3.outputs[0].secret_key);
    const secret = tv.swap.tx.proof_inputs[0].secret;
    const witness = signTransactionInput(digest, secretKey);
    const parsed = JSON.parse(witness) as { signatures: string[] };
    expect(parsed.signatures).toHaveLength(1);
    expect(verifyTransactionInputWitness(digest, secret, witness)).toBe(true);
    // The pinned vector signature also verifies through the same path.
    expect(
      verifyTransactionInputWitness(
        digest,
        secret,
        JSON.stringify({ signatures: [tv.swap.signature] }),
      ),
    ).toBe(true);
  });

  test('witness verification fails closed', () => {
    const digest = hexToBytes(tv.swap.digest);
    const secret = tv.swap.tx.proof_inputs[0].secret;
    const good = JSON.stringify({ signatures: [tv.swap.signature] });
    expect(verifyTransactionInputWitness(hexToBytes(tv.mint.digest), secret, good)).toBe(false);
    expect(verifyTransactionInputWitness(digest, secret, 'not-json')).toBe(false);
    expect(verifyTransactionInputWitness(digest, secret, '{"signatures":[]}')).toBe(false);
    expect(verifyTransactionInputWitness(digest, 'aabb', good)).toBe(false);
  });

  test('recoverV3SecretKeys resolves self-owned secrets by counter scan', () => {
    const seed = new TextEncoder().encode(vectors.nut13_v3.seed_utf8);
    const keysetId = vectors.nut13_v3.keyset_id;
    const secrets = vectors.nut13_v3.outputs.map((o) => o.secret);
    const found = recoverV3SecretKeys(seed, keysetId, [...secrets, '02'.padEnd(66, 'f')], 16);
    expect(found.size).toBe(secrets.length);
    for (const output of vectors.nut13_v3.outputs) {
      expect(bytesToHex(found.get(output.secret) as Uint8Array)).toBe(output.secret_key);
    }
    expect(found.has('02'.padEnd(66, 'f'))).toBe(false);
  });

  test('rejects an empty proof secret', () => {
    const swap = fromVectorTx(tv.swap.tx);
    const bad = {
      ...swap,
      proofInputs: [{ ...swap.proofInputs![0], secret: '' }],
    };
    expect(() => buildTransactionTranscript(bad)).toThrow(/non-empty/);
  });

  test('carries a v0-v2 secret verbatim beside a v3 input (mixed transaction)', () => {
    // Spec 5: rules follow the proof's keyset and verification is per input, so a legacy
    // secret rides in the transcript as its utf8 bytes rather than being rejected.
    const swap = fromVectorTx(tv.swap.tx);
    const legacySecret = '["P2PK",{"nonce":"00","data":"02aa"}]';
    const mixed = {
      ...swap,
      proofInputs: [
        {
          ...swap.proofInputs![0],
          keysetId: `01${'11'.repeat(32)}`,
          secret: legacySecret,
        },
      ],
    };
    const bytes = buildTransactionTranscript(mixed);
    const needle = new TextEncoder().encode(legacySecret);
    const hay = bytesToHex(bytes);
    expect(hay).toContain(bytesToHex(needle));
  });

  test('a point-shaped v0-v2 secret remains utf8', () => {
    const swap = fromVectorTx(tv.swap.tx);
    const legacySecret = tv.swap.tx.proof_inputs[0].secret;
    const bytes = buildTransactionTranscript({
      ...swap,
      proofInputs: [
        {
          ...swap.proofInputs![0],
          keysetId: `01${'11'.repeat(32)}`,
          secret: legacySecret,
        },
      ],
    });
    expect(bytesToHex(bytes)).toContain(bytesToHex(new TextEncoder().encode(legacySecret)));
  });
});

describe('amounts are normalized at the transcript boundary', () => {
  const input = {
    keysetId: '0200',
    secret: '02'.padEnd(66, 'a'),
    C: 'aa'.repeat(48),
  };
  const output = { amount: 1n, keysetId: '0200', B_: 'bb'.repeat(48) };

  test('an Amount, a number and a bigint all digest the same', () => {
    // Types are erased at the JS boundary. Before normalization an Amount instance encoded to
    // different bytes, so the wallet signed a digest the mint never computes: a valid-looking
    // proof nobody can spend.
    const digests = [32n, 32, Amount.from(32)].map((amount) =>
      bytesToHex(
        transactionDigest({
          proofInputs: [{ ...input, amount: amount }],
          blindedOutputs: [output],
        }),
      ),
    );
    expect(new Set(digests).size).toBe(1);
  });

  test('a nonsense amount throws rather than encoding something', () => {
    expect(() =>
      transactionDigest({
        proofInputs: [{ ...input, amount: 'not-a-number' }],
        blindedOutputs: [output],
      }),
    ).toThrow();
    expect(() =>
      transactionDigest({
        proofInputs: [{ ...input, amount: -1n }],
        blindedOutputs: [output],
      }),
    ).toThrow();
  });
});

describe('keyset ids in the transcript', () => {
  const v3Input = {
    amount: 1n,
    keysetId: '0088553333aabbcc',
    secret: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
    C: 'aa'.repeat(48),
  };
  const out = { amount: 1n, keysetId: '0088553333aabbcc', B_: 'bb'.repeat(48) };

  test('a legacy base64 keyset id contributes its utf8 bytes, not an exception', () => {
    // Mixed transactions are normative (spec 5), and a pre-v1 keyset id is base64. Hex-decoding it
    // would make such a transaction impossible to sign or verify rather than merely unusual.
    const legacy = {
      amount: 1n,
      keysetId: 'I2yN+iRYfkzT',
      secret: 'legacy-plain-secret',
      C: 'ab'.repeat(33),
    };
    expect(
      transactionDigest({ proofInputs: [legacy, v3Input], blindedOutputs: [out] }),
    ).toHaveLength(32);
    const transcript = buildTransactionTranscript({ proofInputs: [legacy], blindedOutputs: [out] });
    expect(bytesToHex(transcript)).toContain(bytesToHex(new TextEncoder().encode('I2yN+iRYfkzT')));
  });

  test('an empty keyset id throws rather than encoding nothing', () => {
    expect(() =>
      transactionDigest({ proofInputs: [{ ...v3Input, keysetId: '' }], blindedOutputs: [out] }),
    ).toThrow(/keyset id/);
  });
});
