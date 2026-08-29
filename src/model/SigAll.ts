import { utf8ToBytes } from '@noble/hashes/utils.js';

import { computeMessageDigest, buildP2PKSigAllMessageV0, schnorrSignDigest } from '../crypto';
import { parseWitnessData } from '../crypto/NUT11';
import { JSONInt, encodeBase64UrltoUint8, encodeUint8toBase64Url } from '../utils';
import type { MeltPreview, SwapPreview } from '../wallet/types';

import { Amount } from './Amount';
import { CTSError } from './Errors';
import type { Proof, MeltQuoteBaseResponse, SerializedBlindedMessage } from './types';

/**
 * @experimental
 */
const SIGALL_PREFIX = 'sigallA';

/**
 * Per-format SIG_ALL digests, keyed by transcript version.
 *
 * @experimental
 */
export type SigAllDigests = {
  /**
   * Unframed concatenation format (CDK >= 0.14.0, Nutshell > 0.20.2).
   */
  v0: string;
};

/**
 * Represents a signing package for SigAll multi-party signing.
 *
 * This is a wallet-led transport format, it contains only the minimum data required to reconstruct
 * the SIG_ALL message.
 *
 * @experimental
 */
export type SigAllSigningPackage = {
  /**
   * Signing package version.
   */
  version: 'sigallA';
  /**
   * Type of signing package.
   */
  type: 'swap' | 'melt';
  /**
   * Required for melt packages, absent for swaps.
   */
  quote?: string;
  /**
   * Minimal input data required for signing verification.
   */
  inputs: Array<Pick<Proof, 'secret' | 'C'>>;
  /**
   * NUT-00 `BlindedMessages` for signing verification.
   */
  outputs: SerializedBlindedMessage[];
  /**
   * Signatures collected (to be injected into the first proof witness).
   */
  witness?: { signatures: string[] };
};

function computeDigests(
  inputs: Array<Pick<Proof, 'secret' | 'C'>>,
  outputs: SerializedBlindedMessage[],
  quoteId?: string,
): SigAllDigests {
  const sigAllOutputs = outputs.map((blindedMessage) => ({ blindedMessage }));
  const v0Msg = buildP2PKSigAllMessageV0(inputs, sigAllOutputs, quoteId);

  return {
    v0: computeMessageDigest(v0Msg, true),
  };
}

function serializePackage(pkg: SigAllSigningPackage): string {
  // Build object with fixed key order for determinism
  const ordered: Record<string, unknown> = { version: pkg.version, type: pkg.type };

  if (pkg.quote) ordered.quote = pkg.quote;

  ordered.inputs = pkg.inputs;
  ordered.outputs = pkg.outputs;

  if (pkg.witness) ordered.witness = pkg.witness;

  const json = JSONInt.stringify(ordered) ?? '{}';
  const base64url = encodeUint8toBase64Url(utf8ToBytes(json));

  return `${SIGALL_PREFIX}${base64url}`;
}

function deserializePackage(input: string): SigAllSigningPackage {
  if (!input.startsWith(SIGALL_PREFIX)) {
    throw new CTSError(`Invalid signing package: must start with "${SIGALL_PREFIX}"`);
  }

  const base64url = input.slice(SIGALL_PREFIX.length);
  let json: string;

  try {
    json = new TextDecoder('utf-8').decode(encodeBase64UrltoUint8(base64url));
  } catch (e) {
    throw new CTSError(
      `Failed to parse signing package: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  let data: unknown;

  try {
    data = JSONInt.parse(json);
  } catch (e) {
    throw new CTSError(
      `Failed to parse signing package JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  if (!data || typeof data !== 'object') {
    throw new CTSError('Signing package must be a JSON object');
  }

  const pkg = data as SigAllSigningPackage;

  const version = pkg.version as string;
  if (version !== SIGALL_PREFIX) {
    throw new CTSError(`Invalid signing package version: ${version}`);
  }

  const type = pkg.type as string;
  if (type !== 'swap' && type !== 'melt') {
    throw new CTSError(`Invalid signing package type: ${type}`);
  }

  // The quote is part of the signed melt transcript; without it a melt package
  // would produce a swap-shaped message.
  if (type === 'melt' && (typeof pkg.quote !== 'string' || pkg.quote.length === 0)) {
    throw new CTSError('Melt signing package requires a quote');
  }

  if (!Array.isArray(pkg.inputs)) {
    throw new CTSError('Signing package inputs must be an array');
  }

  for (let i = 0; i < pkg.inputs.length; i++) {
    const inp = pkg.inputs[i] as Record<string, unknown>;

    if (!inp || typeof inp !== 'object') throw new CTSError(`Invalid input at index ${i}`);

    if (typeof inp.secret !== 'string') throw new CTSError(`Input ${i}: secret must be string`);

    if (typeof inp.C !== 'string') throw new CTSError(`Input ${i}: C must be string`);
  }

  if (!Array.isArray(pkg.outputs)) {
    throw new CTSError('Signing package outputs must be an array');
  }

  for (let i = 0; i < pkg.outputs.length; i++) {
    const output = pkg.outputs[i] as Record<string, unknown>;

    if (!output || typeof output !== 'object') throw new CTSError(`Invalid output at index ${i}`);

    if (typeof output.amount !== 'number' && typeof output.amount !== 'bigint') {
      throw new CTSError(`Output ${i}: amount must be a number or bigint`);
    }

    if (!output.B_ || typeof output.B_ !== 'string') throw new CTSError(`Output ${i}: B_ invalid`);

    if (!output.id || typeof output.id !== 'string') throw new CTSError(`Output ${i}: id invalid`);

    // Rehydrate SerializedBlindedMessage.amount
    output.amount = Amount.from(output.amount);
  }

  if (pkg.witness !== undefined) {
    const witness = pkg.witness as { signatures?: unknown };
    if (
      !witness ||
      typeof witness !== 'object' ||
      !Array.isArray(witness.signatures) ||
      witness.signatures.some((s) => typeof s !== 'string')
    ) {
      throw new CTSError('Signing package witness.signatures must be a string array');
    }
  }

  // Rebuild from validated fields only, so unknown keys never survive transport.
  return {
    version: SIGALL_PREFIX,
    type,
    ...(type === 'melt' ? { quote: pkg.quote } : {}),
    inputs: pkg.inputs.map((p) => ({ secret: p.secret, C: p.C })),
    outputs: pkg.outputs.map((o) => ({ amount: o.amount, id: o.id, B_: o.B_ })),
    ...(pkg.witness ? { witness: { signatures: pkg.witness.signatures } } : {}),
  };
}

function signPackage(pkg: SigAllSigningPackage, privkey: string): SigAllSigningPackage {
  // Sign transcripts recomputed from the package contents; a signer only ever
  // signs what the package shows, never a digest chosen elsewhere.
  const digests = computeDigests(pkg.inputs, pkg.outputs, pkg.quote);
  const newSigs = [schnorrSignDigest(digests.v0, privkey)];

  return {
    ...pkg,
    witness: { signatures: [...(pkg.witness?.signatures || []), ...newSigs] },
  };
}

function extractSwapPackage(preview: SwapPreview): SigAllSigningPackage {
  // Merge keep + send outputs in order (both needed for complete transaction message)
  const allOutputs = [...(preview.keepOutputs || []), ...(preview.sendOutputs || [])];
  return buildSigningPackage(
    'swap',
    preview.inputs,
    allOutputs.map((output) => output.blindedMessage),
  );
}

function extractMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote'>>(
  preview: MeltPreview<TQuote>,
): SigAllSigningPackage {
  return buildSigningPackage(
    'melt',
    preview.inputs,
    preview.outputData.map((output) => output.blindedMessage),
    preview.quote.quote,
  );
}

function buildSigningPackage(
  type: 'swap' | 'melt',
  inputs: Array<Pick<Proof, 'secret' | 'C'>>,
  outputs: SerializedBlindedMessage[],
  quoteId?: string,
): SigAllSigningPackage {
  return {
    version: SIGALL_PREFIX,
    type,
    ...(quoteId ? { quote: quoteId } : {}),
    inputs: inputs.map((p) => ({ secret: p.secret, C: p.C })),
    outputs,
  };
}

function mergeSwapPackage(pkg: SigAllSigningPackage, preview: SwapPreview): SwapPreview {
  const updatedInputs = mergeSignatures(preview.inputs, pkg);
  return { ...preview, inputs: updatedInputs };
}

function mergeMeltPackage<TQuote extends Pick<MeltQuoteBaseResponse, 'quote'>>(
  pkg: SigAllSigningPackage,
  preview: MeltPreview<TQuote>,
): MeltPreview<TQuote> {
  const updatedInputs = mergeSignatures(preview.inputs, pkg);
  return { ...preview, inputs: updatedInputs };
}

function mergeSignatures(proofs: Proof[], pkg: SigAllSigningPackage): Proof[] {
  if (!pkg.witness?.signatures.length) {
    throw new CTSError('No signatures to merge');
  }

  if (proofs.length === 0) return proofs;

  const [first, ...rest] = proofs;
  const witnessData = parseWitnessData(first.witness);
  const existingSignatures = witnessData?.signatures ?? [];
  const updatedFirst: Proof = {
    ...first,
    witness: {
      ...(witnessData ?? {}),
      signatures: [...existingSignatures, ...pkg.witness.signatures],
    },
  };

  return [updatedFirst, ...rest];
}

/**
 * Helpers for SigAll multi-party signing coordination.
 *
 * @experimental
 */
export type SigAllApi = {
  /**
   * Computes the SIG_ALL digests for a transaction, keyed by transcript version.
   *
   * @param inputs Proof array.
   * @param outputs Array of SerializedBlindMessage (NUT-00 `BlindMessages`).
   * @param quoteId Optional quote ID for melt transactions.
   * @returns Hex-encoded SHA256 digest per format.
   * @experimental
   */
  computeDigests: (
    inputs: Array<Pick<Proof, 'secret' | 'C'>>,
    outputs: SerializedBlindedMessage[],
    quoteId?: string,
  ) => SigAllDigests;

  /**
   * Extracts a signing package from a SwapPreview for multi-party SIG_ALL coordination.
   *
   * @remarks
   * This creates a minimal, serializable package that can be passed to other signers. Secrets and
   * blinding factors are NOT included - only what's needed to reconstruct the exact SIG_ALL message
   * and produce signatures.
   * @param preview SwapPreview from prepareSwapToSend or prepareSwapToReceive.
   * @returns SigAllSigningPackage for distribution to signers.
   * @experimental
   */
  extractSwapPackage: (preview: SwapPreview) => SigAllSigningPackage;

  /**
   * Extracts a signing package from a MeltPreview for multi-party SIG_ALL coordination.
   *
   * @param preview MeltPreview from prepareMelt.
   * @returns SigAllSigningPackage for distribution to signers.
   * @experimental
   */
  extractMeltPackage: <TQuote extends Pick<MeltQuoteBaseResponse, 'quote'>>(
    preview: MeltPreview<TQuote>,
  ) => SigAllSigningPackage;

  /**
   * @remarks
   * Produces a deterministic JSON representation, base64url-encodes it and prefixes with sigallA
   * for transport.
   *
   * - Field order is fixed and version field is always included for compatibility.
   * - This enables consistent hashing and verification of package integrity.
   *
   * @param pkg The signing package to serialize.
   * @returns JSON string with sorted keys.
   * @experimental
   */
  serializePackage: (pkg: SigAllSigningPackage) => string;

  /**
   * @remarks
   * Accepts a sigallA-prefixed base64url string and rehydrates it into a SigAllSigningPackage. Only
   * known fields survive the round trip.
   * @experimental
   */
  deserializePackage: (input: string) => SigAllSigningPackage;

  /**
   * Signs a SigAllSigningPackage and returns it with signatures attached.
   *
   * @remarks
   * Signs the SIG_ALL transcripts recomputed from the package's own inputs, outputs and quote.
   * Multiple parties can call this sequentially to aggregate signatures for multi-party signing.
   * @param pkg The signing package (from extract*SigningPackage or another signer)
   * @param privkey Private key to sign with.
   * @returns Package with signatures appended to witness field.
   * @experimental
   */
  signPackage: (pkg: SigAllSigningPackage, privkey: string) => SigAllSigningPackage;

  /**
   * Signs a hex-encoded digest with a Schnorr key.
   */
  signDigest: (hexDigest: string, privkey: string) => string;

  /**
   * Merges signatures from a signing package back into a SwapPreview.
   *
   * @remarks
   * Injects collected signatures into the first proof's witness for mint submission. Call this
   * after all parties have signed.
   * @param pkg Signing package with collected signatures.
   * @param preview Original SwapPreview.
   * @returns SwapPreview ready for completeSwap.
   * @experimental
   */
  mergeSwapPackage: (pkg: SigAllSigningPackage, preview: SwapPreview) => SwapPreview;

  /**
   * Merges signatures from a signing package back into a MeltPreview.
   *
   * @param pkg Signing package with collected signatures.
   * @param preview Original MeltPreview.
   * @returns MeltPreview ready for completeMelt.
   * @experimental
   */
  mergeMeltPackage: <TQuote extends Pick<MeltQuoteBaseResponse, 'quote'>>(
    pkg: SigAllSigningPackage,
    preview: MeltPreview<TQuote>,
  ) => MeltPreview<TQuote>;
};

/**
 * @experimental
 */
export const SigAll: SigAllApi = {
  computeDigests,
  extractSwapPackage,
  extractMeltPackage,
  serializePackage,
  deserializePackage,
  signPackage,
  signDigest: schnorrSignDigest,
  mergeSwapPackage,
  mergeMeltPackage,
};
