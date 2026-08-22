import { schnorr } from '@noble/curves/secp256k1.js';

import { getPubKeyFromPrivKey } from '../crypto/curve_secp';
import {
  buildScriptPathWitness,
  NUTROOT_MAX_SLOTS,
  parseNutrootLeaf,
  selectLeafSignatures,
  slotKeysByBlindedPubkey,
  nutrootLeafHash,
  nutrootMerklePath,
  type NutrootLeaf,
  verifyNutrootCommitment,
} from '../crypto/nutroot';
import { transactionDigest } from '../crypto/transcript';
import { Bytes, JSONInt, encodeUint8toBase64Url } from '../utils';
import { orderOutputsForPayload } from '../wallet/_internal';
import type { MeltPreview, ScriptPathPlan, SwapPreview } from '../wallet/types';

import { Amount } from './Amount';
import { CTSError } from './Errors';
import type { MeltQuoteBaseResponse, Proof, SerializedBlindedMessage } from './types';

/**
 * Transport prefix for a serialized script path signing package.
 */
const SCRIPT_PATH_PREFIX = 'nutspA';

/**
 * One input's script path spend, awaiting signatures.
 */
export type ScriptPathSpendRequest = {
  /**
   * The input being spent, by its 33-byte point secret hex.
   */
  secret: string;
  /**
   * The serialized leaf being exercised, hex.
   */
  leaf: string;
  /**
   * Control block for the witness: internal key and merkle path.
   */
  control: { K: string; path: string[] };
  /**
   * Ephemeral `E` when the proof is receiver-keyed, so a signer holding a blinded slot key can
   * derive it. Absent for bearer and script-only proofs, whose leaf keys are verbatim.
   */
  E?: string;
  /**
   * Preimage for a hashlock leaf, hex.
   */
  preimage?: string;
  /**
   * Signatures collected so far, hex. Grows as signers add theirs.
   */
  signatures: string[];
};

/**
 * Everything a signer needs to satisfy one or more script path spends, and nothing else.
 *
 * @remarks
 * Carries no secrets and no blinding factors: inputs contribute only what the transcript commits
 * to. Serialize it, send it wherever the keys are, sign, and merge the result back into the preview
 * it came from. Unlike a co-signer hook, the transaction is not in flight meanwhile, so a ceremony
 * can outlive the process that started it, which is the normal case on a phone.
 */
export type ScriptPathSigningPackage = {
  version: 'nutspA';
  type: 'swap' | 'melt';
  /**
   * Melt quote id; melt packages only.
   */
  quote?: string;
  inputs: Array<Pick<Proof, 'amount' | 'id' | 'secret' | 'C'>>;
  outputs: SerializedBlindedMessage[];
  /**
   * Melt quote amount, needed to reproduce the digest; melt packages only.
   */
  quoteAmount?: bigint;
  /**
   * The transaction digest every signature covers, hex.
   */
  digest: string;
  spends: ScriptPathSpendRequest[];
};

function digestOf(
  inputs: Array<Pick<Proof, 'amount' | 'id' | 'secret' | 'C'>>,
  outputs: SerializedBlindedMessage[],
  meltQuote?: { quoteId: string; amount: bigint },
): Uint8Array {
  return transactionDigest({
    proofInputs: inputs.map((p) => ({
      amount: Amount.from(p.amount).toBigInt(),
      keysetId: p.id,
      secret: p.secret,
      C: p.C,
    })),
    blindedOutputs: outputs.map((o) => ({
      amount: Amount.from(o.amount).toBigInt(),
      keysetId: o.id,
      B_: o.B_,
    })),
    ...(meltQuote && {
      meltQuoteOutputs: [{ amount: meltQuote.amount, quoteId: meltQuote.quoteId }],
    }),
  });
}

function buildPackage(
  type: 'swap' | 'melt',
  inputs: Proof[],
  outputs: SerializedBlindedMessage[],
  plans: ScriptPathPlan[],
  meltQuote?: { quoteId: string; amount: bigint },
): ScriptPathSigningPackage {
  if (plans.length === 0) {
    throw new CTSError('A script path package needs at least one plan');
  }
  const digest = digestOf(inputs, outputs, meltQuote);
  const spends = plans.map((plan) => {
    const proof = inputs.find((p) => p.secret === plan.secret);
    if (!proof) {
      throw new CTSError('Script path plan names a secret not in this transaction');
    }
    const tree = proof.spend_info?.tree;
    if (!tree || plan.leafIndex < 0 || plan.leafIndex >= tree.length) {
      throw new CTSError(`Script path plan names leaf ${plan.leafIndex}, which is not disclosed`);
    }
    const K = proof.spend_info?.K;
    if (!K) {
      // NUT-10: K travels with a disclosed tree precisely so a signer who is not the receiver
      // can build a control block.
      throw new CTSError('Script path package needs the internal key from the proof spend info');
    }
    const leafHashes = tree.map((leaf) => nutrootLeafHash(Bytes.fromHex(leaf)));
    return {
      secret: plan.secret,
      leaf: tree[plan.leafIndex],
      control: {
        K,
        path: nutrootMerklePath(leafHashes, plan.leafIndex).map((h) => Bytes.toHex(h)),
      },
      ...(proof.spend_info?.E && { E: proof.spend_info.E }),
      ...(plan.preimage !== undefined && { preimage: plan.preimage }),
      signatures: [],
    };
  });
  return {
    version: SCRIPT_PATH_PREFIX,
    type,
    ...(meltQuote && { quote: meltQuote.quoteId, quoteAmount: meltQuote.amount }),
    inputs: inputs.map((p) => ({ amount: p.amount, id: p.id, secret: p.secret, C: p.C })),
    outputs,
    digest: Bytes.toHex(digest),
    spends,
  };
}

/**
 * Outputs in the order the payload will carry them, so a package's digest matches what is sent.
 */
function orderedOutputs(preview: SwapPreview): SerializedBlindedMessage[] {
  return orderOutputsForPayload(
    preview.keepOutputs ?? [],
    preview.sendOutputs ?? [],
  ).outputData.map((d) => d.blindedMessage);
}

function extractSwapPackage(
  preview: SwapPreview,
  plans: ScriptPathPlan[],
): ScriptPathSigningPackage {
  return buildPackage('swap', preview.inputs, orderedOutputs(preview), plans);
}

function extractMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
  preview: MeltPreview<TQuote>,
  plans: ScriptPathPlan[],
): ScriptPathSigningPackage {
  return buildPackage(
    'melt',
    preview.inputs,
    preview.outputData.map((d) => d.blindedMessage),
    plans,
    { quoteId: preview.quote.quote, amount: Amount.from(preview.quote.amount).toBigInt() },
  );
}

function serializePackage(pkg: ScriptPathSigningPackage): string {
  const json = JSONInt.stringify(pkg) ?? '{}';
  return `${SCRIPT_PATH_PREFIX}${encodeUint8toBase64Url(Bytes.fromString(json))}`;
}

function deserializePackage(input: string): ScriptPathSigningPackage {
  if (!input.startsWith(SCRIPT_PATH_PREFIX)) {
    throw new CTSError(`Invalid signing package: must start with "${SCRIPT_PATH_PREFIX}"`);
  }
  let data: unknown;
  try {
    data = JSONInt.parse(Bytes.toString(Bytes.fromBase64(input.slice(SCRIPT_PATH_PREFIX.length))));
  } catch (e) {
    throw new CTSError('Failed to parse signing package', { cause: e });
  }
  const pkg = data as ScriptPathSigningPackage;
  assertValidPackage(pkg);
  return pkg;
}

function assertValidPackage(pkg: ScriptPathSigningPackage): void {
  if (!pkg || typeof pkg !== 'object' || pkg.version !== SCRIPT_PATH_PREFIX) {
    throw new CTSError('Invalid signing package version');
  }
  if (pkg.type !== 'swap' && pkg.type !== 'melt') {
    throw new CTSError('Invalid signing package type');
  }
  if (!Array.isArray(pkg.inputs) || !Array.isArray(pkg.outputs) || !Array.isArray(pkg.spends)) {
    throw new CTSError('Malformed signing package');
  }
  if (!/^[0-9a-f]{64}$/.test(pkg.digest ?? '')) {
    throw new CTSError('Signing package digest must be 32 bytes hex');
  }
  if (
    pkg.type === 'melt' &&
    (typeof pkg.quote !== 'string' || pkg.quote.length === 0 || pkg.quoteAmount === undefined)
  ) {
    throw new CTSError('Melt signing package needs a quote and amount');
  }
  const recomputed = Bytes.toHex(
    digestOf(
      pkg.inputs,
      pkg.outputs,
      pkg.type === 'melt'
        ? { quoteId: pkg.quote!, amount: Amount.from(pkg.quoteAmount!).toBigInt() }
        : undefined,
    ),
  );
  if (recomputed !== pkg.digest) {
    throw new CTSError('Signing package digest does not match its inputs and outputs');
  }
  const inputSecrets = new Set(pkg.inputs.map((input) => input.secret));
  const spent = new Set<string>();
  for (const spend of pkg.spends) {
    if (!inputSecrets.has(spend.secret) || spent.has(spend.secret)) {
      throw new CTSError('Signing package spend must name one unique transaction input');
    }
    spent.add(spend.secret);
    try {
      parseNutrootLeaf(Bytes.fromHex(spend.leaf));
      if (
        !spend.control ||
        !Array.isArray(spend.control.path) ||
        !verifyNutrootCommitment(
          Bytes.fromHex(spend.secret),
          Bytes.fromHex(spend.control.K),
          Bytes.fromHex(spend.leaf),
          spend.control.path.map((hash) => Bytes.fromHex(hash)),
        )
      ) {
        throw new Error('commitment mismatch');
      }
    } catch (e) {
      throw new CTSError('Signing package leaf does not commit to its input secret', { cause: e });
    }
    if (!Array.isArray(spend.signatures)) {
      throw new CTSError('Signing package signatures must be an array');
    }
  }
}

function signPackage(pkg: ScriptPathSigningPackage, privkey: string): ScriptPathSigningPackage {
  assertValidPackage(pkg);
  const digest = Bytes.fromHex(pkg.digest);
  const pub = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(privkey)));
  const spends = pkg.spends.map((spend) => {
    const leaf = parseNutrootLeaf(Bytes.fromHex(spend.leaf));
    const keys: string[] = [];
    if (leaf.keys.includes(pub)) keys.push(privkey.toLowerCase());
    if (spend.E !== undefined) {
      // Match by value over the whole slot space: the true slot count is not recoverable from a
      // single spend (the package carries one leaf, not the tree), and the transmitted leaf order
      // is not committed by the root, so any narrower, position-derived search could decline a
      // leaf this signer can in fact satisfy.
      const blinded = slotKeysByBlindedPubkey(spend.E, privkey, NUTROOT_MAX_SLOTS - 1);
      for (const key of leaf.keys) {
        const candidate = blinded.get(key);
        if (candidate) keys.push(candidate.secretKey);
      }
    }
    if (keys.length === 0) return spend;
    const added = keys.map((k) => Bytes.toHex(schnorr.sign(digest, Bytes.fromHex(k))));
    return { ...spend, signatures: [...new Set([...spend.signatures, ...added])] };
  });
  return { ...pkg, spends };
}

function mergeSwapPackage(pkg: ScriptPathSigningPackage, preview: SwapPreview): SwapPreview {
  if (pkg.type !== 'swap') throw new CTSError('Cannot merge a melt package into a swap');
  assertValidPackage(pkg);
  assertMatches(pkg, digestOf(preview.inputs, orderedOutputs(preview)));
  return { ...preview, inputs: applyWitnesses(pkg, preview.inputs) };
}

function mergeMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
  pkg: ScriptPathSigningPackage,
  preview: MeltPreview<TQuote>,
): MeltPreview<TQuote> {
  if (pkg.type !== 'melt') throw new CTSError('Cannot merge a swap package into a melt');
  assertValidPackage(pkg);
  assertMatches(
    pkg,
    digestOf(
      preview.inputs,
      preview.outputData.map((d) => d.blindedMessage),
      { quoteId: preview.quote.quote, amount: Amount.from(preview.quote.amount).toBigInt() },
    ),
  );
  return { ...preview, inputs: applyWitnesses(pkg, preview.inputs) };
}

function assertMatches(pkg: ScriptPathSigningPackage, expected: Uint8Array): void {
  if (Bytes.toHex(expected) !== pkg.digest) {
    throw new CTSError(
      'Signing package does not match this transaction: its inputs, outputs or their order moved since it was extracted',
    );
  }
}

function applyWitnesses(pkg: ScriptPathSigningPackage, inputs: Proof[]): Proof[] {
  const digest = Bytes.fromHex(pkg.digest);
  const bySecret = new Map(pkg.spends.map((s) => [s.secret, s]));
  return inputs.map((proof) => {
    const spend = bySecret.get(proof.secret);
    if (!spend) return proof;
    const leaf = parseNutrootLeaf(Bytes.fromHex(spend.leaf));
    // One valid signature per leaf key: the mint bounds `signatures` at the leaf's key count, so
    // duplicates and non-verifying cosigner extras are trimmed rather than forwarded.
    const signatures = selectLeafSignatures(leaf, digest, spend.signatures);
    if (signatures.length < leaf.n) {
      throw new CTSError(
        `Script path leaf needs ${leaf.n} valid signatures, package has ${signatures.length}`,
      );
    }
    return {
      ...proof,
      witness: JSON.stringify({
        leaf: spend.leaf,
        control: spend.control,
        signatures,
        ...(spend.preimage !== undefined && { preimage: spend.preimage }),
      }),
    };
  });
}

/**
 * The {@link ScriptPath} surface.
 */
export type ScriptPathApi = {
  /**
   * Builds a signing package for a swap preview's script path plans.
   */
  extractSwapPackage(preview: SwapPreview, plans: ScriptPathPlan[]): ScriptPathSigningPackage;
  /**
   * Builds a signing package for a melt preview's script path plans.
   */
  extractMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
    preview: MeltPreview<TQuote>,
    plans: ScriptPathPlan[],
  ): ScriptPathSigningPackage;
  /**
   * Serializes a package to its `nutspA...` transport string.
   */
  serializePackage(pkg: ScriptPathSigningPackage): string;
  /**
   * Parses a transport string and fully validates it: digest, commitments, spend shape.
   */
  deserializePackage(input: string): ScriptPathSigningPackage;
  /**
   * Signs every spend in the package whose leaf names a key derived from `privkey`.
   *
   * @remarks
   * Handles both forms a leaf key takes: verbatim, and blinded at a NUT-28 slot, which needs the
   * package's `E` to derive. Signatures are deduplicated, so signing twice is harmless.
   * @returns The package with any new signatures appended. Signs nothing if no leaf names the key.
   */
  signPackage(pkg: ScriptPathSigningPackage, privkey: string): ScriptPathSigningPackage;
  /**
   * Injects the package's witnesses into the swap preview it came from.
   *
   * @remarks
   * Recomputes the digest from the preview and refuses if it moved: a package signed against one
   * set of outputs cannot be spent against another, and output order is part of that.
   * @throws If the package does not belong to this preview, or a spend is short of its leaf's
   *   signature threshold.
   */
  mergeSwapPackage(pkg: ScriptPathSigningPackage, preview: SwapPreview): SwapPreview;
  /**
   * Melt counterpart of {@link ScriptPathApi.mergeSwapPackage}.
   */
  mergeMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
    pkg: ScriptPathSigningPackage,
    preview: MeltPreview<TQuote>,
  ): MeltPreview<TQuote>;
  /**
   * The witness a spend would produce, without a preview. Useful for inspection.
   */
  witnessFor(spend: ScriptPathSpendRequest, tree: string[], leafIndex: number): string;
};

/**
 * Out-of-band signing for script path spends (NUT-10).
 *
 * @remarks
 * Extract a package from a preview, send it to whoever holds the keys, merge the signatures back,
 * then complete. The transaction is not in flight while signing happens, so the ceremony can
 * outlive the process: use this where a co-signer is a person or another device, and the `cosign`
 * hook on {@link ScriptPathPlan} where it is a service answering in seconds.
 * @experimental
 */
export const ScriptPath: ScriptPathApi = {
  extractSwapPackage,
  extractMeltPackage,
  serializePackage,
  deserializePackage,
  signPackage,
  mergeSwapPackage,
  mergeMeltPackage,
  witnessFor: (spend, tree, leafIndex) =>
    buildScriptPathWitness(tree, leafIndex, spend.control.K, spend.signatures, spend.preimage),
};

export type { NutrootLeaf };
