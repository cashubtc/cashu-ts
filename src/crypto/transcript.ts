import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import { minimalBE, tlvRecord } from './taproot';

/**
 * Transaction transcript (taproot secrets spec 2.2.1): the one message every input signs.
 *
 * @remarks
 * `msg = domain tag || TLV stream`; each input carries one BIP-340 signature over `SHA256(msg)`.
 * Containers: 0x01 proof input, 0x02 mint quote input, 0x03 blinded message output, 0x04 melt quote
 * output. Container types ascend (inputs before outputs by construction); elements keep request
 * order within their type; field streams inside are ascending unique (2.6).
 */

export const TRANSCRIPT_DOMAIN_TAG = 'Cashu_Transaction_v1';

const CONTAINER_PROOF_INPUT = 0x01;
const CONTAINER_MINT_QUOTE_INPUT = 0x02;
const CONTAINER_BLINDED_OUTPUT = 0x03;
const CONTAINER_MELT_QUOTE_OUTPUT = 0x04;

export type TranscriptProofInput = {
  amount: bigint;
  keysetId: string;
  /**
   * The proof's secret `P`: 33-byte compressed SEC1 hex.
   */
  secret: string;
  /**
   * The mint signature `C` hex (BLS G1 under v3 keysets).
   */
  C: string;
};

export type TranscriptQuote = {
  amount: bigint;
  quoteId: string;
};

export type TranscriptBlindedOutput = {
  amount: bigint;
  keysetId: string;
  /**
   * The blinded message `B_` hex (BLS G1 under v3 keysets).
   */
  B_: string;
};

export type TransactionShape = {
  proofInputs?: TranscriptProofInput[];
  mintQuoteInputs?: TranscriptQuote[];
  blindedOutputs?: TranscriptBlindedOutput[];
  meltQuoteOutputs?: TranscriptQuote[];
};

function amountRecord(amount: bigint): Uint8Array {
  if (amount < 0n) {
    throw new CTSError('Transcript amount must be non-negative');
  }
  return tlvRecord(0x01, minimalBE(amount));
}

function proofInputContainer(input: TranscriptProofInput): Uint8Array {
  const secret = Bytes.fromHex(input.secret);
  if (secret.length !== 33) {
    throw new CTSError('Transcript proof secret must be 33 bytes');
  }
  return tlvRecord(
    CONTAINER_PROOF_INPUT,
    Bytes.concat(
      amountRecord(input.amount),
      tlvRecord(0x02, Bytes.fromHex(input.keysetId)),
      tlvRecord(0x03, secret),
      tlvRecord(0x04, Bytes.fromHex(input.C)),
    ),
  );
}

function quoteContainer(containerType: number, quote: TranscriptQuote): Uint8Array {
  if (quote.quoteId.length === 0) {
    throw new CTSError('Transcript quote id must be non-empty');
  }
  return tlvRecord(
    containerType,
    Bytes.concat(amountRecord(quote.amount), tlvRecord(0x02, utf8ToBytes(quote.quoteId))),
  );
}

function blindedOutputContainer(output: TranscriptBlindedOutput): Uint8Array {
  return tlvRecord(
    CONTAINER_BLINDED_OUTPUT,
    Bytes.concat(
      amountRecord(output.amount),
      tlvRecord(0x02, Bytes.fromHex(output.keysetId)),
      tlvRecord(0x03, Bytes.fromHex(output.B_)),
    ),
  );
}

/**
 * Serialize a transaction to its TLV transcript (without the domain tag).
 */
export function buildTransactionTranscript(tx: TransactionShape): Uint8Array {
  const proofs = tx.proofInputs ?? [];
  const mintQuotes = tx.mintQuoteInputs ?? [];
  const blinded = tx.blindedOutputs ?? [];
  const meltQuotes = tx.meltQuoteOutputs ?? [];
  if (proofs.length + mintQuotes.length === 0) {
    throw new CTSError('Transaction requires at least one input');
  }
  if (blinded.length + meltQuotes.length === 0) {
    throw new CTSError('Transaction requires at least one output');
  }
  return Bytes.concat(
    ...proofs.map(proofInputContainer),
    ...mintQuotes.map((q) => quoteContainer(CONTAINER_MINT_QUOTE_INPUT, q)),
    ...blinded.map(blindedOutputContainer),
    ...meltQuotes.map((q) => quoteContainer(CONTAINER_MELT_QUOTE_OUTPUT, q)),
  );
}

/**
 * The 32-byte digest every input signs: `SHA256(domain tag || transcript)`.
 */
export function transactionDigest(tx: TransactionShape): Uint8Array {
  return sha256(Bytes.concat(utf8ToBytes(TRANSCRIPT_DOMAIN_TAG), buildTransactionTranscript(tx)));
}
