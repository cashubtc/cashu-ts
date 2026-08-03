import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, test, expect } from 'vitest';

import {
  buildTransactionTranscript,
  transactionDigest,
  TRANSCRIPT_DOMAIN_TAG,
  type TransactionShape,
} from '../../src/crypto/transcript';
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

  test('rejects a malformed proof secret', () => {
    const swap = fromVectorTx(tv.swap.tx);
    const bad = {
      ...swap,
      proofInputs: [{ ...swap.proofInputs![0], secret: 'aabb' }],
    };
    expect(() => buildTransactionTranscript(bad)).toThrow(/33 bytes/);
  });
});
