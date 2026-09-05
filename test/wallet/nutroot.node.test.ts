import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test, vi } from 'vitest';

import { hashToCurveBls } from '../../src/crypto/curve_bls';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import {
  buildNutrootSecret,
  deriveReceiverKeyedSecret,
  nutrootTweakPubkey,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
import {
  inputDigest,
  proofInputContextKey,
  spendCommitment,
  transactionInputs,
  verifyTransactionInputWitness,
} from '../../src/crypto/transcript';
import { NULL_LOGGER } from '../../src/logger';
import { Amount } from '../../src/model/Amount';
import type { Proof, SerializedBlindedMessage } from '../../src/model/types';
import {
  bytesToHex,
  bytesToUtf8,
  decodeSpendReceipt,
  encodeSpendReceipt,
  encodeUint8ToBase64Url,
  hexToBytes,
  verifySpendReceipt,
} from '../../src/utils';
import {
  attachTransactionWitnesses,
  collectSpendInfoKeys,
  prepareScriptPathSpends,
  type NutrootWalletState,
} from '../../src/wallet/nutroot';
import type { CosignRequest } from '../../src/wallet/types';
import vectors from '../vectors/nutroot-v3.json';

const KEYSET = vectors.nut13_v3.keyset_id; // a BLS (v3) keyset id

// Deterministic key material, independent of any seed derivation.
const PRIV_A = '11'.repeat(32);
const PRIV_B = '22'.repeat(32);
const PUB_A = bytesToHex(getPubKeyFromPrivKey(hexToBytes(PRIV_A)));
const PUB_B = bytesToHex(getPubKeyFromPrivKey(hexToBytes(PRIV_B)));

function makeState(seed?: Uint8Array): NutrootWalletState {
  return {
    seed,
    counters: { peekNext: vi.fn().mockResolvedValue(0) },
    logger: NULL_LOGGER,
  };
}

function v3Proof(secret: string, spend_info?: Proof['spend_info']): Proof {
  return {
    id: KEYSET,
    amount: Amount.from(1),
    secret,
    C: 'aa'.repeat(48),
    ...(spend_info && { spend_info }),
  };
}

const OUTPUT: SerializedBlindedMessage = {
  amount: Amount.from(1),
  id: KEYSET,
  B_: 'bb'.repeat(48),
};

// The input digest of `inputs[0]` (or `ofSecret`) in the transaction over these inputs: each
// input signs its own message now (NUT-10), so tests verify against the input's digest.
function digestOf(
  inputs: Proof[],
  meltQuote?: { quoteId: string; amount: Amount },
  ofSecret?: string,
): Uint8Array {
  const proof = inputs.find((input) => input.secret === (ofSecret ?? inputs[0].secret))!;
  return transactionInputsOf(inputs, meltQuote).proofs.get(
    proofInputContextKey({ keysetId: proof.id, secret: proof.secret }),
  )!.digest;
}

function transactionInputsOf(inputs: Proof[], meltQuote?: { quoteId: string; amount: Amount }) {
  return transactionInputs({
    proofInputs: inputs.map((p) => ({
      amount: Amount.from(p.amount).toBigInt(),
      keysetId: p.id,
      secret: p.secret,
      C: p.C,
    })),
    blindedOutputs: [{ amount: OUTPUT.amount.toBigInt(), keysetId: OUTPUT.id, B_: OUTPUT.B_ }],
    meltQuoteOutputs: meltQuote
      ? [{ amount: meltQuote.amount.toBigInt(), quoteId: meltQuote.quoteId }]
      : undefined,
  });
}

/* --------------------------
 * collectSpendInfoKeys
 * -------------------------- */

describe('collectSpendInfoKeys', () => {
  test('bare bearer key: accepted when k*G is the secret, rejected otherwise', () => {
    const good = v3Proof(PUB_A, { k: PRIV_A });
    // A valid scalar that reconstructs neither the bare secret nor any tweak of it.
    const wrong = v3Proof(PUB_A, { k: PRIV_B });
    const keys = collectSpendInfoKeys([good, wrong], undefined, NULL_LOGGER);
    expect(bytesToHex(keys.get(PUB_A)!)).toBe(PRIV_A);
    expect(keys.size).toBe(1);
  });

  test('locked proof: recovers the tweaked key p` = k + t over the disclosed tree', () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [PUB_B] }];
    const { secret, tree } = buildNutrootSecret(PUB_A, leaves);
    const proof = v3Proof(secret, { k: PRIV_A, tree });
    const keys = collectSpendInfoKeys([proof], undefined, NULL_LOGGER);
    const recovered = keys.get(secret);
    // What the mint verifies: the key path signature must be by the secret itself.
    expect(recovered).toBeDefined();
    expect(bytesToHex(getPubKeyFromPrivKey(recovered!))).toBe(secret);
  });

  test('empty tweak: recovers p` = k + tagged_hash(K) when no tree is disclosed', () => {
    const secret = bytesToHex(nutrootTweakPubkey(hexToBytes(PUB_A)));
    const proof = v3Proof(secret, { k: PRIV_A });
    const keys = collectSpendInfoKeys([proof], undefined, NULL_LOGGER);
    expect(bytesToHex(getPubKeyFromPrivKey(keys.get(secret)!))).toBe(secret);
  });

  test('refuses spend info carrying both k and E', () => {
    const proof = v3Proof(PUB_A, { k: PRIV_A, E: PUB_B });
    expect(() => collectSpendInfoKeys([proof], undefined, NULL_LOGGER)).toThrow(/both k and E/);
  });

  test('receiver-keyed E: trial-match recovers the key for bare and tweaked secrets', () => {
    const bare = deriveReceiverKeyedSecret(PUB_A);
    const bareProof = v3Proof(bare.secret, { E: bare.E });
    const locked = deriveReceiverKeyedSecret(PUB_A, {
      leaves: [{ type: 'threshold', n: 1, keys: [PUB_B] }],
    });
    const lockedProof = v3Proof(locked.secret, { E: locked.E, tree: locked.tree });
    const keys = collectSpendInfoKeys([bareProof, lockedProof], PRIV_A, NULL_LOGGER);
    expect(bytesToHex(getPubKeyFromPrivKey(keys.get(bare.secret)!))).toBe(bare.secret);
    expect(bytesToHex(getPubKeyFromPrivKey(keys.get(locked.secret)!))).toBe(locked.secret);
    // The wrong static key matches nothing.
    const misses = collectSpendInfoKeys([bareProof, lockedProof], PRIV_B, NULL_LOGGER);
    expect(misses.size).toBe(0);
  });

  test('malformed, out-of-curve and non-reconstructing bearer keys are skipped, not thrown', () => {
    const shortK = v3Proof(PUB_A, { k: 'abcd' });
    const overOrder = v3Proof(PUB_B, { k: 'ff'.repeat(32) });
    // A valid scalar whose tweak over the disclosed tree lands elsewhere.
    const { secret, tree } = buildNutrootSecret(PUB_A, [
      { type: 'threshold', n: 1, keys: [PUB_B] },
    ]);
    const wrongTreeKey = v3Proof(secret, { k: PRIV_B, tree });
    const keys = collectSpendInfoKeys([shortK, overOrder, wrongTreeKey], undefined, NULL_LOGGER);
    expect(keys.size).toBe(0);
  });
});

/* --------------------------
 * prepareScriptPathSpends
 * -------------------------- */

describe('prepareScriptPathSpends', () => {
  const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [PUB_B] }];
  const built = buildNutrootSecret(PUB_A, leaves);
  const lockedProof = () => v3Proof(built.secret, { k: PRIV_A, tree: built.tree });

  test('resolves a plan: internal key from the bearer scalar, keys deduped lowercase', () => {
    const plan = { secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B.toUpperCase(), PRIV_B] };
    const out = prepareScriptPathSpends([lockedProof()], [plan], []);
    const spend = out.get(built.secret)!;
    expect(spend.K).toBe(PUB_A); // k*G, the control block's internal key
    expect(spend.keys).toEqual([PRIV_B]);
    expect(spend.leaf.type).toBe('threshold');
    expect(spend.tree).toEqual(built.tree);
  });

  test('takes the internal key from explicit spend_info.K when no scalar is present', () => {
    const proof = v3Proof(built.secret, { K: PUB_A.toUpperCase(), tree: built.tree });
    const out = prepareScriptPathSpends(
      [proof],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
      [],
    );
    expect(out.get(built.secret)!.K).toBe(PUB_A);
  });

  test('recovers the internal key and leaf keys from a receiver-keyed proof', () => {
    const keyed = deriveReceiverKeyedSecret(PUB_A, { leaves });
    const proof = v3Proof(keyed.secret, { E: keyed.E, tree: keyed.tree, K: keyed.K });
    const out = prepareScriptPathSpends(
      [proof],
      [{ secret: keyed.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
      [PRIV_A],
    );
    expect(out.get(keyed.secret)!.K).toBe(keyed.K);
  });

  test('a hashlock plan requires its preimage and carries it through', () => {
    const preimage = '11'.repeat(32);
    const hash = bytesToHex(sha256(hexToBytes(preimage)));
    const hashLeaves: NutrootLeaf[] = [{ type: 'hashlock', n: 1, keys: [PUB_B], hash }];
    const b = buildNutrootSecret(PUB_A, hashLeaves);
    const proof = v3Proof(b.secret, { k: PRIV_A, tree: b.tree });
    expect(() =>
      prepareScriptPathSpends(
        [proof],
        [{ secret: b.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
        [],
      ),
    ).toThrow(/preimage/);
    const out = prepareScriptPathSpends(
      [proof],
      [{ secret: b.secret, leafIndex: 0, preimage, extraKeys: [PRIV_B] }],
      [],
    );
    expect(out.get(b.secret)!.preimage).toBe(preimage);
  });

  test('rejects unresolvable plans before any request is built', () => {
    const proof = lockedProof();
    const plan = { secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] };
    expect(() => prepareScriptPathSpends([proof], [{ ...plan, secret: PUB_B }], [])).toThrow(
      /not in this transaction/,
    );
    expect(() => prepareScriptPathSpends([proof], [plan, plan], [])).toThrow(/twice/);
    expect(() => prepareScriptPathSpends([proof], [{ ...plan, leafIndex: 1 }], [])).toThrow(
      /not disclosed/,
    );
    expect(() => prepareScriptPathSpends([proof], [{ ...plan, leafIndex: -1 }], [])).toThrow(
      /not disclosed/,
    );
    const bare = v3Proof(PUB_A, { k: PRIV_A }); // no tree at all
    expect(() =>
      prepareScriptPathSpends([bare], [{ secret: PUB_A, leafIndex: 0, extraKeys: [PRIV_B] }], []),
    ).toThrow(/not disclosed/);
    const keyless = v3Proof(built.secret, { tree: built.tree });
    expect(() =>
      prepareScriptPathSpends(
        [keyless],
        [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
        [],
      ),
    ).toThrow(/internal key/);
    expect(() =>
      prepareScriptPathSpends([proof], [{ secret: built.secret, leafIndex: 0 }], []),
    ).toThrow(/1 signatures, 0 keys/);
  });

  test('recovers a verbatim leaf key from the privkeys held, no extraKeys needed', () => {
    const out = prepareScriptPathSpends(
      [lockedProof()],
      [{ secret: built.secret, leafIndex: 0 }],
      [PRIV_B],
    );
    expect(out.get(built.secret)!.keys).toEqual([PRIV_B]);
  });

  test('an undecodable key source falls through, and no source at all fails loudly', () => {
    // An out-of-curve bearer scalar yields no internal key.
    const badScalar = v3Proof(built.secret, { k: 'ff'.repeat(32), tree: built.tree });
    expect(() =>
      prepareScriptPathSpends(
        [badScalar],
        [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
        [],
      ),
    ).toThrow(/internal key/);
    // An undecodable explicit K likewise.
    const badPoint = v3Proof(built.secret, { K: `02${'00'.repeat(32)}`, tree: built.tree });
    expect(() =>
      prepareScriptPathSpends(
        [badPoint],
        [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
        [],
      ),
    ).toThrow(/internal key/);
    // A malformed k falls through to the explicit K beside it.
    const fallback = v3Proof(built.secret, { k: 'not-hex', K: PUB_A, tree: built.tree });
    const out = prepareScriptPathSpends(
      [fallback],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
      [],
    );
    expect(out.get(built.secret)!.K).toBe(PUB_A);
  });

  test('a cosigner defers the key count to signing time', () => {
    const twoOfTwo: NutrootLeaf[] = [{ type: 'threshold', n: 2, keys: [PUB_A, PUB_B] }];
    const b = buildNutrootSecret(PUB_A, twoOfTwo);
    const proof = v3Proof(b.secret, { k: PRIV_A, tree: b.tree });
    const cosign = async () => ['00'.repeat(64)];
    const out = prepareScriptPathSpends(
      [proof],
      [{ secret: b.secret, leafIndex: 0, extraKeys: [PRIV_B], cosign }],
      [],
    );
    expect(out.get(b.secret)!.cosign).toBe(cosign);
  });
});

/* --------------------------
 * attachTransactionWitnesses
 * -------------------------- */

describe('attachTransactionWitnesses', () => {
  test('falls back to extraKeys, which carry the keys proofs hold in spend info', async () => {
    const fromExtra = v3Proof(PUB_A);
    // A random v3 output's key rides on the proof (spend_info.k), not in wallet state; callers
    // deliver it here through collectSpendInfoKeys, merged with any caller-held keys.
    const fromRandom = v3Proof(PUB_B, { k: PRIV_B });
    const state = makeState(undefined);
    const payload = { inputs: [fromExtra, fromRandom], outputs: [OUTPUT] };
    const extra = new Map([
      [PUB_A, hexToBytes(PRIV_A)],
      ...collectSpendInfoKeys([fromRandom], undefined, NULL_LOGGER),
    ]);
    await attachTransactionWitnesses(payload, undefined, extra, undefined, state);
    const inputs = [fromExtra, fromRandom];
    expect(
      verifyTransactionInputWitness(
        digestOf(inputs, undefined, fromExtra.secret),
        PUB_A,
        fromExtra.witness as string,
      ),
    ).toBe(true);
    expect(
      verifyTransactionInputWitness(
        digestOf(inputs, undefined, fromRandom.secret),
        PUB_B,
        fromRandom.witness as string,
      ),
    ).toBe(true);
  });

  test('returns a receipt per v3 input that opens the NUT-07 commitment', async () => {
    const legacy = { ...v3Proof(PUB_A), id: '00' + 'ab'.repeat(32), secret: 'plain', witness: 'w' };
    const input = v3Proof(PUB_B, { k: PRIV_B });
    const inputs = [legacy, input];
    const receipts = await attachTransactionWitnesses(
      { inputs, outputs: [OUTPUT] },
      undefined,
      collectSpendInfoKeys([input], undefined, NULL_LOGGER),
      undefined,
      makeState(undefined),
    );
    expect(receipts).toHaveLength(1); // the legacy input has no commitment to open
    const [r] = receipts;
    const enc = new TextEncoder();
    expect(r.Y).toBe(hashToCurveBls(enc.encode(input.secret)).toHex(true));
    expect(r.keysetId).toBe(input.id);
    expect(r.witness).toBe(input.witness);
    expect(r.inputDigest).toBe(bytesToHex(digestOf(inputs, undefined, input.secret)));
    expect(r.commitment).toBe(spendCommitment(r.Y, hexToBytes(r.inputDigest), r.witness));
    // A holder of the proof rebuilds the input digest from the transcript alone (NUT-07).
    const { container } = transactionInputsOf(inputs).proofs.get(
      proofInputContextKey({ keysetId: input.id, secret: input.secret }),
    )!;
    expect(bytesToHex(inputDigest(sha256(hexToBytes(r.transcript)), container))).toBe(
      r.inputDigest,
    );
    expect(verifyTransactionInputWitness(hexToBytes(r.inputDigest), PUB_B, r.witness)).toBe(true);
  });

  test('verifySpendReceipt checks a receipt against the proof, key path and script path', async () => {
    const keyPath = v3Proof(PUB_B, { k: PRIV_B });
    const tree = buildNutrootSecret(PUB_A, [{ type: 'threshold', n: 1, keys: [PUB_B] }]);
    const scriptPath = v3Proof(tree.secret, { k: PRIV_A, tree: tree.tree });
    const inputs = [keyPath, scriptPath];
    const [rKey, rScript] = await attachTransactionWitnesses(
      { inputs, outputs: [OUTPUT] },
      undefined,
      collectSpendInfoKeys([keyPath], undefined, NULL_LOGGER),
      prepareScriptPathSpends(
        [scriptPath],
        [{ secret: tree.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
        [],
      ),
      makeState(undefined),
    );
    expect(verifySpendReceipt(rKey, keyPath)).toEqual({
      proof: true,
      inputDigest: true,
      commitment: true,
      witness: true,
      path: 'key',
      ok: true,
    });
    expect(verifySpendReceipt(rScript, scriptPath)).toMatchObject({ path: 'script', ok: true });
    // Each claim fails on its own: another proof, a doctored transcript, a swapped witness.
    expect(verifySpendReceipt(rKey, scriptPath)).toMatchObject({ proof: false, witness: false });
    const doctored = {
      ...rKey,
      transcript: rKey.transcript.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
    };
    expect(verifySpendReceipt(doctored, keyPath)).toMatchObject({ inputDigest: false, ok: false });
    expect(verifySpendReceipt({ ...rKey, witness: rScript.witness }, keyPath)).toMatchObject({
      commitment: false,
      witness: false,
    });
    expect(verifySpendReceipt(rKey, { ...keyPath, id: '00' + 'ab'.repeat(32) }).ok).toBe(false);
    expect(verifySpendReceipt({ ...rKey, transcript: 'zz' }, keyPath).ok).toBe(false);
    expect(verifySpendReceipt({ ...rScript, witness: '{bad' }, scriptPath).witness).toBe(false);
    const unsigned = JSON.stringify({ ...JSON.parse(rScript.witness), signatures: undefined });
    expect(verifySpendReceipt({ ...rScript, witness: unsigned }, scriptPath).witness).toBe(false);
  });

  test('a receipt bundle round-trips through the nutrcA transport string', async () => {
    const input = v3Proof(PUB_B, { k: PRIV_B });
    const receipts = await attachTransactionWitnesses(
      { inputs: [input], outputs: [OUTPUT] },
      undefined,
      collectSpendInfoKeys([input], undefined, NULL_LOGGER),
      undefined,
      makeState(undefined),
    );
    const encoded = encodeSpendReceipt({ token: 'cashuBtest', receipts });
    expect(encoded.startsWith('nutrcA')).toBe(true);
    const decoded = decodeSpendReceipt(encoded);
    expect(decoded).toEqual({ token: 'cashuBtest', receipts });
    expect(verifySpendReceipt(decoded.receipts[0], input).ok).toBe(true);
    expect(() => decodeSpendReceipt('cashuBtest')).toThrow(/must start with/);
    expect(() => decodeSpendReceipt('nutrcA!!!')).toThrow(/parse/);
    const tamper = (mangle: (b: { token: string; receipts: unknown[] }) => unknown) =>
      'nutrcA' +
      encodeUint8ToBase64Url(
        utf8ToBytes(JSON.stringify(mangle({ token: 'cashuBtest', receipts: [...receipts] }))),
      );
    expect(() => decodeSpendReceipt(tamper((b) => ({ ...b, receipts: [] })))).toThrow(/Malformed/);
    expect(() =>
      decodeSpendReceipt(
        tamper((b) => ({ ...b, receipts: [{ ...receipts[0], commitment: 'zz' }] })),
      ),
    ).toThrow(/Malformed/);
    expect(() => decodeSpendReceipt(tamper((b) => ({ ...b, token: 1 })))).toThrow(/Malformed/);
  });

  test('verifySpendReceipt follows a hashlock leaf with a merkle path and its preimage', async () => {
    const preimage = 'cd'.repeat(32);
    const hash = bytesToHex(sha256(hexToBytes(preimage)));
    const tree = buildNutrootSecret(PUB_A, [
      { type: 'threshold', n: 1, keys: [PUB_A] },
      { type: 'hashlock', n: 1, hash, keys: [PUB_B] },
    ]);
    const proof = v3Proof(tree.secret, { k: PRIV_A, tree: tree.tree });
    const [r] = await attachTransactionWitnesses(
      { inputs: [proof], outputs: [OUTPUT] },
      undefined,
      undefined,
      prepareScriptPathSpends(
        [proof],
        [{ secret: tree.secret, leafIndex: 1, extraKeys: [PRIV_B], preimage }],
        [],
      ),
      makeState(undefined),
    );
    expect(verifySpendReceipt(r, proof)).toMatchObject({ path: 'script', ok: true });
    const w = JSON.parse(r.witness) as { preimage: string };
    const stripped = JSON.stringify({ ...w, preimage: undefined });
    expect(verifySpendReceipt({ ...r, witness: stripped }, proof).witness).toBe(false);
  });

  test('a melt quote is part of the signed transcript', async () => {
    const input = v3Proof(PUB_A);
    const meltQuote = { quoteId: 'q1', amount: Amount.from(5) };
    const extra = new Map([[PUB_A, hexToBytes(PRIV_A)]]);
    await attachTransactionWitnesses(
      { inputs: [input], outputs: [OUTPUT] },
      meltQuote,
      extra,
      undefined,
      makeState(undefined),
    );
    expect(
      verifyTransactionInputWitness(digestOf([input], meltQuote), PUB_A, input.witness as string),
    ).toBe(true);
    // Without the quote container the digest differs: the witness must not verify.
    expect(verifyTransactionInputWitness(digestOf([input]), PUB_A, input.witness as string)).toBe(
      false,
    );
  });

  test('an unsignable v3 input fails loudly instead of reaching the mint', async () => {
    const input = v3Proof(PUB_A); // no seed, no keys anywhere
    await expect(
      attachTransactionWitnesses(
        { inputs: [input], outputs: [OUTPUT] },
        undefined,
        undefined,
        undefined,
        makeState(undefined),
      ),
    ).rejects.toThrow(/No key to sign a v3 input/);
  });

  test('a pre-built witness is left alone', async () => {
    const input = v3Proof(PUB_A);
    input.witness = 'pre-built';
    await attachTransactionWitnesses(
      { inputs: [input], outputs: [OUTPUT] },
      undefined,
      new Map([[PUB_A, hexToBytes(PRIV_A)]]),
      undefined,
      makeState(undefined),
    );
    expect(input.witness).toBe('pre-built');
  });

  test('script path spend: the witness carries the leaf, control block and leaf signatures', async () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [PUB_B] }];
    const built = buildNutrootSecret(PUB_A, leaves);
    const input = v3Proof(built.secret, { k: PRIV_A, tree: built.tree });
    const spends = prepareScriptPathSpends(
      [input],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
      [],
    );
    const payload = { inputs: [input], outputs: [OUTPUT] };
    await attachTransactionWitnesses(payload, undefined, undefined, spends, makeState(undefined));
    const witness = JSON.parse(input.witness as string) as {
      leaf: string;
      control: { K: string; path: string[] };
      signatures: string[];
    };
    expect(witness.leaf).toBe(built.tree[0]);
    expect(witness.control.K).toBe(PUB_A);
    expect(witness.signatures).toHaveLength(1);
    // The signature is by the leaf key over this transaction's digest (NUT-10 script path).
    expect(
      schnorr.verify(
        hexToBytes(witness.signatures[0]),
        digestOf([input]),
        hexToBytes(PUB_B).subarray(1),
      ),
    ).toBe(true);
  });

  test('the cosigner is handed the tagged message the digest was hashed from', async () => {
    const built = buildNutrootSecret(PUB_A, [{ type: 'threshold', n: 2, keys: [PUB_A, PUB_B] }]);
    const input = v3Proof(built.secret, { k: PRIV_A, tree: built.tree });
    let seen: CosignRequest | undefined;
    const cosign = async (request: CosignRequest) => {
      seen = request;
      return [bytesToHex(schnorr.sign(request.digest, hexToBytes(PRIV_B)))];
    };
    const spends = prepareScriptPathSpends(
      [input],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_A], cosign }],
      [],
    );
    await attachTransactionWitnesses(
      { inputs: [input], outputs: [OUTPUT] },
      undefined,
      undefined,
      spends,
      makeState(undefined),
    );
    expect(seen!.leaf.keys).toEqual([PUB_A, PUB_B]);
    expect(bytesToUtf8(seen!.message.subarray(0, 20))).toBe('Cashu_Transaction_v1');
    // digest = tagged_hash(input tag, SHA256(message) || SHA256(container)): recomputable, so a
    // signer can refuse anything it cannot verify.
    expect(bytesToHex(inputDigest(sha256(seen!.message), seen!.container))).toBe(
      bytesToHex(seen!.digest),
    );
    expect(bytesToHex(seen!.digest)).toBe(bytesToHex(digestOf([input])));
  });

  test('cosigner signatures fill a threshold; invalid or duplicate extras are trimmed', async () => {
    const twoOfTwo: NutrootLeaf[] = [{ type: 'threshold', n: 2, keys: [PUB_A, PUB_B] }];
    const built = buildNutrootSecret(PUB_A, twoOfTwo);
    const makeInput = () => v3Proof(built.secret, { k: PRIV_A, tree: built.tree });

    const good = makeInput();
    const cosign = async ({ digest }: { digest: Uint8Array }) => [
      bytesToHex(schnorr.sign(digest, hexToBytes(PRIV_A))).toUpperCase(), // case-normalized
      '00'.repeat(64), // junk: trimmed, not forwarded
    ];
    const spends = prepareScriptPathSpends(
      [good],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B], cosign }],
      [],
    );
    await attachTransactionWitnesses(
      { inputs: [good], outputs: [OUTPUT] },
      undefined,
      undefined,
      spends,
      makeState(undefined),
    );
    const witness = JSON.parse(good.witness as string) as { signatures: string[] };
    // Bounded at the leaf's key count, one valid signature per key (NUT-10 anti-stuffing).
    expect(witness.signatures).toHaveLength(2);

    const short = makeInput();
    const badSpends = prepareScriptPathSpends(
      [short],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B], cosign: async () => [] }],
      [],
    );
    await expect(
      attachTransactionWitnesses(
        { inputs: [short], outputs: [OUTPUT] },
        undefined,
        undefined,
        badSpends,
        makeState(undefined),
      ),
    ).rejects.toThrow(/2 valid signatures, 1 produced/);
  });

  test('a script spend naming a secret outside the transaction fails', async () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [PUB_B] }];
    const built = buildNutrootSecret(PUB_A, leaves);
    const planned = v3Proof(built.secret, { k: PRIV_A, tree: built.tree });
    const spends = prepareScriptPathSpends(
      [planned],
      [{ secret: built.secret, leafIndex: 0, extraKeys: [PRIV_B] }],
      [],
    );
    const other = v3Proof(PUB_A);
    await expect(
      attachTransactionWitnesses(
        { inputs: [other], outputs: [OUTPUT] },
        undefined,
        new Map([[PUB_A, hexToBytes(PRIV_A)]]),
        spends,
        makeState(undefined),
      ),
    ).rejects.toThrow(/not in this transaction/);
  });
});
