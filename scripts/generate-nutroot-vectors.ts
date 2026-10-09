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
import { deriveLeafKey, deriveNumsOffset, deriveQuoteLockKey } from '../src/crypto/NUT13';
import { BLS_FR_ORDER, hashToCurveBls } from '../src/crypto/curve_bls';
import { hashToCurveHex } from '../src/crypto/curves';
import {
  buildTransactionTranscript,
  changeQuoteId,
  inputDigest,
  outputSection,
  spendCommitment,
  transactionDigest,
  transcriptContainers,
} from '../src/crypto/transcript';
import type { TransactionElements } from '../src/crypto/transcript';
import { Amount } from '../src/model/Amount';
import { decodeCBOR, encodeCBOR } from '../src/utils/cbor';
import {
  buildNutrootSecret,
  nutrootMerklePath,
  nutrootMerkleRoot,
  parseNutrootLeafHex,
  serializeNutrootLeaf,
  type NutrootLeaf,
  NUTROOT_NUMS_KEY,
} from '../src/crypto/nutroot';
import { ScriptPath, type ScriptPathSigningPackage } from '../src/model/ScriptPath';
import { deriveKeysetId, encodeSpendReceipt, getEncodedToken } from '../src/utils/core';
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
function fromVectorTx(tx: any): TransactionElements {
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
    changeQuoteOutputs: tx.change_quote_outputs?.map((c: any) => ({
      pubkey: c.pubkey,
      ...(c.amount !== undefined && { amount: BigInt(c.amount) }),
    })),
  };
}

// The mint vector's quote is locked to NUT-13 quote lock 0, like the partial mint's.
d.transcript.mint.tx.mint_quote_inputs[0].lock_pubkey = d.nut13_v3.quote_locks[0].pubkey;
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
  'Transaction transcript (NUT-10). digest = SHA256(TLV stream). Each input signs tagged_hash("Cashu_TransactionInput", digest || SHA256(its own container record)) (BIP-340, aux = 32 zero bytes). Containers (high nibble is the section, 1 inputs, 2 outputs): 11 proof input (fields: 01 amount, 02 keyset id, 03 Y = hash_to_curve(secret) on the keyset curve, 04 C), 12 mint quote input (01 amount issued, 02 quote id utf8, 03 lock key), 21 blinded output (01 amount, 02 keyset id, 03 B_), 22 melt quote output (01 amount, 02 quote id utf8), 23 change quote output (01 amount, absent on the remainder quote, 02 lock key). Container types ascend; request order within a type; amounts minimal big-endian; points and keyset ids raw bytes.';

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
      { amount: 5, quote_id: 'quote-mint-0002', lock_pubkey: d.nut13_v3.quote_locks[0].pubkey },
      { amount: 3, quote_id: 'quote-mint-0003', lock_pubkey: d.nut13_v3.quote_locks[1].pubkey },
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

// A partial mint: an 8-sat quote issued for 4. The quote input commits the 4 issued, not the
// quote amount, so this is the vector that tells the two readings apart.
{
  const txVector = {
    mint_quote_inputs: [
      { amount: 4, quote_id: 'quote-mint-0004', lock_pubkey: d.nut13_v3.quote_locks[0].pubkey },
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

// NUT-XX transactions: a mint quote paying a melt directly, and a proof parked in a change quote
// locked to test key 5. Each has one input, so its container is the transcript's first record.
const testKey = (k: number) =>
  bytesToHex(secp256k1.getPublicKey(hexToBytes(k.toString(16).padStart(64, '0')), true));
for (const [name, txVector] of [
  [
    'mint_quote_to_melt',
    {
      mint_quote_inputs: d.transcript.mint.tx.mint_quote_inputs,
      melt_quote_outputs: d.transcript.melt.tx.melt_quote_outputs,
    },
  ],
  [
    'proof_to_change',
    {
      proof_inputs: d.transcript.swap.tx.proof_inputs,
      change_quote_outputs: [{ pubkey: testKey(5) }],
    },
  ],
  [
    'proof_to_two_changes',
    {
      proof_inputs: d.transcript.swap.tx.proof_inputs,
      change_quote_outputs: [{ pubkey: testKey(5), amount: 3 }, { pubkey: testKey(6) }],
    },
  ],
] as const) {
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const container = transcript.subarray(0, 3 + ((transcript[1] << 8) | transcript[2]));
  const rest = transcript.subarray(container.length);
  const changes = tx.changeQuoteOutputs ?? [];
  const last =
    changes.length === 0
      ? {}
      : changes.length === 1
        ? { change_container: bytesToHex(rest), quote_id: changeQuoteId(changes[0].pubkey) }
        : {
            change_containers: transcriptContainers(rest).map((c) => bytesToHex(c)),
            quote_ids: changes.map((c) => changeQuoteId(c.pubkey)),
          };
  d.transcript[name] = {
    tx: txVector,
    ...last,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    input_id: bytesToHex(sha256(container)),
    input_digest: bytesToHex(inputDigest(digest, container)),
  };
}
if (d.transcript.mint_quote_to_melt.input_id !== d.transcript.mint.input_id)
  throw new Error('mint_quote_to_melt reuses the mint quote input, so its input id must match');
if (d.transcript.proof_to_change.input_id !== d.transcript.swap.input_id)
  throw new Error('proof_to_change spends the swap proof, so its input id must match');

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

// Template leaf (NUT-10): hash = SHA256 over the output section, here the two change quote
// containers of proof_to_two_changes. A spend through it is the swap proof (same amount, keyset
// and C) under a new secret, spent into exactly those outputs. The rejection case bumps the fixed
// quote from 3 to 4 sat: one byte of the output section, a different hash.
const tplOutputs = {
  change_quote_outputs: d.transcript.proof_to_two_changes.tx.change_quote_outputs,
};
const tplHashOf = (o: any) => bytesToHex(sha256(outputSection(fromVectorTx(o))));
const tplHash = tplHashOf(tplOutputs);
const tplLeaf = serializeNutrootLeaf({
  type: 'template',
  n: 1,
  keys: [testKey(3)],
  time: d.two_leaf_covenant.vest_time,
  hash: tplHash,
});
const tplRejected = {
  change_quote_outputs: [
    { ...tplOutputs.change_quote_outputs[0], amount: 4 },
    tplOutputs.change_quote_outputs[1],
  ],
};
// Spend leaf `index` of `tree` under internal key `K` into tplOutputs, signed by test key 3.
function spendTemplate(K: Uint8Array, tree: Uint8Array[], index: number) {
  const hashes = tree.map((leaf) => taggedHash('Cashu_NutrootLeaf', leaf));
  const root = nutrootMerkleRoot(hashes);
  const tweak = BigInt('0x' + bytesToHex(taggedHash('Cashu_NutrootTweak', K, root))) % N_SECP;
  const secret = SecpPoint.fromBytes(K).add(SecpPoint.BASE.multiply(tweak)).toBytes(true);
  const txVector = {
    proof_inputs: [{ ...d.transcript.swap.tx.proof_inputs[0], secret: bytesToHex(secret) }],
    ...tplOutputs,
  };
  const tx = fromVectorTx(txVector);
  const transcript = buildTransactionTranscript(tx);
  const digest = transactionDigest(tx);
  const container = transcript.subarray(0, 3 + ((transcript[1] << 8) | transcript[2]));
  const digestForInput = inputDigest(digest, container);
  return {
    merkle_root: bytesToHex(root),
    tweak: bytesToHex(bigTo32(tweak)),
    secret: bytesToHex(secret),
    Y: hashToCurveBls(secret).toHex(true),
    tx: txVector,
    transcript: bytesToHex(transcript),
    digest: bytesToHex(digest),
    input_id: bytesToHex(sha256(container)),
    input_digest: bytesToHex(digestForInput),
    witness: JSON.stringify({
      leaf: bytesToHex(tree[index]),
      control: { K: bytesToHex(K), path: nutrootMerklePath(hashes, index).map(bytesToHex) },
      signatures: [bytesToHex(schnorr.sign(digestForInput, bigTo32(3n), AUX0))],
    }),
  };
}
d.template_lock = {
  comment:
    'Template covenant: NUMS offset u = 7, one template leaf n = 1 to test key 3 whose hash is SHA256 over the output section (the two change quote containers of proof_to_two_changes), spent into exactly those outputs. rejected_outputs is the same transaction with the fixed quote at 4 sat: its output section hashes differently, so the witness is rejected.',
  u: bytesToHex(bigTo32(7n)),
  K: bytesToHex(K_aud),
  output_section: bytesToHex(outputSection(fromVectorTx(tplOutputs))),
  hash: tplHash,
  leaf: bytesToHex(tplLeaf),
  ...spendTemplate(K_aud, [tplLeaf], 0),
  rejected_outputs: {
    change_quote_outputs: tplRejected.change_quote_outputs,
    output_section: bytesToHex(outputSection(fromVectorTx(tplRejected))),
    hash: tplHashOf(tplRejected),
  },
};

// Two leaves and a filled path: the template leaf beside an after leaf (key 3, vest_time) under
// internal key 6, the parent's. The kid spends through the template until vesting, then freely.
{
  const K6 = hexToBytes(testKey(6));
  const afterLeaf = hexToBytes(d.two_leaf_covenant.leaf_after);
  const spend = spendTemplate(K6, [tplLeaf, afterLeaf], 0);
  const witness = JSON.parse(spend.witness);
  d.two_leaf_covenant = {
    comment:
      'Allowance covenant: until vesting the kid (key 3) can only spend into the template outputs (3 sat to key 5, remainder to key 6); after vest_time the after leaf lets the kid spend freely; the parent (key 6) holds the key path. Two leaves, one branch: template_witness reveals leaf 0 with path [leaf_hash_after], the after path is [leaf_hash_template].',
    kid_priv: bytesToHex(bigTo32(3n)),
    kid_pub: testKey(3),
    parent_priv: bytesToHex(bigTo32(6n)),
    internal_key: testKey(6),
    vest_time: d.two_leaf_covenant.vest_time,
    leaf_template: bytesToHex(tplLeaf),
    leaf_after: bytesToHex(afterLeaf),
    leaf_hash_template: bytesToHex(taggedHash('Cashu_NutrootLeaf', tplLeaf)),
    leaf_hash_after: bytesToHex(taggedHash('Cashu_NutrootLeaf', afterLeaf)),
    merkle_root: spend.merkle_root,
    tweak: spend.tweak,
    secret: spend.secret,
    Y: spend.Y,
    tx: spend.tx,
    transcript: spend.transcript,
    digest: spend.digest,
    input_id: spend.input_id,
    input_digest: spend.input_digest,
    template_witness: witness,
    after_witness_path: [bytesToHex(taggedHash('Cashu_NutrootLeaf', tplLeaf))],
  };
}
// An unallocated leaf type (0xff, the threshold leaf's bytes under that type) fails closed; far from the allocated range so new types never move it.
d.leaf_forms.leaf_unknown_type = '00ff' + d.leaf_forms.threshold_1of1.slice(4);

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

// NUT-10 transport strings, through the library's own encoders so the spec copies cannot drift.
// The signed package carries the AUX0 signature: signPackage uses fresh aux randomness.
const audPackage: ScriptPathSigningPackage = {
  version: 'nutspA',
  transcript: bytesToHex(audTranscript),
  spends: [
    {
      input: 0,
      secret: bytesToHex(audSecret),
      leaf: d.leaf_forms.threshold_1of1_disclosure,
      control: { K: bytesToHex(K_aud), path: [] },
      signatures: [],
    },
  ],
};
const audSignedByLibrary = ScriptPath.signPackage(audPackage, bytesToHex(bigTo32(3n)));
if (
  !schnorr.verify(
    hexToBytes(audSignedByLibrary.spends[0].signatures[0]),
    audInputDigest,
    hexToBytes(d.auditable_lock.P).subarray(1),
  )
) {
  throw new Error('signPackage signature does not verify over the auditable lock input digest');
}
const audSigned = { ...audPackage, spends: [{ ...audPackage.spends[0], signatures: [audSig] }] };
d.transport_strings = {
  comment:
    'Prefix plus base64url of the JSON. The signing package is the auditable lock spent in the pinned swap; the spend receipt is the swap bearer input.',
  signing_package: ScriptPath.serializePackage(audPackage),
  signing_package_signed: ScriptPath.serializePackage(audSigned),
  spend_receipt: encodeSpendReceipt({
    token: d.tokens_v4.shapes.bearer_k.token_cashu_ts,
    receipts: [
      {
        Y: d.nut13_v3.outputs[0].Y,
        keysetId: d.transcript.swap.tx.proof_inputs[0].keyset_id,
        inputDigest: d.transcript.swap.input_digest,
        witness: swapWitness,
        commitment: d.nut07_commitments.keypath_private.commitment,
        transcript: d.transcript.swap.transcript,
      },
    ],
  }),
};
for (const s of [d.transport_strings.signing_package, d.transport_strings.signing_package_signed]) {
  ScriptPath.deserializePackage(s);
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
