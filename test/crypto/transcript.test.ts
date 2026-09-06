import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, test, expect } from 'vitest';

import { recoverV3SecretKeys } from '../../src/crypto/NUT13';
import {
  buildRequestTranscript,
  buildTransactionTranscript,
  proofInputContextKey,
  requestDigest,
  signTransactionInput,
  spendCommitment,
  transactionDigest,
  transactionInputs,
  TRANSCRIPT_DOMAIN_TAG,
  verifyTransactionInputWitness,
  type TransactionShape,
} from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import vectors from '../vectors/nutroot-v3.json';

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

  test.each(['swap', 'mint', 'melt', 'melt_with_change'] as const)(
    '%s transcript and digest match',
    (name) => {
      const example = tv[name];
      const tx = fromVectorTx(example.tx);
      expect(bytesToHex(buildTransactionTranscript(tx))).toBe(example.transcript);
      expect(bytesToHex(transactionDigest(tx))).toBe(example.digest);
    },
  );

  test('the swap signature is a key-path witness over the input digest by the proof secret', () => {
    const { proofs, transactionDigest: txDigest } = transactionInputs(fromVectorTx(tv.swap.tx));
    expect(bytesToHex(txDigest)).toBe(tv.swap.digest);
    const secret = tv.swap.tx.proof_inputs[0].secret;
    const context = proofs.get(
      proofInputContextKey({ keysetId: tv.swap.tx.proof_inputs[0].keyset_id, secret }),
    )!;
    expect(bytesToHex(sha256(context.inputContainer))).toBe(tv.swap.input_id);
    expect(bytesToHex(context.digest)).toBe(tv.swap.input_digest);
    expect(
      schnorr.verify(hexToBytes(tv.swap.signature), context.digest, hexToBytes(secret).subarray(1)),
    ).toBe(true);
    // Reproduce deterministically from the vector secret key (aux = 32 zero bytes).
    const sig = schnorr.sign(
      context.digest,
      hexToBytes(vectors.nut13_v3.outputs[0].secret_key),
      new Uint8Array(32),
    );
    expect(bytesToHex(sig)).toBe(tv.swap.signature);
    // The transaction never signs its shared digest directly: the swap's witness must not verify
    // against it, nor against another transaction's input digest for the same proof.
    expect(
      schnorr.verify(hexToBytes(tv.swap.signature), txDigest, hexToBytes(secret).subarray(1)),
    ).toBe(false);
    expect(hexToBytes(tv.melt.input_id)).toEqual(hexToBytes(tv.swap.input_id));
    expect(tv.melt.input_digest).not.toBe(tv.swap.input_digest);
  });

  test('each input in the multi-input vector signs its own digest', () => {
    const vector = tv.multi_input;
    const tx = fromVectorTx(vector.tx);
    const contexts = transactionInputs(tx);
    expect(bytesToHex(buildTransactionTranscript(tx))).toBe(vector.transcript);
    expect(bytesToHex(contexts.transactionDigest)).toBe(vector.digest);
    vector.tx.proof_inputs.forEach((proof, index) => {
      const context = contexts.proofs.get(
        proofInputContextKey({ keysetId: proof.keyset_id, secret: proof.secret }),
      )!;
      const expected = vector.inputs[index];
      expect(bytesToHex(sha256(context.inputContainer))).toBe(expected.input_id);
      expect(bytesToHex(context.digest)).toBe(expected.input_digest);
      expect(
        schnorr.verify(
          hexToBytes(expected.signature),
          context.digest,
          hexToBytes(proof.secret).subarray(1),
        ),
      ).toBe(true);
    });
    expect(vector.inputs[0].input_digest).not.toBe(vector.inputs[1].input_digest);
  });

  test('each quote in the batch-mint vector signs its own digest', () => {
    const vector = tv.batch_mint;
    const tx = fromVectorTx(vector.tx);
    const contexts = transactionInputs(tx);
    expect(bytesToHex(buildTransactionTranscript(tx))).toBe(vector.transcript);
    expect(bytesToHex(contexts.transactionDigest)).toBe(vector.digest);
    vector.tx.mint_quote_inputs.forEach((quote, index) => {
      const expected = vector.inputs[index];
      expect(expected.quote_id).toBe(quote.quote_id);
      const context = contexts.quotes.get(quote.quote_id)!;
      expect(bytesToHex(sha256(context.inputContainer))).toBe(expected.input_id);
      expect(bytesToHex(context.digest)).toBe(expected.input_digest);
      expect(
        schnorr.verify(
          hexToBytes(expected.signature),
          context.digest,
          hexToBytes(expected.lock_pubkey).subarray(1),
        ),
      ).toBe(true);
    });
    expect(vector.inputs[0].input_digest).not.toBe(vector.inputs[1].input_digest);
  });

  test('the disclosed script-path vector uses a complete transaction context', () => {
    const aud = vectors.auditable_lock;
    const tx = fromVectorTx(aud.tx);
    const context = transactionInputs(tx).proofs.get(
      proofInputContextKey({
        keysetId: aud.tx.proof_inputs[0].keyset_id,
        secret: aud.tx.proof_inputs[0].secret,
      }),
    )!;
    expect(bytesToHex(buildTransactionTranscript(tx))).toBe(aud.transcript);
    expect(bytesToHex(transactionDigest(tx))).toBe(aud.digest);
    expect(bytesToHex(sha256(context.inputContainer))).toBe(aud.input_id);
    expect(bytesToHex(context.digest)).toBe(aud.input_digest);
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
    const digest = hexToBytes(tv.swap.input_digest);
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
    const digest = hexToBytes(tv.swap.input_digest);
    const secret = tv.swap.tx.proof_inputs[0].secret;
    const good = JSON.stringify({ signatures: [tv.swap.signature] });
    expect(verifyTransactionInputWitness(hexToBytes(tv.mint.input_digest), secret, good)).toBe(
      false,
    );
    expect(verifyTransactionInputWitness(digest, secret, 'not-json')).toBe(false);
    expect(verifyTransactionInputWitness(digest, secret, '{"signatures":[]}')).toBe(false);
    expect(verifyTransactionInputWitness(digest, 'aabb', good)).toBe(false);
  });

  test('rejects a key-path witness with more than one signature entry', () => {
    // NUT-10: `signatures` MUST contain exactly one entry; a doubled valid
    // signature makes the witness invalid (tests/10-tests.md rejection vector).
    const digest = hexToBytes(tv.swap.input_digest);
    const secret = tv.swap.tx.proof_inputs[0].secret;
    const doubled = JSON.stringify({ signatures: [tv.swap.signature, tv.swap.signature] });
    expect(verifyTransactionInputWitness(digest, secret, doubled)).toBe(false);
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
    // NUT-10: rules follow the proof's keyset and verification is per input, so a legacy
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

  test('the same secret text is distinct across legacy and v3 inputs', () => {
    const swap = fromVectorTx(tv.swap.tx);
    const v3 = swap.proofInputs![0];
    const legacy = { ...v3, keysetId: `01${'11'.repeat(32)}` };
    const { proofs } = transactionInputs({ ...swap, proofInputs: [legacy, v3] });
    expect(proofs.size).toBe(2);
    expect(proofs.get(proofInputContextKey(legacy))!.digest).not.toEqual(
      proofs.get(proofInputContextKey(v3))!.digest,
    );
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
          proofInputs: [{ ...input, amount: amount as unknown as bigint }],
          blindedOutputs: [output],
        }),
      ),
    );
    expect(new Set(digests).size).toBe(1);
  });

  test('a nonsense amount throws rather than encoding something', () => {
    expect(() =>
      transactionDigest({
        proofInputs: [{ ...input, amount: 'not-a-number' as unknown as bigint }],
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
    // Mixed transactions are normative (NUT-10), and a pre-v1 keyset id is base64. Hex-decoding it
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

describe('request transcript (NUT-22 vector)', () => {
  // nuts tests/22-tests.md: a BAT (secret key 3) authorizing POST /v1/swap.
  const METHOD = 'POST';
  const TARGET = '/v1/swap';
  const BODY = new TextEncoder().encode('illustrative request body');
  const SECRET = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
  const DIGEST = 'ed581b087f06e474da2417eaf96d358244cb1b1b14464b2e3d8706f9a67bc10c';
  const WITNESS = JSON.stringify({
    signatures: [
      '6a120a859e0cb85f9cb3d7a69c756d4f4f8ac0954785d7c9a9262ed937ddb3123d10a296a5ded693974f2b4722f89f9d00498d50f0706eb94bd967e5f3c7b85c',
    ],
  });

  test('pins the transcript and digest byte for byte', () => {
    expect(bytesToHex(buildRequestTranscript(METHOD, TARGET, BODY))).toBe(
      '050035010004504f53540200082f76312f73776170030020bc14236ec9e2bf6d961268b7463d7be83e01554adfd063361e9e3ae985edce19',
    );
    expect(bytesToHex(requestDigest(METHOD, TARGET, BODY))).toBe(DIGEST);
  });

  test('the vector witness verifies against the BAT secret, and binds the request', () => {
    expect(
      verifyTransactionInputWitness(requestDigest(METHOD, TARGET, BODY), SECRET, WITNESS),
    ).toBe(true);
    expect(verifyTransactionInputWitness(requestDigest('GET', TARGET, BODY), SECRET, WITNESS)).toBe(
      false,
    );
    expect(
      verifyTransactionInputWitness(
        requestDigest(METHOD, TARGET, new TextEncoder().encode('substituted body')),
        SECRET,
        WITNESS,
      ),
    ).toBe(false);
  });

  test('an empty body hashes the empty byte string', () => {
    expect(bytesToHex(buildRequestTranscript('GET', '/v1/info', new Uint8Array()))).toContain(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('request transcript with a query string (NUT-22 vector)', () => {
  // nuts tests/22-tests.md: the target is the origin-form request-target as sent, query string
  // unsorted and percent-encoded as transmitted; the absent body hashes the empty byte string.
  const METHOD = 'GET';
  const TARGET = '/v1/mint/quote/bolt11/quote123?b=2&a=1&q=a%20b';
  const BODY = new Uint8Array();
  const SECRET = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
  const DIGEST = '6ed8e3a69429d4845ddcfa8728c7461c97b0c189592228c25266c630f62b1680';
  const WITNESS = JSON.stringify({
    signatures: [
      '9306bc19ad0e497185a34ec9a49de0bd8161bcdf1c58f0fd9f108a7603affb1d24b1a2fd6d513bf843ac92c29c95614beb535ace4e3a4a8677d688388209fb88',
    ],
  });

  test('pins the transcript and digest byte for byte', () => {
    expect(bytesToHex(buildRequestTranscript(METHOD, TARGET, BODY))).toBe(
      '05005a01000347455402002e2f76312f6d696e742f71756f74652f626f6c7431312f71756f74653132333f623d3226613d3126713d6125323062030020e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(bytesToHex(requestDigest(METHOD, TARGET, BODY))).toBe(DIGEST);
  });

  test('the vector witness verifies, and a re-sorted query string does not', () => {
    expect(
      verifyTransactionInputWitness(requestDigest(METHOD, TARGET, BODY), SECRET, WITNESS),
    ).toBe(true);
    const sorted = '/v1/mint/quote/bolt11/quote123?a=1&b=2&q=a%20b';
    expect(
      verifyTransactionInputWitness(requestDigest(METHOD, sorted, BODY), SECRET, WITNESS),
    ).toBe(false);
    const reEncoded = '/v1/mint/quote/bolt11/quote123?b=2&a=1&q=a+b';
    expect(
      verifyTransactionInputWitness(requestDigest(METHOD, reEncoded, BODY), SECRET, WITNESS),
    ).toBe(false);
  });
});

describe('transcript input guards', () => {
  const input = { amount: 1n, keysetId: '0200', secret: '02'.padEnd(66, 'a'), C: 'aa'.repeat(48) };
  const out = { amount: 1n, keysetId: '0200', B_: 'bb'.repeat(48) };

  test('a negative amount cannot enter the transcript', () => {
    // Amount.from refuses first; the transcript's own guard is defense-in-depth behind it.
    expect(() =>
      buildTransactionTranscript({
        proofInputs: [{ ...input, amount: -1n }],
        blindedOutputs: [out],
      }),
    ).toThrow(/>= 0|non-negative/);
  });

  test('an empty quote id is refused', () => {
    expect(() =>
      buildTransactionTranscript({
        proofInputs: [input],
        blindedOutputs: [out],
        meltQuoteOutputs: [{ amount: 1n, quoteId: '' }],
      }),
    ).toThrow(/non-empty/);
  });

  test('request transcripts need a method and a target', () => {
    expect(() => buildRequestTranscript('', '/x', new Uint8Array())).toThrow(/method and a target/);
    expect(() => buildRequestTranscript('GET', '', new Uint8Array())).toThrow(
      /method and a target/,
    );
  });

  test('signTransactionInput refuses a digest that is not 32 bytes', () => {
    expect(() => signTransactionInput(new Uint8Array(31), hexToBytes('11'.repeat(32)))).toThrow(
      /32 bytes/,
    );
  });

  test('witness verification returns false for a secret that is not on the curve', () => {
    const witness = JSON.stringify({ signatures: ['ab'.repeat(64)] });
    // x = 0 and x >= p both fail closed, whether the library reports or throws.
    expect(verifyTransactionInputWitness(new Uint8Array(32), `02${'00'.repeat(32)}`, witness)).toBe(
      false,
    );
    expect(verifyTransactionInputWitness(new Uint8Array(32), `02${'ff'.repeat(32)}`, witness)).toBe(
      false,
    );
  });

  test('recoverV3SecretKeys guards its keyset and scan bound', () => {
    const seed = new TextEncoder().encode('seed');
    expect(() => recoverV3SecretKeys(seed, `00${'11'.repeat(32)}`, [], 4)).toThrow(/v3 keyset/);
    const bls = vectors.nut13_v3.keyset_id;
    expect(() => recoverV3SecretKeys(seed, bls, [], -1)).toThrow(/maxCounter/);
    expect(() => recoverV3SecretKeys(seed, bls, [], 1.5)).toThrow(/maxCounter/);
    expect(() => recoverV3SecretKeys(seed, bls, [], (1 << 20) + 1)).not.toThrow();
    expect(() => recoverV3SecretKeys(seed, bls, [], Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /maxCounter/,
    );
  });
});

describe('input uniqueness and spend commitments (vectors)', () => {
  test('a repeated proof or quote input refuses to serialize', () => {
    const swap = fromVectorTx(tv.swap.tx);
    expect(() =>
      buildTransactionTranscript({
        ...swap,
        proofInputs: [...swap.proofInputs!, swap.proofInputs![0]],
      }),
    ).toThrow(/repeats a proof/);
    const mint = fromVectorTx(tv.mint.tx);
    expect(() =>
      buildTransactionTranscript({
        ...mint,
        mintQuoteInputs: [...mint.mintQuoteInputs!, mint.mintQuoteInputs![0]],
      }),
    ).toThrow(/repeats a mint quote/);
  });

  test('the mint quote input derives its digest from its own container', () => {
    const { quotes } = transactionInputs(fromVectorTx(tv.mint.tx));
    const context = quotes.get(tv.mint.tx.mint_quote_inputs[0].quote_id)!;
    expect(bytesToHex(sha256(context.inputContainer))).toBe(tv.mint.input_id);
    expect(bytesToHex(context.digest)).toBe(tv.mint.input_digest);
  });

  test('spend commitments reproduce the NUT-07 vectors and bind every field', () => {
    for (const v of Object.values(vectors.nut07_commitments)) {
      if (typeof v === 'string') continue; // the comment field
      expect(bytesToHex(sha256(new TextEncoder().encode(v.witness)))).toBe(v.witness_hash);
      expect(spendCommitment(v.Y, hexToBytes(v.input_digest), v.witness)).toBe(v.commitment);
      // Any field change lands on a different commitment.
      expect(spendCommitment(v.Y, hexToBytes(v.input_digest), v.witness + ' ')).not.toBe(
        v.commitment,
      );
      expect(spendCommitment(v.Y, sha256(hexToBytes(v.input_digest)), v.witness)).not.toBe(
        v.commitment,
      );
    }
  });
});
