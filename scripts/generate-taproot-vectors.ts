// Regenerates the keyset-id-dependent parts of test/vectors/taproot-v3.json in place:
// nut13_v3 outputs, the swap/mint/melt transcripts and digests, the swap signature, and
// the token_cashu_ts strings. Run from repo root: npx tsx scripts/generate-taproot-vectors.ts
//
// token_nutshell strings are nutshell's encoder output and are NOT touched here; when ids
// change, regenerate them with nutshell (see tests/test_taproot.py's token builder) and
// update both copies of the vector file in the same commit set.
import { readFileSync, writeFileSync } from 'node:fs';

import { bls12_381 } from '@noble/curves/bls12-381.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { deriveSecretAndBlindingFactor } from '../src/crypto';
import { BLS_FR_ORDER, hashToCurveBls } from '../src/crypto/curve_bls';
import { buildTransactionTranscript, transactionDigest } from '../src/crypto/transcript';
import type { TransactionShape } from '../src/crypto/transcript';
import { Amount } from '../src/model/Amount';
import { deriveKeysetId, getEncodedToken } from '../src/utils/core';

const PATH = 'test/vectors/taproot-v3.json';

// NUT-02 V3 vector 1 (nuts tests/02-tests.md): keys are 7*G2 and 13*G2, unit sat, no fee.
const G2 = bls12_381.G2.Point.BASE;
const VEC1_KEYS = {
  '1': bytesToHex(G2.multiply(7n).toBytes(true)),
  '2': bytesToHex(G2.multiply(13n).toBytes(true)),
};
const KEYSET_ID = deriveKeysetId(VEC1_KEYS, { versionByte: 2, unit: 'sat' });

const d = JSON.parse(readFileSync(PATH, 'utf8'));
const OLD_ID = d.nut13_v3.keyset_id;

// --- nut13_v3 ---------------------------------------------------------------
const seed = new TextEncoder().encode(d.nut13_v3.seed_utf8);
const oldSecretIndex: Record<string, number> = {};
d.nut13_v3.outputs.forEach((o: any, i: number) => {
  oldSecretIndex[o.secret] = i;
});
const oldBearerK = d.nut13_v3.outputs[0].secret_key;
d.nut13_v3.keyset_id = KEYSET_ID;
for (const o of d.nut13_v3.outputs) {
  const { secret, secretKey, blindingFactor } = deriveSecretAndBlindingFactor(
    seed,
    KEYSET_ID,
    o.counter,
  ) as any;
  o.secret_key = bytesToHex(secretKey);
  o.secret = bytesToHex(secret);
  o.blinding_factor = bytesToHex(blindingFactor);
  if ('Y' in o) o.Y = hashToCurveBls(hexToBytes(o.secret)).toHex(true);
}

// Recompute the attempt summary in the comment so it always states the current tuple.
const KDF_DST = utf8ToBytes('Cashu_KDF_HMAC_SHA256');
function bfAcceptAttempt(counter: number): number {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
  const base = concatBytes(KDF_DST, hexToBytes(KEYSET_ID), counterBytes);
  for (let attempt = 0; attempt < 1 << 16; attempt++) {
    const attemptBytes = new Uint8Array(4);
    new DataView(attemptBytes.buffer).setUint32(0, attempt, false);
    const x = BigInt(
      '0x' + bytesToHex(hmac(sha256, seed, concatBytes(base, new Uint8Array([1]), attemptBytes))),
    );
    if (x !== 0n && x < BLS_FR_ORDER) return attempt;
  }
  throw new Error('no accepting attempt');
}
const attempts = d.nut13_v3.outputs.map((o: any) => bfAcceptAttempt(o.counter));
const summary = `Key derivation (0x00) succeeds at attempt 0 for every counter; blinding factors (0x01) accept at attempts ${attempts.join(', ')} for counters ${d.nut13_v3.outputs.map((o: any) => o.counter).join(', ')}, exercising the rejection loop.`;
const claim = /Key derivation \(0x00\)[^]*?exercising the rejection loop\./;
if (!claim.test(d.nut13_v3.comment))
  throw new Error('attempt-summary sentence not found in comment');
d.nut13_v3.comment = d.nut13_v3.comment.replace(claim, summary);

// --- transcript -------------------------------------------------------------
function fromVectorTx(tx: any): TransactionShape {
  return {
    proofInputs: tx.proof_inputs?.map((p: any) => ({
      amount: BigInt(p.amount),
      keysetId: p.keyset_id,
      secret: p.secret,
      C: p.C,
    })),
    mintQuoteInputs: tx.mint_quote_inputs?.map((q: any) => ({
      amount: BigInt(q.amount),
      quoteId: q.quote_id,
    })),
    blindedOutputs: tx.blinded_outputs?.map((o: any) => ({
      amount: BigInt(o.amount),
      keysetId: o.keyset_id,
      B_: o.B_,
    })),
    meltQuoteOutputs: tx.melt_quote_outputs?.map((q: any) => ({
      amount: BigInt(q.amount),
      quoteId: q.quote_id,
    })),
  };
}

for (const name of ['swap', 'mint', 'melt'] as const) {
  const example = d.transcript[name];
  for (const fld of ['proof_inputs', 'blinded_outputs'] as const) {
    for (const entry of example.tx[fld] ?? []) {
      if (entry.keyset_id !== OLD_ID) throw new Error(`${name}.${fld}: unexpected keyset id`);
      entry.keyset_id = KEYSET_ID;
      if (entry.secret !== undefined) {
        const idx = oldSecretIndex[entry.secret];
        if (idx === undefined) throw new Error(`${name}.${fld}: secret not from nut13 outputs`);
        entry.secret = d.nut13_v3.outputs[idx].secret;
      }
    }
  }
  const tx = fromVectorTx(example.tx);
  example.transcript = bytesToHex(buildTransactionTranscript(tx));
  example.digest = bytesToHex(transactionDigest(tx));
  if (example.signature !== undefined) {
    example.signature = bytesToHex(
      schnorr.sign(
        hexToBytes(example.digest),
        hexToBytes(d.nut13_v3.outputs[0].secret_key),
        new Uint8Array(32),
      ),
    );
  }
}

// --- tokens_v4 --------------------------------------------------------------
const tv = d.tokens_v4;
if (tv.shapes.bearer_k.spend_info.k !== oldBearerK) throw new Error('bearer_k mapping drifted');
tv.shapes.bearer_k.secret = d.nut13_v3.outputs[0].secret;
tv.shapes.bearer_k.spend_info.k = d.nut13_v3.outputs[0].secret_key;
for (const [name, shape] of Object.entries<any>(tv.shapes)) {
  const proof = {
    id: KEYSET_ID,
    amount: Amount.from(tv.amount),
    secret: shape.secret,
    C: tv.C,
    spend_info: shape.spend_info,
  };
  shape.token_cashu_ts = getEncodedToken({ mint: tv.mint, proofs: [proof], unit: tv.unit } as any);
  console.log(`token_cashu_ts regenerated: ${name}`);
}

writeFileSync(PATH, JSON.stringify(d, null, 2) + '\n');
console.log(
  `written ${PATH} (keyset id ${OLD_ID === KEYSET_ID ? 'unchanged' : `${OLD_ID} -> ${KEYSET_ID}`})`,
);
if (OLD_ID !== KEYSET_ID) {
  console.warn(
    'keyset id changed: regenerate token_nutshell strings with nutshell and sync both copies',
  );
}
