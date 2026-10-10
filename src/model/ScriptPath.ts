import { equalBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { schnorrSignDigest } from '../crypto/core';
import { hashToCurveBls } from '../crypto/curve_bls';
import { getPubKeyFromPrivKey } from '../crypto/curve_secp';
import { isBlsKeyset } from '../crypto/curves';
import {
  buildScriptPathWitness,
  enumerateLeafKeySlots,
  nutrootLeafHash,
  nutrootMerklePath,
  parseNutrootLeaf,
  readTlvRecords,
  selectRequiredLeafSignatures,
  slotKeysByBlindedPubkey,
  type NutrootConditionLeaf,
  type NutrootLeaf,
  verifyNutrootCommitment,
} from '../crypto/nutroot';
import {
  inputDigest,
  meltOutputAmount,
  messageForPayload,
  transcriptContainers,
} from '../crypto/transcript';
import {
  bytesToHex,
  bytesToUtf8,
  decodeBase64UrlToUint8,
  hexToBytes,
  isValidHex,
  JSONInt,
  encodeUint8ToBase64Url,
} from '../utils';
import { NUTROOT_MAX_SLOTS } from '../utils/limits';
import { orderOutputsForPayload } from '../wallet/_internal';
import type { MeltPreview, ScriptPathPlan, SwapPreview } from '../wallet/types';

import { CTSError } from './Errors';
import type { MeltQuoteBaseResponse, Proof, SerializedBlindedMessage } from './types';

/**
 * Transport prefix for a serialized script path signing package.
 */
const SCRIPT_PATH_PREFIX = 'nutspA';

// NUT-10 mint quote input container type; the other input type is a proof.
const CONTAINER_MINT_QUOTE_INPUT = 0x12;

/**
 * One input's script path spend, awaiting signatures.
 */
export type ScriptPathSpendRequest = {
  /**
   * Index of the input's container in the package transcript.
   */
  input: number;
  /**
   * The input's 33-byte point secret hex, so a signer can check the leaf belongs to that input.
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
   * Absolute blinding slot of each leaf key, aligned with the leaf's `keys` (NUT-28). A hint only:
   * the signer derives these first and falls back to the full slot scan if none match.
   */
  slots?: number[];
  /**
   * Signatures collected so far, hex. Grows as signers add theirs.
   */
  signatures: string[];
};

/**
 * Everything a signer needs to satisfy one or more script path spends, and nothing else.
 *
 * @remarks
 * The transaction travels as its TLV transcript, and each spend opens its leaf to the input it
 * names. Hashlock preimages stay with the wallet that built the package until merge.
 */
export type ScriptPathSigningPackage = {
  version: 'nutspA';
  /**
   * The transaction's TLV transcript, hex (NUT-10).
   */
  transcript: string;
  spends: ScriptPathSpendRequest[];
};

function payloadTranscript(
  inputs: Proof[],
  outputs: SerializedBlindedMessage[],
  meltQuote?: { quoteId: string; amount: bigint },
): Uint8Array {
  return messageForPayload({
    proofInputs: inputs,
    blindedOutputs: outputs,
    ...(meltQuote && { meltQuoteOutput: meltQuote }),
  });
}

/**
 * Each spend's input digest, in spend order, derived from the package transcript alone.
 */
function packageInputDigests(pkg: ScriptPathSigningPackage): Uint8Array[] {
  const transcript = hexToBytes(pkg.transcript);
  const containers = transcriptContainers(transcript);
  const digest = sha256(transcript);
  return pkg.spends.map((spend) => inputDigest(digest, containers[spend.input]));
}

/**
 * The proof's internal key `K`, from its spend info.
 */
function internalKey(proof: Proof): string {
  const info = proof.spend_info;
  if (info?.k) {
    try {
      return bytesToHex(getPubKeyFromPrivKey(hexToBytes(info.k)));
    } catch {
      throw new CTSError('Script path package bearer key is not a valid private key');
    }
  }
  if (!info?.K) {
    // NUT-10: K travels with a disclosed tree precisely so a wallet that is not the receiver
    // can build a control block.
    throw new CTSError('Script path package needs the internal key from the proof spend info');
  }
  return info.K;
}

function buildPackage(
  inputs: Proof[],
  transcript: Uint8Array,
  plans: ScriptPathPlan[],
): ScriptPathSigningPackage {
  if (plans.length === 0) {
    throw new CTSError('A script path package needs at least one plan');
  }
  const spends = plans.map((plan) => {
    // Proof inputs are the transcript's first containers, in request order (NUT-10).
    const input = inputs.findIndex((p) => p.secret === plan.secret && isBlsKeyset(p.id));
    if (input < 0) {
      throw new CTSError('Script path plan names a secret not in this transaction');
    }
    const proof = inputs[input];
    const tree = proof.spend_info?.tree;
    if (!tree || plan.leafIndex < 0 || plan.leafIndex >= tree.length) {
      throw new CTSError(`Script path plan names leaf ${plan.leafIndex}, which is not disclosed`);
    }
    const leafHashes = tree.map((leaf) => nutrootLeafHash(hexToBytes(leaf)));
    const control = {
      K: internalKey(proof),
      path: nutrootMerklePath(leafHashes, plan.leafIndex).map((h) => bytesToHex(h)),
    };
    const E = proof.spend_info?.E;
    // The package carries one leaf, so only the builder, holding the whole tree, knows the slots.
    const slots = E
      ? enumerateLeafKeySlots(tree.map((leaf) => parseNutrootLeaf(hexToBytes(leaf))))
          .filter((s) => s.leafIndex === plan.leafIndex)
          .map((s) => s.slot)
      : undefined;
    return {
      input,
      secret: plan.secret,
      leaf: tree[plan.leafIndex],
      control,
      ...(E && { E, slots }),
      signatures: [],
    };
  });
  return { version: SCRIPT_PATH_PREFIX, transcript: bytesToHex(transcript), spends };
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

function swapTranscript(preview: SwapPreview): Uint8Array {
  return payloadTranscript(preview.inputs, orderedOutputs(preview));
}

function meltTranscript<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
  preview: MeltPreview<TQuote>,
  feeIndex?: number,
): Uint8Array {
  return payloadTranscript(
    preview.inputs,
    preview.outputData.map((d) => d.blindedMessage),
    { quoteId: preview.quote.quote, amount: meltOutputAmount(preview.quote, feeIndex).toBigInt() },
  );
}

function extractSwapPackage(
  preview: SwapPreview,
  plans: ScriptPathPlan[],
): ScriptPathSigningPackage {
  return buildPackage(preview.inputs, swapTranscript(preview), plans);
}

function extractMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
  preview: MeltPreview<TQuote>,
  plans: ScriptPathPlan[],
  feeIndex?: number,
): ScriptPathSigningPackage {
  return buildPackage(preview.inputs, meltTranscript(preview, feeIndex), plans);
}

function serializePackage(pkg: ScriptPathSigningPackage): string {
  const json = JSONInt.stringify(pkg) ?? '{}';
  return `${SCRIPT_PATH_PREFIX}${encodeUint8ToBase64Url(utf8ToBytes(json))}`;
}

function deserializePackage(input: string): ScriptPathSigningPackage {
  if (!input.startsWith(SCRIPT_PATH_PREFIX)) {
    throw new CTSError(`Invalid signing package: must start with "${SCRIPT_PATH_PREFIX}"`);
  }
  let data: unknown;
  try {
    data = JSONInt.parse(
      bytesToUtf8(decodeBase64UrlToUint8(input.slice(SCRIPT_PATH_PREFIX.length))),
      undefined,
      { strict: true },
    );
  } catch (e) {
    throw new CTSError('Failed to parse signing package', { cause: e });
  }
  const pkg = data as ScriptPathSigningPackage;
  assertValidPackage(pkg);
  return pkg;
}

function assertValidPackage(pkg: ScriptPathSigningPackage): NutrootConditionLeaf[] {
  if (!pkg || typeof pkg !== 'object' || pkg.version !== SCRIPT_PATH_PREFIX) {
    throw new CTSError('Invalid signing package version');
  }
  if (!isValidHex(pkg.transcript) || !Array.isArray(pkg.spends)) {
    throw new CTSError('Malformed signing package');
  }
  let containers: Uint8Array[];
  try {
    containers = transcriptContainers(hexToBytes(pkg.transcript));
  } catch (e) {
    throw new CTSError('Signing package transcript is malformed', { cause: e });
  }
  const spent = new Set<number>();
  const leaves: NutrootConditionLeaf[] = [];
  for (const spend of pkg.spends) {
    const container = Number.isInteger(spend?.input) ? containers[spend.input] : undefined;
    // The high nibble of a container type is its section; 0x1n is an input.
    if (!container || container[0] >> 4 !== 1 || spent.has(spend.input)) {
      throw new CTSError('Signing package spend must name one unique transaction input');
    }
    spent.add(spend.input);
    assertSpendNamesInput(spend, container);
    let leaf;
    try {
      leaf = parseNutrootLeaf(hexToBytes(spend.leaf));
      if (
        !spend.control ||
        !Array.isArray(spend.control.path) ||
        !verifyNutrootCommitment(
          hexToBytes(spend.secret),
          hexToBytes(spend.control.K),
          hexToBytes(spend.leaf),
          spend.control.path.map((hash) => hexToBytes(hash)),
        )
      ) {
        throw new CTSError('commitment mismatch');
      }
    } catch (e) {
      throw new CTSError('Signing package leaf does not commit to its input secret', { cause: e });
    }
    if (leaf.type === 'commit') {
      throw new CTSError('Signing package names a commit leaf, which is not a spend path');
    }
    if (!Array.isArray(spend.signatures)) {
      throw new CTSError('Signing package signatures must be an array');
    }
    if (spend.slots !== undefined) {
      const isSlot = (s: unknown) =>
        Number.isInteger(s) && (s as number) >= 1 && (s as number) < NUTROOT_MAX_SLOTS;
      const oneSlotPerKey =
        Array.isArray(spend.slots) &&
        spend.slots.length === leaf.keys.length &&
        spend.slots.every(isSlot);
      if (!oneSlotPerKey) {
        throw new CTSError('Signing package slot hints must name one valid slot per leaf key');
      }
    }
    leaves.push(leaf);
  }
  return leaves;
}

/**
 * Checks a spend's secret is the one its container commits to, so the leaf it opens is that
 * input's.
 *
 * @remarks
 * A proof input commits `Y = hash_to_curve(secret)`; a mint quote input commits its lock key.
 */
function assertSpendNamesInput(spend: ScriptPathSpendRequest, container: Uint8Array): void {
  if (typeof spend.secret !== 'string' || !isValidHex(spend.secret) || spend.secret.length !== 66) {
    throw new CTSError('Signing package spend secret is malformed');
  }
  const secret = spend.secret.toLowerCase();
  const fields = new Map(readTlvRecords(container.subarray(3)).map((r) => [r.type, r.value]));
  const field03 = bytesToHex(fields.get(0x03) ?? new Uint8Array());
  if (container[0] === CONTAINER_MINT_QUOTE_INPUT) {
    if (field03 !== secret) {
      throw new CTSError('Signing package spend secret is not its quote input lock key');
    }
    return;
  }
  const keysetId = bytesToHex(fields.get(0x02) ?? new Uint8Array());
  if (!isBlsKeyset(keysetId) || hashToCurveBls(utf8ToBytes(secret)).toHex(true) !== field03) {
    throw new CTSError('Signing package spend secret does not match its v3 input');
  }
}

function signPackage(pkg: ScriptPathSigningPackage, privkey: string): ScriptPathSigningPackage {
  const leaves = assertValidPackage(pkg);
  const digests = packageInputDigests(pkg);
  const pub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(privkey)));
  const spends = pkg.spends.map((spend, i) => {
    const leaf = leaves[i];
    const keys: string[] = [];
    if (leaf.keys.some((key) => key.slice(-64) === pub.slice(-64))) {
      keys.push(privkey.toLowerCase());
    }
    if (spend.E !== undefined) {
      // The slot hint is trust-free: a wrong slot simply fails to match, and the fallback matches
      // by value over the whole slot space, which no leaf order or tree shape can defeat.
      const matches = (slots: number | number[]) => {
        const blinded = slotKeysByBlindedPubkey(spend.E!, privkey, slots);
        return leaf.keys.flatMap((key) => blinded.get(key)?.secretKey ?? []);
      };
      const hinted = spend.slots ? matches(spend.slots) : [];
      keys.push(...(hinted.length > 0 ? hinted : matches(NUTROOT_MAX_SLOTS - 1)));
    }
    if (keys.length === 0) return spend;
    const added = keys.map((k) => schnorrSignDigest(digests[i], k));
    return { ...spend, signatures: [...new Set([...spend.signatures, ...added])] };
  });
  return { ...pkg, spends };
}

function mergeSwapPackage(
  pkg: ScriptPathSigningPackage,
  preview: SwapPreview,
  plans?: ScriptPathPlan[],
): SwapPreview {
  assertValidPackage(pkg);
  assertMatches(pkg, swapTranscript(preview));
  return { ...preview, inputs: applyWitnesses(pkg, preview.inputs, plans) };
}

function mergeMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
  pkg: ScriptPathSigningPackage,
  preview: MeltPreview<TQuote>,
  plans?: ScriptPathPlan[],
  feeIndex?: number,
): MeltPreview<TQuote> {
  assertValidPackage(pkg);
  assertMatches(pkg, meltTranscript(preview, feeIndex));
  return { ...preview, inputs: applyWitnesses(pkg, preview.inputs, plans) };
}

function assertMatches(pkg: ScriptPathSigningPackage, expected: Uint8Array): void {
  if (!equalBytes(expected, hexToBytes(pkg.transcript))) {
    throw new CTSError(
      'Signing package does not match this transaction: its inputs, outputs or their order moved since it was extracted',
    );
  }
}

/**
 * A spend's witness, built from its input's spend info and the package's signatures.
 */
function spendWitness(
  spend: ScriptPathSpendRequest,
  proof: Proof,
  digest: Uint8Array,
  preimage?: string,
): string {
  const tree = proof.spend_info?.tree ?? [];
  const wanted = spend.leaf.toLowerCase();
  const leafIndex = tree.findIndex((leaf) => leaf.toLowerCase() === wanted);
  if (leafIndex < 0) {
    throw new CTSError('Signing package leaf is not in its input proof spend info');
  }
  const leaf = parseNutrootLeaf(hexToBytes(spend.leaf));
  if (leaf.type === 'hashlock' && preimage === undefined) {
    throw new CTSError(
      'A hashlock spend needs its preimage at merge: pass the plans the package was extracted with',
    );
  }
  const signatures = selectRequiredLeafSignatures(leaf, digest, spend.signatures);
  return buildScriptPathWitness(tree, leafIndex, internalKey(proof), signatures, preimage);
}

function applyWitnesses(
  pkg: ScriptPathSigningPackage,
  inputs: Proof[],
  plans: ScriptPathPlan[] = [],
): Proof[] {
  const digests = packageInputDigests(pkg);
  const preimages = new Map(plans.map((p) => [p.secret, p.preimage]));
  const witnessed = [...inputs];
  pkg.spends.forEach((spend, i) => {
    const proof = inputs[spend.input];
    if (!proof || !isBlsKeyset(proof.id)) {
      throw new CTSError('Signing package spend does not name a v3 proof input');
    }
    const witness = spendWitness(spend, proof, digests[i], preimages.get(proof.secret));
    witnessed[spend.input] = { ...proof, witness };
  });
  return witnessed;
}

function witnessFor(
  spend: ScriptPathSpendRequest,
  tree: string[],
  leafIndex: number,
  preimage?: string,
): string {
  return buildScriptPathWitness(tree, leafIndex, spend.control.K, spend.signatures, preimage);
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
    feeIndex?: number,
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
   * set of outputs cannot be spent against another, and output order is part of that. `plans` are
   * the ones the package was extracted with: a hashlock leaf takes its preimage from there, since
   * the package never carries it.
   * @throws If the package does not belong to this preview, a spend is short of its leaf's
   *   signature threshold, or a hashlock spend has no preimage in `plans`.
   */
  mergeSwapPackage(
    pkg: ScriptPathSigningPackage,
    preview: SwapPreview,
    plans?: ScriptPathPlan[],
  ): SwapPreview;
  /**
   * Melt counterpart of {@link ScriptPathApi.mergeSwapPackage}.
   */
  mergeMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote' | 'amount'>>(
    pkg: ScriptPathSigningPackage,
    preview: MeltPreview<TQuote>,
    plans?: ScriptPathPlan[],
    feeIndex?: number,
  ): MeltPreview<TQuote>;
  /**
   * The witness a spend would produce, without a preview. Useful for inspection.
   */
  witnessFor(
    spend: ScriptPathSpendRequest,
    tree: string[],
    leafIndex: number,
    preimage?: string,
  ): string;
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
  witnessFor,
};

export type { NutrootLeaf };
