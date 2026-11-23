import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { OutputData, type SerializedOutputData } from '../model/OutputData';
import type { Proof } from '../model/types/proof';
import { ABSOLUTE_MAX_ARRAY_LENGTH, normalizeProofAmounts } from '../utils';

import {
  type BatchMintPreview,
  type MeltPreview,
  type MintPreview,
  type SwapPreview,
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
  mintPubkey?: string;
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
  mintPubkey?: string;
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
  mintPubkey?: string;
};

/**
 * JSON-safe representation of a {@link MeltPreview}.
 *
 * @remarks
 * Keeps the quote id and, where the quote states them, its amount and fee reserves as decimal
 * strings: v3 inputs sign over them in `completeMelt`. `inputs` are spendable bearer material.
 */
export type SerializedMeltPreview = {
  method: string;
  quote: string;
  amount?: string;
  fee_reserve?: string;
  fee_options?: Array<{ fee_index: number; fee_reserve: string }>;
  inputs: SerializedProof[];
  outputData: SerializedOutputData[];
  mintPubkey?: string;
};

function serializeProof(proof: Proof): SerializedProof {
  return { ...proof, amount: proof.amount.toString() };
}

function mintPubkeyOf(preview: { mintPubkey?: string }): { mintPubkey?: string } {
  return preview.mintPubkey == null ? {} : { mintPubkey: preview.mintPubkey };
}

/**
 * Refuses lists that together exceed what one request array can carry, before any per-entry work.
 */
function assertMaxEntries(field: string, ...lists: Array<unknown[] | undefined>): void {
  const count = lists.reduce((n, list) => n + (list?.length ?? 0), 0);
  if (count > ABSOLUTE_MAX_ARRAY_LENGTH) {
    throw new CTSError(`too many ${field}: ${count}, maximum is ${ABSOLUTE_MAX_ARRAY_LENGTH}`);
  }
}

/**
 * Converts a swap preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeSwap` to support NUT-19 replay safety: a preview signed with
 * `wallet.signSwapPreview` first, then rehydrated with {@link deserializeSwapPreview}, replays a
 * byte-identical swap request.
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
    ...mintPubkeyOf(preview),
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
    assertMaxEntries('inputs', serialized.inputs);
    // Keep and send travel in one outputs array.
    assertMaxEntries('outputs', serialized.sendOutputs, serialized.keepOutputs);
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
      ...mintPubkeyOf(serialized),
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
    ...mintPubkeyOf(preview),
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
  return deserializeWith('SerializedMintPreview', () => {
    assertMaxEntries('outputData', serialized.outputData);
    return {
      method: serialized.method,
      quote: { quote: serialized.quote },
      outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
      ...(serialized.signature !== undefined && { signature: serialized.signature }),
      ...(serialized.legacySignature !== undefined && {
        legacySignature: serialized.legacySignature,
      }),
      ...mintPubkeyOf(serialized),
    };
  });
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
    ...mintPubkeyOf(preview),
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
  return deserializeWith('SerializedBatchMintPreview', () => {
    assertMaxEntries('quotes', serialized.quotes);
    assertMaxEntries('amounts', serialized.amounts);
    assertMaxEntries('outputData', serialized.outputData);
    assertMaxEntries('signatures', serialized.signatures);
    assertMaxEntries('legacySignatures', serialized.legacySignatures);
    return {
      method: serialized.method,
      quotes: serialized.quotes.map((quote) => ({ quote })),
      amounts: serialized.amounts.map((a) => Amount.from(a)),
      outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
      ...(serialized.signatures && { signatures: serialized.signatures }),
      ...(serialized.legacySignatures && { legacySignatures: serialized.legacySignatures }),
      ...mintPubkeyOf(serialized),
    };
  });
}

/**
 * Converts a melt preview to a JSON-safe form for persistence.
 *
 * @remarks
 * Persist the result before `completeMelt` to support NUT-19 replay safety. A preview rehydrated
 * with {@link deserializeMeltPreview} replays the same melt request, except that `completeMelt`
 * signs v3 inputs (and P2PK inputs, given a key) afresh, so those replays miss the mint's cache.
 *
 * The result holds `inputs` in the clear, so it is spendable bearer material: store it as carefully
 * as the proof database.
 */
export function serializeMeltPreview(
  preview: MeltPreview<{
    quote: string;
    amount?: Amount;
    fee_reserve?: Amount;
    fee_options?: Array<{ fee_index: number; fee_reserve: Amount }>;
  }>,
): SerializedMeltPreview {
  const { amount, fee_reserve, fee_options } = preview.quote;
  return {
    method: preview.method,
    quote: preview.quote.quote,
    ...(amount !== undefined && { amount: amount.toString() }),
    ...(fee_reserve !== undefined && { fee_reserve: fee_reserve.toString() }),
    ...(fee_options && {
      fee_options: fee_options.map((o) => ({
        fee_index: o.fee_index,
        fee_reserve: o.fee_reserve.toString(),
      })),
    }),
    inputs: preview.inputs.map(serializeProof),
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
    ...mintPubkeyOf(preview),
  };
}

/**
 * Reconstructs a {@link MeltPreview} from its JSON-safe representation.
 *
 * @throws {@link CTSError} If any amount, proof or output data fails validation.
 */
export function deserializeMeltPreview(serialized: SerializedMeltPreview): MeltPreview<{
  quote: string;
  amount?: Amount;
  fee_reserve?: Amount;
  fee_options?: Array<{ fee_index: number; fee_reserve: Amount }>;
}> {
  return deserializeWith('SerializedMeltPreview', () => {
    const { amount, fee_reserve, fee_options } = serialized;
    assertMaxEntries('inputs', serialized.inputs);
    assertMaxEntries('outputData', serialized.outputData);
    assertMaxEntries('fee_options', fee_options);
    return {
      method: serialized.method,
      quote: {
        quote: serialized.quote,
        ...(amount !== undefined && { amount: Amount.from(amount) }),
        ...(fee_reserve !== undefined && { fee_reserve: Amount.from(fee_reserve) }),
        ...(fee_options && {
          fee_options: fee_options.map((o) => ({
            fee_index: o.fee_index,
            fee_reserve: Amount.from(o.fee_reserve),
          })),
        }),
      },
      inputs: normalizeProofAmounts(serialized.inputs),
      outputData: serialized.outputData.map((s) => OutputData.deserialize(s)),
      ...mintPubkeyOf(serialized),
    };
  });
}
