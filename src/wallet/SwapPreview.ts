import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { OutputData, type SerializedOutputData } from '../model/OutputData';
import type { Proof } from '../model/types/proof';
import { ABSOLUTE_MAX_ARRAY_LENGTH, normalizeProofAmounts } from '../utils';

import { type SwapPreview } from './types/payloads';

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
  keysetId: string;
  inputs: SerializedProof[];
  sendOutputs?: SerializedOutputData[];
  keepOutputs?: SerializedOutputData[];
};

function serializeProof(proof: Proof): SerializedProof {
  return { ...proof, amount: proof.amount.toString() };
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
 * Persist the result before `completeSwap` to support NUT-19 replay safety: a preview rehydrated
 * with {@link deserializeSwapPreview} replays a byte-identical swap request.
 *
 * The result holds `inputs` in the clear, so it is spendable bearer material: store it as carefully
 * as the proof database. `unselectedProofs` take no part in the replay and are not included; return
 * them to storage separately.
 */
export function serializeSwapPreview(preview: SwapPreview): SerializedSwapPreview {
  return {
    amount: preview.amount.toString(),
    fees: preview.fees.toString(),
    keysetId: preview.keysetId,
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
    assertMaxEntries('inputs', serialized.inputs);
    // Keep and send travel in one outputs array.
    assertMaxEntries('outputs', serialized.sendOutputs, serialized.keepOutputs);
    return {
      amount: Amount.from(serialized.amount),
      fees: Amount.from(serialized.fees),
      keysetId: serialized.keysetId,
      inputs: normalizeProofAmounts(serialized.inputs),
      ...(serialized.sendOutputs && {
        sendOutputs: serialized.sendOutputs.map((s) => OutputData.deserialize(s)),
      }),
      ...(serialized.keepOutputs && {
        keepOutputs: serialized.keepOutputs.map((s) => OutputData.deserialize(s)),
      }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CTSError(`Invalid SerializedSwapPreview: ${message}`, { cause: e });
  }
}
