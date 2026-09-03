import { assertV3PointSecret, isBlsKeyset, isV3PointSecret, schnorrSignDigest } from '../crypto';
import { hashToCurveBls } from '../crypto/curve_bls';
import {
  createRandomSecretKey,
  getPubKeyFromPrivKey,
  normalizeSecpPubkey,
} from '../crypto/curve_secp';
import { parseSecret } from '../crypto/NUT10';
import { maybeDeriveP2BKPrivateKeys, p2pkSpendLeaves } from '../crypto/NUT11';
import { deriveQuoteLockKey } from '../crypto/NUT13';
import {
  buildScriptPathWitness,
  parseNutrootLeaf,
  type NutrootLeaf,
  recoverLeafKeySecretKeys,
  recoverReceiverKeyedSecretKey,
  selectRequiredLeafSignatures,
  nutrootLeafHash,
  nutrootMerkleRoot,
  nutrootTweakSeckey,
} from '../crypto/nutroot';
import {
  inputsForPayload,
  proofInputContextKey,
  signTransactionInput,
  spendCommitment,
} from '../crypto/transcript';
import { type Logger, fail } from '../logger';
import { type Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { type MeltRequest } from '../model/types';
import type { Proof } from '../model/types/proof';
import { bytesToHex, hexToBytes } from '../utils';

import { QUOTE_COUNTER_KEY } from './CounterSource';
import type { ScriptPathPlan, SpendOption, SpendOptions, SpendReceipt } from './types';

/**
 * Wallet-side nutroot secrets logic: witness attachment, spend info key recovery, and script path
 * planning. Free functions over an explicit state slice, so Wallet stays orchestration.
 */

/**
 * The slice of wallet state the nutroot signing rules read.
 */
export type NutrootWalletState = {
  seed?: Uint8Array;
  counters: { peekNext(counterKey: string): Promise<number> };
  logger: Logger;
};

/**
 * One resolved script path spend, awaiting only its transaction input digest.
 */
export type ScriptPathSpend = {
  tree: string[];
  leafIndex: number;
  K: string;
  preimage?: string;
  keys: string[];
  leaf: NutrootLeaf;
  cosign?: ScriptPathPlan['cosign'];
};

/**
 * Attaches nutroot transaction witnesses to v3 point-secret inputs (NUT-10).
 *
 * @remarks
 * Builds the transcript from the request's own inputs and outputs, then signs its digest with each
 * input's spend-info key, delivered in `extraKeys`. Signing is per input, so a mixed transaction
 * signs its v3 inputs and leaves v0-v2 inputs to their own rules (NUT-10). Inputs whose key is not
 * recoverable are left unsigned and the mint rejects them.
 * @returns A spend receipt per v3 input: the opening of the NUT-07 commitment the mint will hold.
 */
export async function attachTransactionWitnesses(
  payload: Pick<MeltRequest, 'inputs' | 'outputs'>,
  meltQuote: { quoteId: string; amount: Amount } | undefined,
  extraKeys: Map<string, Uint8Array> | undefined,
  scriptSpends: Map<string, ScriptPathSpend> | undefined,
  state: NutrootWalletState,
): Promise<SpendReceipt[]> {
  const v3Inputs = payload.inputs.filter((p) => isBlsKeyset(p.id) && isV3PointSecret(p.secret));
  if (v3Inputs.length === 0) return [];
  // Each input signs its own input digest over the shared transcript (NUT-10).
  const { transactionMessage, proofs: inputContexts } = inputsForPayload({
    inputs: payload.inputs,
    outputs: payload.outputs ?? [],
    ...(meltQuote && { meltQuote }),
  });
  // Script path spends first: they name their own leaf, so they take precedence over the key
  // path even where both are available. Everything but the signature was settled before the
  // request was built; only the digest was missing, and now it is not.
  for (const [secret, spend] of scriptSpends ?? []) {
    const input = payload.inputs.find((p) => p.secret === secret && isBlsKeyset(p.id));
    if (!input) {
      fail('Script path plan names a secret not in this transaction', state.logger);
    }
    const { digest, inputContainer } = inputContexts.get(
      proofInputContextKey({ keysetId: input.id, secret: input.secret }),
    )!;
    const mine = spend.keys.map((k: string) => schnorrSignDigest(digest, k));
    // The co-signer sees the digest only now, which is why it is a hook and not a signature the
    // caller could have supplied up front: the digest covers the outputs, and those are only
    // fixed (and ordered) once the transaction is built.
    const theirs = spend.cosign
      ? await spend.cosign({
          digest,
          transactionMessage,
          inputContainer,
          leaf: spend.leaf,
        })
      : [];
    const signatures = selectRequiredLeafSignatures(spend.leaf, digest, [
      ...mine,
      ...theirs.map((sig: string) => sig.toLowerCase()),
    ]);
    input.witness = buildScriptPathWitness(
      spend.tree,
      spend.leafIndex,
      spend.K,
      signatures,
      spend.preimage,
    );
  }
  for (const input of v3Inputs) {
    if (input.witness) continue; // pre-built witness (e.g. script path): leave it alone
    const secretKey = extraKeys?.get(input.secret);
    const context = inputContexts.get(
      proofInputContextKey({ keysetId: input.id, secret: input.secret }),
    );
    if (secretKey && context) input.witness = signTransactionInput(context.digest, secretKey);
  }
  // Every v3 input signs (NUT-10), so an unsigned one is a request the mint will refuse.
  // Say which proof and why here, rather than letting it come back as a witness error naming
  // nothing: the cause is always a key this wallet does not hold.
  const unsigned = v3Inputs.find((p) => !p.witness);
  if (unsigned) {
    fail(
      'No key to sign a v3 input: its spend info holds neither a bearer key nor an ephemeral this wallet can derive from; a proof that lost its spend info is recovered with a NUT-09 restore',
      state.logger,
      { id: unsigned.id, amount: unsigned.amount.toString() },
    );
  }
  // The receipt is the spender's copy of what NUT-07 commits to: nothing here is secret to the
  // wallet, and nothing but the wallet ever holds all of it together.
  const transcript = bytesToHex(message);
  const enc = new TextEncoder();
  return v3Inputs.map((input) => {
    const { digest } = inputContexts.get(
      proofInputContextKey({ keysetId: input.id, secret: input.secret }),
    )!;
    const Y = hashToCurveBls(enc.encode(input.secret)).toHex(true);
    const witness = input.witness as string;
    return {
      Y,
      keysetId: input.id,
      inputDigest: bytesToHex(digest),
      witness,
      commitment: spendCommitment(Y, digest, witness),
      transcript,
    };
  });
}

/**
 * What a proof can be spent through; the full contract is documented on `Wallet.spendOptions`.
 */
export function proofSpendOptions(
  proof: Proof,
  opts: { privkeys?: string | string[]; now?: number } | undefined,
  state: NutrootWalletState,
): SpendOptions {
  const privkeys = opts?.privkeys === undefined ? [] : [opts.privkeys].flat();
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  if (!isBlsKeyset(proof.id)) return legacySpendOptions(proof, privkeys, now);
  assertV3PointSecret(proof.secret);

  // Key path: the spend-info key, bearer or receiver-keyed. Nothing scans the seed: every v3
  // output this wallet makes keeps its key in spend info, and a lost one is a NUT-09 restore.
  const keyPath = collectSpendInfoKeys([proof], privkeys, state.logger).has(proof.secret);

  const tree = proof.spend_info?.tree;
  if (!tree || tree.length === 0) return withVerdict(keyPath, []);

  // Parses every leaf, so an unknown one throws here rather than being reported as spendable.
  const leaves = tree.map((leaf) => parseNutrootLeaf(hexToBytes(leaf)));
  const hits = recoverLeafKeySecretKeys(tree, proof.spend_info?.E, privkeys);
  return withVerdict(keyPath, scriptOptions(leaves, hits, now));
}

/**
 * Spend options for a pre-v3 proof: an unlocked secret spends as it stands, a NUT-11 lock reads as
 * leaves, and an unknown NUT-10 kind throws.
 */
function legacySpendOptions(proof: Proof, privkeys: string[], now: number): SpendOptions {
  try {
    parseSecret(proof.secret);
  } catch {
    return withVerdict(true, []); // not a NUT-10 secret: a bearer proof anyone can spend
  }
  const leaves = p2pkSpendLeaves(proof.secret);
  // Held keys by x coordinate, so an x-only import matches either parity (NUT-11 signatures are
  // x-only). A P2BK proof's keys are blinded, so the held keys are their derivations (NUT-28).
  const blinded = proof.p2pk_e !== undefined;
  const scalars = blinded ? maybeDeriveP2BKPrivateKeys(privkeys, proof) : privkeys;
  const held = new Set(
    scalars.map((k) => bytesToHex(getPubKeyFromPrivKey(hexToBytes(k))).slice(2)),
  );
  const hits = leaves.flatMap((leaf, leafIndex) =>
    leaf.keys.flatMap((key, keyIndex) =>
      held.has(key.slice(2)) ? [{ leafIndex, keyIndex, blinded }] : [],
    ),
  );
  return withVerdict(false, scriptOptions(leaves, hits, now));
}

/**
 * Judges each leaf from the key hits against it, at `now`.
 */
function scriptOptions(
  leaves: NutrootLeaf[],
  hits: Array<{ leafIndex: number; keyIndex: number; blinded: boolean }>,
  now: number,
): SpendOption[] {
  return leaves.map((leaf, leafIndex) => {
    // One hit per leaf key slot: the same private key supplied twice is still one signer.
    const byKeyIndex = new Map(
      hits.filter((h) => h.leafIndex === leafIndex).map((h) => [h.keyIndex, h] as const),
    );
    const keys = [...byKeyIndex.values()]
      // Report the on-tree key, never the recovered scalar: this surface is for
      // planning and diagnostics, which apps log and store.
      .map(({ keyIndex, blinded }) => ({ keyIndex, pubkey: leaf.keys[keyIndex], blinded }));
    const option: SpendOption = { leafIndex, leaf, keys, satisfiable: false };
    if (leaf.type === 'after') option.availableAt = leaf.time;
    // Order matters: a locktime is absolute; then the key shortfall, which the leaf itself does
    // not show; a hashlock's preimage need is readable off leaf.type, so it reports last.
    if (leaf.type === 'after' && leaf.time !== undefined && now < leaf.time) {
      option.blockedBy = 'locktime';
    } else if (keys.length < leaf.n) {
      option.blockedBy = 'threshold';
    } else if (leaf.type === 'hashlock') {
      option.blockedBy = 'preimage';
    } else {
      option.satisfiable = true;
    }
    return option;
  });
}

/**
 * The one-line answer over the key path and every leaf; see `SpendOptions.blockedBy`.
 */
function withVerdict(keyPath: boolean, script: SpendOption[]): SpendOptions {
  if (keyPath || script.some((o) => o.satisfiable)) return { keyPath, script, spendable: true };
  const stuck = { keyPath, script, spendable: false };
  // A locktime counts only on a leaf this wallet otherwise covers: a stranger's refund leaf is
  // not "unlocks later".
  const waiting = script.filter((o) => o.blockedBy === 'locktime' && o.keys.length >= o.leaf.n);
  if (waiting.length) {
    const availableAt = Math.min(...waiting.map((o) => o.availableAt as number));
    return { ...stuck, blockedBy: 'locktime', availableAt };
  }
  if (script.some((o) => o.blockedBy === 'preimage')) return { ...stuck, blockedBy: 'preimage' };
  if (script.some((o) => o.keys.length > 0)) return { ...stuck, blockedBy: 'threshold' };
  return { ...stuck, blockedBy: 'not-keyed-to-you' };
}

/**
 * Resolves each script path plan against its input, ready for signing once the digest exists.
 *
 * @remarks
 * Runs on the original proofs, not the mint payload: `_prepareInputsForMint` strips spend_info, and
 * the tree and internal key live there. Everything except the signature is settled here, so a plan
 * that cannot be honoured fails before the request is built rather than at the mint.
 */
export function prepareScriptPathSpends(
  inputs: Proof[],
  plans: ScriptPathPlan[],
  privkeys: string[],
): Map<string, ScriptPathSpend> {
  const out = new Map<string, ScriptPathSpend>();
  for (const plan of plans) {
    const proof = inputs.find((p) => p.secret === plan.secret);
    if (!proof) {
      throw new CTSError(`Script path plan names a secret not in this transaction`);
    }
    if (out.has(plan.secret)) {
      throw new CTSError('Script path plan names the same input twice');
    }
    const tree = proof.spend_info?.tree;
    if (!tree || plan.leafIndex < 0 || plan.leafIndex >= tree.length) {
      throw new CTSError(`Script path plan names leaf ${plan.leafIndex}, which is not disclosed`);
    }
    const leaf = parseNutrootLeaf(hexToBytes(tree[plan.leafIndex]));
    if (leaf.type === 'hashlock' && plan.preimage === undefined) {
      throw new CTSError('Script path plan for a hashlock leaf needs a preimage');
    }
    // The control block's internal key, from whichever source the spend info offers (NUT-10).
    const K = internalKeyOf(proof, privkeys);
    if (!K) {
      throw new CTSError('Script path spend needs the internal key, which the spend info lacks');
    }
    const recovered = recoverLeafKeySecretKeys(tree, proof.spend_info?.E, privkeys)
      .filter((h) => h.leafIndex === plan.leafIndex)
      .map((h) => h.secretKey);
    const keys = [
      ...new Set([...recovered, ...(plan.extraKeys ?? []).map((k: string) => k.toLowerCase())]),
    ];
    // A co-signer contributes signatures, not keys, so its share cannot be counted until the
    // digest exists. Everything else about the plan is checkable now.
    if (!plan.cosign && keys.length < leaf.n) {
      throw new CTSError(
        `Script path leaf needs ${leaf.n} signatures, ${keys.length} keys available`,
      );
    }
    out.set(plan.secret, {
      tree,
      leafIndex: plan.leafIndex,
      K,
      ...(plan.preimage !== undefined && { preimage: plan.preimage }),
      keys,
      leaf,
      ...(plan.cosign && { cosign: plan.cosign }),
    });
  }
  return out;
}

/**
 * The internal key `K` behind a proof's secret, from its spend info: explicit, from a bearer
 * scalar, or trial-matched from a receiver-keyed ephemeral. Undefined when none applies.
 */
function internalKeyOf(proof: Proof, privkeys: string[]): string | undefined {
  const info = proof.spend_info;
  if (!info) return undefined;
  if (info.k && /^[0-9a-f]{64}$/.test(info.k)) {
    try {
      return bytesToHex(getPubKeyFromPrivKey(hexToBytes(info.k)));
    } catch {
      return undefined;
    }
  }
  if (info.E) {
    for (const priv of privkeys) {
      const hit = recoverReceiverKeyedSecretKey(proof.secret, info.E, priv, info.tree);
      if (hit) return hit.internalKey;
    }
  }
  if (info.K) {
    try {
      return normalizeSecpPubkey(info.K);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Collects key-path keys from the inputs' spend info, keyed by secret hex.
 *
 * @remarks
 * Two sources (NUT-10): a bearer `k`, verified by `k*G`, and a receiver-keyed `E`, which
 * trial-matches against the static keys the caller holds. Proofs whose key is neither are left
 * unsigned; the mint refuses them, which is the honest outcome.
 */
export function collectSpendInfoKeys(
  inputs: Proof[],
  privkeys: string | string[] | undefined,
  logger: Logger,
): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  const statics = privkeys === undefined ? [] : [privkeys].flat();
  for (const proof of inputs) {
    const E = proof.spend_info?.E;
    // `k` and `E` are mutually exclusive (NUT-10). Both present is the shape a re-gifted
    // receiver-keyed scalar takes, and that scalar is `p_static + r_i`: whoever knows `r_i`
    // recovers the receiver's static private key from it. The receive cascade rejects this, but
    // it only runs on receive, and melt reaches here directly. Refuse loudly wherever it appears:
    // this is a compromised key, not an input that merely cannot be signed.
    if (E !== undefined && proof.spend_info?.k !== undefined) {
      fail('Spend info carries both k and E', logger);
    }
    if (E && statics.length > 0) {
      for (const priv of statics) {
        const hit = recoverReceiverKeyedSecretKey(proof.secret, E, priv, proof.spend_info?.tree);
        if (hit) {
          keys.set(proof.secret, hexToBytes(hit.secretKey));
          break;
        }
      }
    }
    const k = proof.spend_info?.k;
    if (!k || !/^[0-9a-f]{64}$/.test(k)) continue;
    try {
      const kBytes = hexToBytes(k);
      if (bytesToHex(getPubKeyFromPrivKey(kBytes)) === proof.secret) {
        keys.set(proof.secret, kBytes);
        continue;
      }
      // Locked proof: the key path signs with p' = k + t over the disclosed tree.
      const tree = proof.spend_info?.tree;
      if (tree && tree.length > 0) {
        const root = nutrootMerkleRoot(tree.map((leaf) => nutrootLeafHash(hexToBytes(leaf))));
        const tweaked = nutrootTweakSeckey(kBytes, root);
        if (bytesToHex(getPubKeyFromPrivKey(tweaked)) === proof.secret) {
          keys.set(proof.secret, tweaked);
        }
        continue;
      }
      // Empty tweak, no tree (NUT-10): p' = k + tagged_hash(tag, K). A true aggregate has no
      // single holder of `k`, so this reaches only a single-party key using the same form.
      const empty = nutrootTweakSeckey(kBytes);
      if (bytesToHex(getPubKeyFromPrivKey(empty)) === proof.secret) {
        keys.set(proof.secret, empty);
      }
    } catch {
      // invalid scalar: leave unsigned
    }
  }
  return keys;
}

/**
 * Creates a quote lock keypair; the full contract is documented on `Wallet.createQuoteLockKey`.
 *
 * @remarks
 * Seed-derived from a freshly reserved quote counter when seeded, random otherwise. Reserving (and
 * any persistence events it fires) is the caller's, via `reserveQuoteCounter`.
 */
export async function createQuoteLockKeyPair(
  seed: Uint8Array | undefined,
  reserveQuoteCounter: () => Promise<number>,
): Promise<{ pubkey: string; privkey: string }> {
  const privkey = seed
    ? deriveQuoteLockKey(seed, await reserveQuoteCounter())
    : createRandomSecretKey();
  return { pubkey: bytesToHex(getPubKeyFromPrivKey(privkey)), privkey: bytesToHex(privkey) };
}

/**
 * Headroom over the quote counter when recovering a quote lock key, covering quotes created by
 * another session since the counter was last persisted.
 */
const QUOTE_SCAN_HEADROOM = 128;

/**
 * Scans the quote counter for the key behind a quote lock pubkey; the full contract is documented
 * on `Wallet.recoverQuoteLockKey`. Returns undefined for a pubkey the seed never derived.
 */
export async function scanQuoteLockKey(
  pubkey: string,
  state: NutrootWalletState,
): Promise<string | undefined> {
  if (!state.seed) fail('recoverQuoteLockKey requires a seeded wallet', state.logger);
  const seed = state.seed;
  const normalizedPubkey = normalizeSecpPubkey(pubkey);
  const bound = (await state.counters.peekNext(QUOTE_COUNTER_KEY)) + QUOTE_SCAN_HEADROOM;
  for (let counter = 0; counter < bound; counter++) {
    const privkey = deriveQuoteLockKey(seed, counter);
    if (bytesToHex(getPubKeyFromPrivKey(privkey)) === normalizedPubkey) {
      return bytesToHex(privkey);
    }
  }
  return undefined;
}

/**
 * Asserts the mint locked a quote to the key it was asked for, and returns the key it echoed.
 *
 * @remarks
 * A locked quote the wallet cannot sign for is worthless, and the wallet only finds that out at
 * mint time unless it checks here. Shared by every path that sends a pubkey, because the way this
 * went missing once already was a new locked path being added beside the ones that had it.
 */
export function assertQuoteLockedTo(
  res: { pubkey?: string },
  requested: string,
  logger: Logger,
): string {
  if (typeof res.pubkey !== 'string') fail('Mint returned unlocked mint quote', logger);
  const returned = res.pubkey;
  if (returned.toLowerCase() !== requested) {
    fail('Mint quote is not locked to the requested pubkey', logger);
  }
  return returned;
}
