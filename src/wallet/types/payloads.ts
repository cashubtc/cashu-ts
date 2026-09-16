import { type Amount } from '../../model/Amount';
import { type OutputDataLike } from '../../model/OutputData';
import { type MeltQuoteBaseResponse, type MintQuoteBaseResponse } from '../../model/types';
import { type Proof } from '../../model/types/proof';

/**
 * Preview of a mint transaction created by prepareMint.
 *
 * @remarks
 * Contains JSON-unsafe values (`bigint`, `Uint8Array`); persist via `serializeMintPreview` and
 * rehydrate with `deserializeMintPreview`.
 */
export interface MintPreview<
  TQuote extends Pick<MintQuoteBaseResponse, 'quote'> = MintQuoteBaseResponse,
> {
  method: string;
  /**
   * Mint Quote object.
   */
  quote: TQuote;
  /**
   * Blinding data required to construct proofs; `completeMint` sends their blinded messages.
   */
  outputData: OutputDataLike[];
  /**
   * NUT-20 signature over the quote and outputs, present when the quote is locked.
   */
  signature?: string;
  /**
   * @deprecated Temporary compatibility for legacy mints.
   */
  legacySignature?: string;
}

/**
 * Preview of a batched mint transaction created by prepareBatchMint.
 *
 * @remarks
 * Contains JSON-unsafe values (`bigint`, `Uint8Array`); persist via `serializeBatchMintPreview` and
 * rehydrate with `deserializeBatchMintPreview`.
 */
export interface BatchMintPreview<
  TQuote extends Pick<MintQuoteBaseResponse, 'quote' | 'pubkey'> = MintQuoteBaseResponse,
> {
  method: string;
  /**
   * Mint Quote objects included in this batch.
   */
  quotes: TQuote[];
  /**
   * Amount drawn from each quote, in `quotes` order.
   */
  amounts: Amount[];
  /**
   * Blinding data required to construct proofs (consolidated across all quotes).
   */
  outputData: OutputDataLike[];
  /**
   * NUT-20 signatures in `quotes` order, `null` for an unlocked quote; omitted when none is locked.
   */
  signatures?: Array<string | null>;
  /**
   * @deprecated Temporary compatibility for legacy mints.
   */
  legacySignatures?: Array<string | null>;
}

/**
 * Preview of a Melt transaction created by prepareMelt.
 *
 * @remarks
 * Contains JSON-unsafe values (`bigint`, `Uint8Array`); persist via `serializeMeltPreview` and
 * rehydrate with `deserializeMeltPreview`.
 */
export interface MeltPreview<
  TQuote extends Pick<MeltQuoteBaseResponse, 'quote'> = MeltQuoteBaseResponse,
> {
  method: string;
  /**
   * Inputs (Proofs) to be melted.
   */
  inputs: Proof[];
  /**
   * Outputs (blinded messages) that can be filled by the mint to return overpaid fees.
   */
  outputData: OutputDataLike[];
  /**
   * Melt Quote object.
   */
  quote: TQuote;
}

/**
 * Preview of a swap transaction created by prepareSend / prepareReceive.
 *
 * @remarks
 * Contains JSON-unsafe values (`bigint`, `Uint8Array`); persist via `serializeSwapPreview` and
 * rehydrate with `deserializeSwapPreview`.
 */
export type SwapPreview = {
  /**
   * Amount being sent or received (excluding fees).
   */
  amount: Amount;
  /**
   * Total fees for the swap (inc receiver's fees if applicable)
   */
  fees: Amount;
  /**
   * Input Proofs for this transaction.
   */
  inputs: Proof[];
  /**
   * Blinding data to construct proofs to send.
   */
  sendOutputs?: OutputDataLike[];
  /**
   * Blinding data to construct proofs to keep.
   */
  keepOutputs?: OutputDataLike[];
  /**
   * Proofs not selected for this transaction (can be returned to storage).
   */
  unselectedProofs?: Proof[];
};
