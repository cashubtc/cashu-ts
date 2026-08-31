// Regenerates the keyset-id-dependent parts of test/vectors/nutroot-v3.json in place:
// nut13_v3 outputs, the swap/mint/melt transcripts and digests, the swap signature, and
// the token_cashu_ts strings. Run from repo root: npx tsx scripts/generate-nutroot-vectors.ts
//
// token_nutshell strings are nutshell's encoder output and are NOT touched here; when ids
// change, regenerate them with nutshell (see tests/test_nutroot.py's token builder) and
// update both copies of the vector file in the same commit set.
import { readFileSync, writeFileSync } from 'node:fs';

import { bls12_381 } from '@noble/curves/bls12-381.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { deriveSecretAndBlindingFactor } from '../src/crypto';
import { getPubKeyFromPrivKey } from '../src/crypto/curve_secp';
import { deriveLeafKey, deriveNumsOffset, deriveQuoteLockKey } from '../src/crypto/NUT13';
import { BLS_FR_ORDER, hashToCurveBls } from '../src/crypto/curve_bls';
import {
  buildTransactionTranscript,
  inputDigest,
  spendCommitment,
  transactionDigest,
} from '../src/crypto/transcript';
import type { TransactionShape } from '../src/crypto/transcript';
import { Amount } from '../src/model/Amount';
import { decodeCBOR, encodeCBOR } from '../src/utils/cbor';
import {
  buildNutrootSecret,
  parseNutrootLeafHex,
  serializeNutrootLeaf,
  taggedHash,
  type NutrootLeaf,
  NUTROOT_NUMS_KEY,
} from '../src/crypto/nutroot';
import { deriveKeysetId, getEncodedToken } from '../src/utils/core';

const PATH = 'test/vectors/nutroot-v3.json';
const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

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

// The other derivation types over the same counters, so a mismatch in the framed message shows up
// as a type that disagrees rather than one that is simply absent.
for (const o of d.nut13_v3.outputs) {
  o.nums_offset = bytesToHex(deriveNumsOffset(seed, KEYSET_ID, o.counter));
}
d.nut13_v3.leaf_keys = [0, 1, 2].map((index) => {
  const privkey = deriveLeafKey(seed, KEYSET_ID, d.nut13_v3.outputs[0].counter, index);
  return {
    counter: d.nut13_v3.outputs[0].counter,
    index,
    privkey: bytesToHex(privkey),
    pubkey: bytesToHex(getPubKeyFromPrivKey(privkey)),
  };
});
d.nut13_v3.quote_locks = [0, 1].map((counter) => {
  const privkey = deriveQuoteLockKey(seed, counter);
  return {
    counter,
    privkey: bytesToHex(privkey),
    pubkey: bytesToHex(getPubKeyFromPrivKey(privkey)),
  };
});

// Recompute the attempt summary in the comment so it always states the current tuple.
const KDF_DST = utf8ToBytes('Cashu_KDF_HMAC_SHA256');
function acceptAttempt(
  counter: number,
  type: number,
  order: bigint,
  suffix = new Uint8Array(0),
): number {
  const keysetIdBytes = hexToBytes(KEYSET_ID);
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, keysetIdBytes.length, false);
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
  const base = concatBytes(KDF_DST, lenBytes, keysetIdBytes, counterBytes, new Uint8Array([type]));
  for (let attempt = 0; attempt < 1 << 16; attempt++) {
    const attemptBytes = new Uint8Array(4);
    new DataView(attemptBytes.buffer).setUint32(0, attempt, false);
    const x = BigInt(
      '0x' + bytesToHex(hmac(sha256, seed, concatBytes(base, attemptBytes, suffix))),
    );
    if (x !== 0n && x < order) return attempt;
  }
  throw new Error('no accepting attempt');
}
const counters = d.nut13_v3.outputs.map((o: any) => o.counter);
const keyAttempts = counters.map((c: number) => acceptAttempt(c, 0, SECP256K1_N));
const bfAttempts = counters.map((c: number) => acceptAttempt(c, 1, BLS_FR_ORDER));
const summary = `Key derivation (0x00) accepts at attempts ${keyAttempts.join(', ')} and blinding factors (0x01) at attempts ${bfAttempts.join(', ')} for counters ${counters.join(', ')}, exercising the rejection loop.`;
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

for (const name of ['swap', 'mint', 'melt', 'melt_with_change'] as const) {
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
}

// --- tokens_v4 --------------------------------------------------------------
const tv = d.tokens_v4;
if (tv.shapes.bearer_k.spend_info.k !== oldBearerK) throw new Error('bearer_k mapping drifted');
tv.shapes.bearer_k.secret = d.nut13_v3.outputs[0].secret;
tv.shapes.bearer_k.spend_info.k = d.nut13_v3.outputs[0].secret_key;
// A script-only shape pins the new `r` field across implementations: the offset is what proves
// the proof has no key path, so it has to survive the token round-trip. Deterministic r so the
// vector is stable; a real send uses a fresh one per proof.
{
  const base = tv.shapes.explicit_K_tree;
  const leaves = base.spend_info.tree.map((leaf: string) =>
    parseNutrootLeafHex(leaf),
  ) as NutrootLeaf[];
  const built = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves, {
    u: hexToBytes(d.nut13_v3.outputs[0].nums_offset),
  });
  if (built.tree.join() !== base.spend_info.tree.join()) {
    throw new Error('script_only_u: tree did not round-trip through the leaf parser');
  }
  tv.shapes.script_only_u = {
    ...(tv.shapes.script_only_u ?? {}),
    secret: built.secret,
    spend_info: { K: built.K, u: built.u, tree: built.tree },
  };
}

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

// token_nutshell strings are nutshell's encoder output: the short/long keyset id and the CBOR map
// order are its choices, not ours, and that is what makes them a cross-implementation check. So
// patch the changed values into the existing bytes rather than re-encoding from scratch. The
// decode/re-encode round-trip must reproduce the original byte for byte before anything is
// changed; if it ever stops doing so, regenerate these with nutshell instead of trusting this.
function b64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}
function b64urlEncode(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url').replace(/=+$/, '');
}
for (const [name, shape] of Object.entries<any>(tv.shapes)) {
  // A shape with no nutshell string yet borrows another's bytes as the template, so the id
  // length and map order stay nutshell's rather than becoming ours.
  const raw: string = shape.token_nutshell ?? tv.shapes.explicit_K_tree.token_nutshell;
  const decoded = decodeCBOR(b64urlDecode(raw.slice('cashuB'.length))) as any;
  if (shape.token_nutshell && 'cashuB' + b64urlEncode(encodeCBOR(decoded)) !== raw) {
    throw new Error(`${name}: token_nutshell does not round-trip; regenerate it with nutshell`);
  }
  const entry = decoded.t[0];
  entry.i = hexToBytes(KEYSET_ID);
  const proof = entry.p[0];
  proof.s = shape.secret;
  // nutshell writes the si map in its model's field order: k, e, i, u, t.
  const si: Record<string, unknown> = {};
  for (const [field, key] of [
    ['k', 'k'],
    ['e', 'E'],
    ['i', 'K'],
    ['u', 'u'],
    ['t', 'tree'],
  ] as const) {
    const value = shape.spend_info[key];
    if (value === undefined) continue;
    si[field] = Array.isArray(value) ? value.map(hexToBytes) : hexToBytes(value);
  }
  proof.si = si;
  shape.token_nutshell = 'cashuB' + b64urlEncode(encodeCBOR(decoded));
  console.log(`token_nutshell repatched: ${name}`);
}

// --- input digests, disclosure, and NUT-07 commitments ----------------------
const SecpPoint = secp256k1.Point;
const AUX0 = new Uint8Array(32);
const bigTo32 = (x: bigint) => hexToBytes(x.toString(16).padStart(64, '0'));

// Each transcript vector has exactly one input, and containers group in
// ascending type order, so the input container is the transcript's first record.
for (const name of ['swap', 'mint', 'melt', 'melt_with_change'] as const) {
  const example = d.transcript[name];
  const t = hexToBytes(example.transcript);
  const digestCheck = bytesToHex(sha256(concatBytes(utf8ToBytes('Cashu_Transaction_v1'), t)));
  if (digestCheck !== example.digest) throw new Error(`${name}: transcript/digest mismatch`);
  const container = t.subarray(0, 3 + ((t[1] << 8) | t[2]));
  example.input_id = bytesToHex(sha256(container));
  example.input_digest = bytesToHex(
    taggedHash('Cashu_TransactionInput', hexToBytes(example.digest), hexToBytes(example.input_id)),
  );
  if (bytesToHex(inputDigest(hexToBytes(example.digest), container)) !== example.input_digest) {
    throw new Error(`${name}: implementation inputDigest disagrees with the local recompute`);
  }
  if (example.signature !== undefined) {
    example.signature = bytesToHex(
      schnorr.sign(
        hexToBytes(example.input_digest),
        hexToBytes(d.nut13_v3.outputs[0].secret_key),
        AUX0,
      ),
    );
  }
}
if (d.transcript.swap.input_id !== d.transcript.melt.input_id)
  throw new Error('swap and melt spend the same proof, so their input ids must match');
d.transcript.comment =
  'Transaction transcript (NUT-10). msg = domain_tag utf8 bytes || TLV stream; digest = SHA256(msg). Each input signs tagged_hash("Cashu_TransactionInput", digest || SHA256(its own container record)) (BIP-340, aux = 32 zero bytes). Containers: 01 proof input (fields: 01 amount, 02 keyset id, 03 secret P, 04 C), 02 mint quote input (01 amount, 02 quote id utf8), 03 blinded output (01 amount, 02 keyset id, 03 B_), 04 melt quote output (01 amount, 02 quote id utf8). Container types ascend; request order within a type; amounts minimal big-endian; points and keyset ids raw bytes.';

// Two proof inputs in one transaction pin the distinction between the shared transaction digest
// and each input's signing digest.
{
  const first = d.transcript.swap.tx.proof_inputs[0];
  const txVector = {
    proof_inputs: [
      first,
      {
        ...first,
        amount: 4,
        secret: d.nut13_v3.outputs[1].secret,
      },
    ],
    blinded_outputs: d.transcript.swap.tx.blinded_outputs.map((output: any, index: number) => ({
      ...output,
      amount: index === 0 ? 8 : 4,
    })),
  };
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const containers: Uint8Array[] = [];
  for (let offset = 0; offset < transcript.length; ) {
    const length = (transcript[offset + 1] << 8) | transcript[offset + 2];
    const record = transcript.subarray(offset, offset + 3 + length);
    if (record[0] === 0x01) containers.push(record);
    offset += record.length;
  }
  if (containers.length !== 2) throw new Error('multi_input: expected two proof containers');
  d.transcript.multi_input = {
    tx: txVector,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    inputs: containers.map((container, index) => {
      const digestForInput = inputDigest(digest, container);
      return {
        input_id: bytesToHex(sha256(container)),
        input_digest: bytesToHex(digestForInput),
        signature: bytesToHex(
          schnorr.sign(digestForInput, hexToBytes(d.nut13_v3.outputs[index].secret_key), AUX0),
        ),
      };
    }),
  };
}

// Disclosure leaf forms: threshold_1of1 with the 0x0a field, plus its rejection shapes.
d.leaf_forms.threshold_1of1_disclosure = d.leaf_forms.threshold_1of1 + '0a000101';
{
  const parsed = parseNutrootLeafHex(d.leaf_forms.threshold_1of1_disclosure);
  if (parsed.disclosure !== 0x01) throw new Error('disclosure did not parse');
  const reserialized = bytesToHex(serializeNutrootLeaf(parsed));
  if (reserialized !== d.leaf_forms.threshold_1of1_disclosure) {
    throw new Error('disclosure leaf did not round-trip through the codec');
  }
}
d.leaf_forms.leaf_disclosure_mode0 = d.leaf_forms.threshold_1of1 + '0a000100';
d.leaf_forms.leaf_disclosure_empty = d.leaf_forms.threshold_1of1 + '0a0000';
d.leaf_forms.leaf_disclosure_mode2 = d.leaf_forms.threshold_1of1 + '0a000102';

// Auditable lock (NUT-10): NUMS offset u = 7, one threshold leaf to test key 3 carrying
// disclosure, spent in a complete one-input swap transcript.
const N_SECP = SECP256K1_N;
const H_NUMS = SecpPoint.fromBytes(hexToBytes(NUTROOT_NUMS_KEY));
const K_aud = H_NUMS.add(SecpPoint.BASE.multiply(7n)).toBytes(true);
const audLeaf = hexToBytes(d.leaf_forms.threshold_1of1_disclosure);
const audRoot = taggedHash('Cashu_NutrootLeaf', audLeaf);
const audTweak =
  BigInt('0x' + bytesToHex(taggedHash('Cashu_NutrootTweak', K_aud, audRoot))) % N_SECP;
const audSecret = SecpPoint.fromBytes(K_aud).add(SecpPoint.BASE.multiply(audTweak)).toBytes(true);
const audTxVector = {
  proof_inputs: [
    {
      ...d.transcript.swap.tx.proof_inputs[0],
      secret: bytesToHex(audSecret),
    },
  ],
  blinded_outputs: d.transcript.swap.tx.blinded_outputs,
};
const audTx = fromVectorTx(audTxVector);
const audTranscript = buildTransactionTranscript(audTx);
const audTransactionDigest = transactionDigest(audTx);
const audContainer = audTranscript.subarray(0, 3 + ((audTranscript[1] << 8) | audTranscript[2]));
const audInputDigest = inputDigest(audTransactionDigest, audContainer);
const audSig = bytesToHex(schnorr.sign(audInputDigest, bigTo32(3n), AUX0));
const audWitness = JSON.stringify({
  leaf: d.leaf_forms.threshold_1of1_disclosure,
  control: { K: bytesToHex(K_aud), path: [] },
  signatures: [audSig],
});
d.auditable_lock = {
  comment:
    'Canonical auditable lock: NUMS offset u = 7, one threshold leaf n = 1 to test key 3 with disclosure mode 0x01, spent in the pinned transaction.',
  P: bytesToHex(secp256k1.getPublicKey(bigTo32(3n), true)),
  u: bytesToHex(bigTo32(7n)),
  K: bytesToHex(K_aud),
  leaf: d.leaf_forms.threshold_1of1_disclosure,
  merkle_root: bytesToHex(audRoot),
  tweak: bytesToHex(bigTo32(audTweak)),
  secret: bytesToHex(audSecret),
  Y: hashToCurveBls(audSecret).toHex(true),
  tx: audTxVector,
  transcript: bytesToHex(audTranscript),
  digest: bytesToHex(audTransactionDigest),
  input_id: bytesToHex(sha256(audContainer)),
  input_digest: bytesToHex(audInputDigest),
  witness: audWitness,
};

// NUT-07 spend commitments: tagged_hash("Cashu_SpendCommitment", Y || input_digest || witness_hash)
// over the exact compact witness string. One private key-path spend (the swap), one disclosed
// script-path spend (the auditable lock).
const commitment = (yHex: string, inputDigestHex: string, witness: string) => {
  const local = bytesToHex(
    taggedHash(
      'Cashu_SpendCommitment',
      hexToBytes(yHex),
      hexToBytes(inputDigestHex),
      sha256(utf8ToBytes(witness)),
    ),
  );
  if (spendCommitment(yHex, hexToBytes(inputDigestHex), witness) !== local) {
    throw new Error('implementation spendCommitment disagrees with the local recompute');
  }
  return local;
};
const swapWitness = JSON.stringify({ signatures: [d.transcript.swap.signature] });
d.nut07_commitments = {
  comment:
    'witness_hash = SHA256 over the UTF-8 bytes of the exact witness string value; Y contributes raw compressed bytes.',
  keypath_private: {
    Y: d.nut13_v3.outputs[0].Y,
    input_digest: d.transcript.swap.input_digest,
    witness: swapWitness,
    witness_hash: bytesToHex(sha256(utf8ToBytes(swapWitness))),
    commitment: commitment(d.nut13_v3.outputs[0].Y, d.transcript.swap.input_digest, swapWitness),
  },
  disclosed_script_path: {
    Y: d.auditable_lock.Y,
    input_digest: d.auditable_lock.input_digest,
    witness: audWitness,
    witness_hash: bytesToHex(sha256(utf8ToBytes(audWitness))),
    commitment: commitment(d.auditable_lock.Y, d.auditable_lock.input_digest, audWitness),
  },
};

writeFileSync(PATH, JSON.stringify(d, null, 2) + '\n');
console.log(
  `written ${PATH} (keyset id ${OLD_ID === KEYSET_ID ? 'unchanged' : `${OLD_ID} -> ${KEYSET_ID}`})`,
);
if (OLD_ID !== KEYSET_ID) {
  console.warn(
    'keyset id changed: regenerate token_nutshell strings with nutshell and sync both copies',
  );
}
