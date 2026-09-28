import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { OutputData, type SerializedOutputData } from '../model/OutputData';
import type { Proof } from '../model/types/proof';
import { normalizeProofAmounts } from '../utils';

import {
  type BatchMintPreview,
  type MeltPreview,
  type MintPreview,
  type SwapPreview,
  type TransactionPreview,
} from './types/payloads';

/**
 * A {@link Proof} with its amount as a decimal string; JSON-safe.
 */
export type SerializedProof = Omit<Proof, 'amount'> & { amount: string };

/**
 * JSON-safe representation of a {@link SwapPreview}.
 */
export type SerializedSwapPreview = {
  amount: string;
  fees: string;
  inputs: SerializedProof[];
  sendOutputs?: SerializedOutputData[];
  keepOutputs?: SerializedOutputData[];
};

/**
 * JSON-safe representation of a {@link MintPreview}.
 *
 * @remarks
 * Only the quote id is kept: `completeMint` needs nothing else from the quote.
 */
export type SerializedMintPreview = {
  method: string;
  quote: string;
  outputData: SerializedOutputData[];
  signature?: string;
  legacySignature?: string;
};

/**
 * JSON-safe representation of a {@link BatchMintPreview}.
 *
 * @remarks
 * Only the quote ids are kept: `completeBatchMint` needs nothing else from the quotes. `amounts`
 * are decimal strings in `quotes` order.
 */
export type SerializedBatchMintPreview = {
  method: string;
  quotes: string[];
  amounts: string[];
  outputData: SerializedOutputData[];
  signatures?: Array<string | null>;
  legacySignatures?: Array<string | null>;
};

/**
 * JSON-safe representation of a {@link MeltPreview}.
 *
 * @remarks
 * Keeps the quote id and, when the quote states it, the quote amount as a decimal string: v3 inputs
 * sign over it in `completeMelt`. `inputs` are spendable bearer material.
 */
export type SerializedMeltPreview = {
  method: string;
  quote: string;
  amount?: string;
  inputs: SerializedProof[];
  outputData: SerializedOutputData[];
};

function serializeProof(proof: Proof): SerializedProof {
  return { ...proof, amount: proof.amount.toString() };
}

/**
 * Converts a swap preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeSwap` to support NUT-19 replay safety: a preview rehydrated
 * with {@link deserializeSwapPreview} replays a byte-identical swap request.
 *
 * The result holds `inputs` in the clear, so it is spendable bearer material: store it as carefully
 * as the proof database.
 */
export function serializeSwapPreview(preview: SwapPreview): SerializedSwapPreview {
  return {
    amount: preview.amount.toString(),
    fees: preview.fees.toString(),
    inputs: preview.inputs.map(serializeProof),
    ...(preview.sendOutputs && {
      sendOutputs: preview.sendOutputs.map((o) => OutputData.serialize(o)),
    }),
    ...(preview.keepOutputs && {
      keepOutputs: preview.keepOutputs.map((o) => OutputData.serialize(o)),
    }),
  };
}

/**
 * Reconstructs a {@link SwapPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any field fails validation (malformed amounts, proofs, or output
 *   data).
 */
export function deserializeSwapPreview(serialized: SerializedSwapPreview): SwapPreview {
  try {
    const sendOutputs = serialized.sendOutputs?.map((s) => OutputData.deserialize(s));
    return {
      amount: Amount.from(serialized.amount),
      fees: Amount.from(serialized.fees),
      sendTotal: Amount.sum((sendOutputs ?? []).map((o) => o.blindedMessage.amount)),
      inputs: normalizeProofAmounts(serialized.inputs),
      ...(sendOutputs && { sendOutputs }),
      ...(serialized.keepOutputs && {
        keepOutputs: serialized.keepOutputs.map((s) => OutputData.deserialize(s)),
      }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CTSError(`Invalid SerializedSwapPreview: ${message}`, { cause: e });
  }
}

function deserializeWith<T>(name: string, build: () => T): T {
  try {
    return build();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CTSError(`Invalid ${name}: ${message}`, { cause: e });
  }
}

/**
 * Converts a mint preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeMint` to support NUT-19 replay safety: a preview rehydrated
 * with {@link deserializeMintPreview} replays a byte-identical mint request.
 */
export function serializeMintPreview(
  preview: MintPreview<{ quote: string }>,
): SerializedMintPreview {
  return {
    method: preview.method,
    quote: preview.quote.quote,
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
    ...(preview.signature !== undefined && { signature: preview.signature }),
    ...(preview.legacySignature !== undefined && { legacySignature: preview.legacySignature }),
  };
}

/**
 * Reconstructs a {@link MintPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any output data fails validation.
 */
export function deserializeMintPreview(
  serialized: SerializedMintPreview,
): MintPreview<{ quote: string }> {
  return deserializeWith('SerializedMintPreview', () => ({
    method: serialized.method,
    quote: { quote: serialized.quote },
    outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
    ...(serialized.signature !== undefined && { signature: serialized.signature }),
    ...(serialized.legacySignature !== undefined && {
      legacySignature: serialized.legacySignature,
    }),
  }));
}

/**
 * Converts a batch mint preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeBatchMint` to support NUT-19 replay safety: a preview
 * rehydrated with {@link deserializeBatchMintPreview} replays a byte-identical request.
 */
export function serializeBatchMintPreview(
  preview: BatchMintPreview<{ quote: string }>,
): SerializedBatchMintPreview {
  return {
    method: preview.method,
    quotes: preview.quotes.map((q) => q.quote),
    amounts: preview.amounts.map((a) => a.toString()),
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
    ...(preview.signatures && { signatures: preview.signatures }),
    ...(preview.legacySignatures && { legacySignatures: preview.legacySignatures }),
  };
}

/**
 * Reconstructs a {@link BatchMintPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any amount or output data fails validation.
 */
export function deserializeBatchMintPreview(
  serialized: SerializedBatchMintPreview,
): BatchMintPreview<{ quote: string }> {
  return deserializeWith('SerializedBatchMintPreview', () => ({
    method: serialized.method,
    quotes: serialized.quotes.map((quote) => ({ quote })),
    amounts: serialized.amounts.map((a) => Amount.from(a)),
    outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
    ...(serialized.signatures && { signatures: serialized.signatures }),
    ...(serialized.legacySignatures && { legacySignatures: serialized.legacySignatures }),
  }));
}

/**
 * Converts a melt preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeMelt` to support NUT-19 replay safety: a preview rehydrated
 * with {@link deserializeMeltPreview} replays a byte-identical melt request.
 *
 * The result holds `inputs` in the clear, so it is spendable bearer material: store it as carefully
 * as the proof database.
 */
export function serializeMeltPreview(
  preview: MeltPreview<{ quote: string; amount?: Amount }>,
): SerializedMeltPreview {
  return {
    method: preview.method,
    quote: preview.quote.quote,
    ...(preview.quote.amount !== undefined && { amount: preview.quote.amount.toString() }),
    inputs: preview.inputs.map(serializeProof),
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
  };
}

/**
 * Reconstructs a {@link MeltPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any amount, proof or output data fails validation.
 */
export function deserializeMeltPreview(
  serialized: SerializedMeltPreview,
): MeltPreview<{ quote: string; amount?: Amount }> {
  return deserializeWith('SerializedMeltPreview', () => ({
    method: serialized.method,
    quote: {
      quote: serialized.quote,
      ...(serialized.amount !== undefined && { amount: Amount.from(serialized.amount) }),
    },
    inputs: normalizeProofAmounts(serialized.inputs),
    outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
  }));
}

/**
 * JSON-safe representation of a {@link TransactionPreview}.
 */
export type SerializedTransactionPreview = {
  digest: string;
  proofInputs: SerializedProof[];
  mintQuoteInputs: Array<{ quote: string; pubkey: string; amount: string }>;
  meltQuoteOutput?: {
    method: string;
    quote: string;
    amount: string;
    feeReserve: string;
    feeIndex?: number;
  };
  changePubkey?: string;
  outputData: SerializedOutputData[];
  amount: string;
  fee: string;
};

/**
 * Converts a transaction preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeTransaction`: completing the rehydrated preview posts the same
 * transaction digest, so the mint returns its record instead of spending twice. The result holds
 * `proofs` in the clear, so it is spendable bearer material.
 */
export function serializeTransactionPreview(
  preview: TransactionPreview,
): SerializedTransactionPreview {
  return {
    digest: preview.digest,
    proofInputs: preview.proofInputs.map(serializeProof),
    mintQuoteInputs: preview.mintQuoteInputs.map((q) => ({ ...q, amount: q.amount.toString() })),
    ...(preview.meltQuoteOutput && {
      meltQuoteOutput: {
        ...preview.meltQuoteOutput,
        amount: preview.meltQuoteOutput.amount.toString(),
        feeReserve: preview.meltQuoteOutput.feeReserve.toString(),
      },
    }),
    ...(preview.changePubkey && { changePubkey: preview.changePubkey }),
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
    amount: preview.amount.toString(),
    fee: preview.fee.toString(),
  };
}

/**
 * Reconstructs a {@link TransactionPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any amount, proof or output data fails validation.
 */
export function deserializeTransactionPreview(
  serialized: SerializedTransactionPreview,
): TransactionPreview {
  return deserializeWith('SerializedTransactionPreview', () => ({
    digest: serialized.digest,
    proofInputs: normalizeProofAmounts(serialized.proofInputs),
    mintQuoteInputs: serialized.mintQuoteInputs.map((q) => ({
      ...q,
      amount: Amount.from(q.amount),
    })),
    ...(serialized.meltQuoteOutput && {
      meltQuoteOutput: {
        ...serialized.meltQuoteOutput,
        amount: Amount.from(serialized.meltQuoteOutput.amount),
        feeReserve: Amount.from(serialized.meltQuoteOutput.feeReserve),
      },
    }),
    ...(serialized.changePubkey && { changePubkey: serialized.changePubkey }),
    outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
    amount: Amount.from(serialized.amount),
    fee: Amount.from(serialized.fee),
  }));
}
