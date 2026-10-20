// Regenerates the keyset-id-dependent parts of test/vectors/nutroot-v3.json in place:
// nut13_v3 outputs, the transcripts and digests with their signatures, and
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
import {
  deriveLeafKey,
  deriveNumsOffset,
  deriveQuoteIdPreimage,
  deriveQuoteLockKey,
} from '../src/crypto/NUT13';
import { BLS_FR_ORDER, hashToCurveBls } from '../src/crypto/curve_bls';
import { hashToCurveHex } from '../src/crypto/curves';
import {
  buildTransactionTranscript,
  derivedQuoteId,
  inputDigest,
  transactionDigest,
} from '../src/crypto/transcript';
import type { TransactionShape } from '../src/crypto/transcript';
import { Amount } from '../src/model/Amount';
import { decodeCBOR, encodeCBOR } from '../src/utils/cbor';
import {
  buildNutrootSecret,
  parseNutrootLeafHex,
  serializeNutrootLeaf,
  type NutrootLeaf,
  NUTROOT_NUMS_KEY,
} from '../src/crypto/nutroot';
import { ScriptPath, type ScriptPathSigningPackage } from '../src/model/ScriptPath';
import { deriveKeysetId, getEncodedToken } from '../src/utils/core';
import { taggedHash } from '../src/crypto/core';

const PATH = 'test/vectors/nutroot-v3.json';
const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

// NUT-02 V3 vector 1 (nuts tests/02-tests.md): keys are 7*G2 and 13*G2, unit sat, no fee.
const G2 = bls12_381.G2.Point.BASE;
const VEC1_KEYS = {
  '1': bytesToHex(G2.multiply(7n).toBytes(true)),
  '2': bytesToHex(G2.multiply(13n).toBytes(true)),
};
const KEYSET_ID = deriveKeysetId(VEC1_KEYS, { versionByte: 2, unit: 'sat' });
// NUT-06 example identity (seed: UTF-8 of 'NUT-06 example mint seed'); scopes the 0x04 quote lock keys.
const MINT_IDENTITY = '0338596797cef0627f653cd6568387361b00314add55d9f1ea9c94f46ae421e3da';

const d = JSON.parse(readFileSync(PATH, 'utf8'));
const OLD_ID = d.nut13_v3.keyset_id;

// --- nut13_v3 ---------------------------------------------------------------
const seed = hexToBytes(d.nut13_v3.seed_hex);
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
d.nut13_v3.mint_identity = MINT_IDENTITY;
d.nut13_v3.quote_locks = [0, 1].map((counter) => {
  const privkey = deriveQuoteLockKey(seed, MINT_IDENTITY, counter);
  const idPreimage = deriveQuoteIdPreimage(seed, MINT_IDENTITY, counter);
  return {
    counter,
    privkey: bytesToHex(privkey),
    pubkey: bytesToHex(getPubKeyFromPrivKey(privkey)),
    id_preimage: bytesToHex(idPreimage),
    quote_id: derivedQuoteId(idPreimage),
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
      Y: hashToCurveHex(p.secret, p.keyset_id),
      C: p.C,
    })),
    mintQuoteInputs: tx.mint_quote_inputs?.map((q: any) => ({
      amount: BigInt(q.amount),
      quoteId: q.quote_id,
      lockKey: q.lock_pubkey,
      issued: BigInt(q.issued),
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

// The mint vector's quote is locked to NUT-13 quote lock 0, like the partial mint's.
d.transcript.mint.tx.mint_quote_inputs[0].lock_pubkey = d.nut13_v3.quote_locks[0].pubkey;
d.transcript.mint.tx.mint_quote_inputs[0].issued = 0;
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

// --- input digests -----------------------------------------------------------
const SecpPoint = secp256k1.Point;
const AUX0 = new Uint8Array(32);
const bigTo32 = (x: bigint) => hexToBytes(x.toString(16).padStart(64, '0'));

// Each transcript vector has exactly one input, and containers group in
// ascending type order, so the input container is the transcript's first record.
for (const name of ['swap', 'mint', 'melt', 'melt_with_change'] as const) {
  const example = d.transcript[name];
  const t = hexToBytes(example.transcript);
  const digestCheck = bytesToHex(sha256(t));
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
  'Transaction transcript (NUT-10). digest = SHA256(TLV stream). Each input signs tagged_hash("Cashu_TransactionInput", digest || SHA256(its own container record)) (BIP-340, aux = 32 zero bytes). Containers (high nibble is the section, 1 inputs, 2 outputs): 11 proof input (fields: 01 amount, 02 keyset id, 03 Y = hash_to_curve(secret) on the keyset curve, 04 C), 12 mint quote input (01 amount issued, 02 quote id utf8, 03 lock key), 21 blinded output (01 amount, 02 keyset id, 03 SHA256(B_)), 22 melt quote output (01 amount, 02 quote id utf8). Container types ascend; request order within a type; amounts minimal big-endian; points and keyset ids raw bytes.';

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
  for (let offset = 0; offset < transcript.length;) {
    const length = (transcript[offset + 1] << 8) | transcript[offset + 2];
    const record = transcript.subarray(offset, offset + 3 + length);
    if (record[0] === 0x11) containers.push(record);
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

// A NUT-29 batch mint is one transaction with every quote as an input. Two locked quotes
// pin the multi-quote-input case: each signs its own input digest with its quote lock key.
{
  const txVector = {
    mint_quote_inputs: [
      {
        amount: 5,
        quote_id: 'quote-mint-0002',
        lock_pubkey: d.nut13_v3.quote_locks[0].pubkey,
        issued: 0,
      },
      {
        amount: 3,
        quote_id: 'quote-mint-0003',
        lock_pubkey: d.nut13_v3.quote_locks[1].pubkey,
        issued: 0,
      },
    ],
    blinded_outputs: d.transcript.mint.tx.blinded_outputs,
  };
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const containers: Uint8Array[] = [];
  for (let offset = 0; offset < transcript.length;) {
    const length = (transcript[offset + 1] << 8) | transcript[offset + 2];
    const record = transcript.subarray(offset, offset + 3 + length);
    if (record[0] === 0x12) containers.push(record);
    offset += record.length;
  }
  if (containers.length !== 2) throw new Error('batch_mint: expected two quote containers');
  d.transcript.batch_mint = {
    tx: txVector,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    inputs: containers.map((container, index) => {
      const digestForInput = inputDigest(digest, container);
      const lock = d.nut13_v3.quote_locks[index];
      return {
        quote_id: txVector.mint_quote_inputs[index].quote_id,
        lock_pubkey: lock.pubkey,
        input_id: bytesToHex(sha256(container)),
        input_digest: bytesToHex(digestForInput),
        signature: bytesToHex(schnorr.sign(digestForInput, hexToBytes(lock.privkey), AUX0)),
      };
    }),
  };
}

// A partial mint: an 8-sat quote with 3 already issued, issuing 4. The quote input commits the 4
// this request issues and the 3 before it, so this vector tells amount, quote amount and issued apart.
{
  const txVector = {
    mint_quote_inputs: [
      {
        amount: 4,
        quote_id: 'quote-mint-0004',
        lock_pubkey: d.nut13_v3.quote_locks[0].pubkey,
        issued: 3,
      },
    ],
    blinded_outputs: [d.transcript.swap.tx.blinded_outputs[0]],
  };
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const container = transcript.subarray(0, 3 + ((transcript[1] << 8) | transcript[2]));
  if (container[0] !== 0x12) throw new Error('partial_mint: expected the quote container first');
  const digestForInput = inputDigest(digest, container);
  const lock = d.nut13_v3.quote_locks[0];
  d.transcript.partial_mint = {
    quote_amount: 8,
    tx: txVector,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    lock_pubkey: lock.pubkey,
    input_id: bytesToHex(sha256(container)),
    input_digest: bytesToHex(digestForInput),
    signature: bytesToHex(schnorr.sign(digestForInput, hexToBytes(lock.privkey), AUX0)),
  };
}

// Mixed keysets (NUT-10): a v3 input and a pre-v3 input in one transaction, each container
// carrying Y on its own keyset's curve. Only the v3 input signs; the pre-v3 one keeps its rules.
{
  const txVector = {
    proof_inputs: [
      { ...d.transcript.multi_input.tx.proof_inputs[0] },
      {
        amount: 2,
        keyset_id: '00456a94ab4e1c46',
        secret: 'd341ee4871f1f889041e63cf0d3823c713eea6aff01e80f1719f08f9e5be98f6',
        C: '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2',
      },
    ],
    blinded_outputs: [
      { ...d.transcript.swap.tx.blinded_outputs[0], amount: 8 },
      { ...d.transcript.swap.tx.blinded_outputs[0], amount: 2 },
    ],
  };
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const containers: Uint8Array[] = [];
  for (let offset = 0; offset < transcript.length;) {
    const record = transcript.subarray(
      offset,
      offset + 3 + ((transcript[offset + 1] << 8) | transcript[offset + 2]),
    );
    if (record[0] === 0x11) containers.push(record);
    offset += record.length;
  }
  if (containers.length !== 2) throw new Error('mixed_keysets: expected two proof containers');
  d.transcript.mixed_keysets = {
    tx: txVector,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    inputs: containers.map((container, index) => {
      const p = txVector.proof_inputs[index];
      const entry: Record<string, string> = {
        Y: hashToCurveHex(p.secret, p.keyset_id),
        container: bytesToHex(container),
        input_id: bytesToHex(sha256(container)),
      };
      if (index === 0) {
        const digestForInput = inputDigest(digest, container);
        entry.input_digest = bytesToHex(digestForInput);
        entry.signature = bytesToHex(
          schnorr.sign(digestForInput, hexToBytes(d.nut13_v3.outputs[0].secret_key), AUX0),
        );
      }
      return entry;
    }),
  };
}

// 0xff is never allocated, so this vector survives new leaf types.
delete d.two_leaf_covenant;
d.leaf_forms.leaf_unknown_type = '00ff' + d.leaf_forms.threshold_1of1.slice(4);

// Commit leaf (NUT-10): NUMS offset u = 7 over threshold_1of1 (key 3) and a commit leaf whose hash
// is SHA256("external data"). Key 3 spends through the threshold leaf; the commit leaf never spends.
const U7 = bigTo32(7n);
const commitHash = bytesToHex(sha256(utf8ToBytes('external data')));
{
  const leaves: NutrootLeaf[] = [
    parseNutrootLeafHex(d.leaf_forms.threshold_1of1),
    { type: 'commit', hash: commitHash },
  ];
  const built = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves, { u: U7 });
  const [leafThreshold, leafCommit] = built.tree!;
  const hashes = [leafThreshold, leafCommit].map((l) =>
    taggedHash('Cashu_NutrootLeaf', hexToBytes(l)),
  );
  const root = taggedHash('Cashu_NutrootBranch', ...[...hashes].sort(Buffer.compare));
  const tweak = taggedHash('Cashu_NutrootTweak', hexToBytes(built.K!), root);
  d.commit_leaf = {
    comment:
      'NUT-10 commit leaf (type 0x04): NUMS offset u = 7 over threshold_1of1 (key 3) and a commit leaf of SHA256("external data"). Key 3 spends through the threshold leaf with path [leaf_hash_commit]; a witness revealing the commit leaf is rejected.',
    u: bytesToHex(U7),
    K: built.K,
    hash: commitHash,
    leaf_threshold: leafThreshold,
    leaf_commit: leafCommit,
    leaf_hash_threshold: bytesToHex(hashes[0]),
    leaf_hash_commit: bytesToHex(hashes[1]),
    merkle_root: bytesToHex(root),
    tweak: bytesToHex(bigTo32(BigInt('0x' + bytesToHex(tweak)) % SECP256K1_N)),
    secret: built.secret,
  };
  d.leaf_forms.leaf_commit_with_n = '0004' + '02000101' + leafCommit.slice(4);
}

// Signing package (NUT-XX): the mint vector with its quote locked to a script-only key, NUMS
// offset u = 7 with threshold_1of1 (key 3), so the quote input spends through that leaf.
{
  const leaf = d.leaf_forms.threshold_1of1;
  const built = buildNutrootSecret(NUTROOT_NUMS_KEY, [parseNutrootLeafHex(leaf)], { u: U7 });
  const tx = structuredClone(d.transcript.mint.tx);
  tx.mint_quote_inputs[0].lock_pubkey = built.secret;
  const shape = fromVectorTx(tx);
  const transcript = buildTransactionTranscript(shape);
  const digest = transactionDigest(shape);
  const container = transcript.subarray(0, 3 + ((transcript[1] << 8) | transcript[2]));
  const digestIn = inputDigest(digest, container);
  const pkg: ScriptPathSigningPackage = {
    version: 'nutspA',
    transcript: bytesToHex(transcript),
    spends: [
      {
        input: 0,
        secret: built.secret,
        leaf,
        control: { K: built.K!, path: [] },
        signatures: [],
      },
    ],
  };
  // The library signs with fresh aux randomness, so pin the AUX0 signature after checking it.
  const sig = bytesToHex(schnorr.sign(digestIn, bigTo32(3n), AUX0));
  const byLibrary = ScriptPath.signPackage(pkg, bytesToHex(bigTo32(3n)));
  const key3 = secp256k1.getPublicKey(bigTo32(3n), true).subarray(1);
  if (!schnorr.verify(hexToBytes(byLibrary.spends[0].signatures[0]), digestIn, key3)) {
    throw new Error('signPackage signature does not verify over the quote input digest');
  }
  const signed = { ...pkg, spends: [{ ...pkg.spends[0], signatures: [sig] }] };
  d.signing_package = {
    comment:
      'NUT-XX signing package: the mint vector with its quote locked to a script-only key (NUMS offset u = 7, threshold_1of1 key 3). Strings are the prefix plus base64url of the JSON.',
    lock_key: built.secret,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    input_id: bytesToHex(sha256(container)),
    input_digest: bytesToHex(digestIn),
    package: pkg,
    package_string: ScriptPath.serializePackage(pkg),
    signed_string: ScriptPath.serializePackage(signed),
    witness: { leaf, control: { K: built.K!, path: [] }, signatures: [sig] },
  };
  for (const str of [d.signing_package.package_string, d.signing_package.signed_string]) {
    ScriptPath.deserializePackage(str);
  }
}
for (const k of [
  'threshold_1of1_disclosure',
  'leaf_disclosure_mode0',
  'leaf_disclosure_empty',
  'leaf_disclosure_mode2',
]) {
  delete d.leaf_forms[k];
}
delete d.auditable_lock;
delete d.nut07_commitments;
delete d.transport_strings;

writeFileSync(PATH, JSON.stringify(d, null, 2) + '\n');
console.log(
  `written ${PATH} (keyset id ${OLD_ID === KEYSET_ID ? 'unchanged' : `${OLD_ID} -> ${KEYSET_ID}`})`,
);
if (OLD_ID !== KEYSET_ID) {
  console.warn(
    'keyset id changed: regenerate token_nutshell strings with nutshell and sync both copies',
  );
}
