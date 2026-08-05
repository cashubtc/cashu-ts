import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { Amount } from '../model/Amount';
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
   * The proof's secret: a v3 point `P` as 33-byte compressed SEC1 hex, or a v0-v2 secret verbatim,
   * which a mixed transaction carries alongside v3 inputs (spec 5).
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
  // Normalize rather than trust the declared type: types are erased at the JS boundary, and an
  // amount that is not a bigint (an Amount instance, a decimal string) would otherwise encode to
  // different bytes, so the signature would be over a digest the mint never computes and the proof
  // would look stuck for no visible reason.
  const value = Amount.from(amount).toBigInt();
  if (value < 0n) {
    throw new CTSError('Transcript amount must be non-negative');
  }
  return tlvRecord(0x01, minimalBE(value));
}

function proofInputContainer(input: TranscriptProofInput): Uint8Array {
  // A v3 secret contributes its raw 33 bytes; a v0-v2 secret its utf8 bytes.
  const secret = /^0[23][0-9a-f]{64}$/.test(input.secret)
    ? Bytes.fromHex(input.secret)
    : new TextEncoder().encode(input.secret);
  if (secret.length === 0) {
    throw new CTSError('Transcript proof secret must be non-empty');
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

/**
 * Key-path witness for one input: a BIP-340 signature over the transaction digest.
 *
 * @remarks
 * Returns the witness JSON string (`{"signatures":[hex]}`, the spec's worked-example shape). The
 * key must be the secret's key: `k` for a bare secret, `p' = k + t` for a tweaked one.
 */
export function signTransactionInput(digest: Uint8Array, secretKey: Uint8Array): string {
  if (digest.length !== 32) {
    throw new CTSError('Transaction digest must be 32 bytes');
  }
  const signature = schnorr.sign(digest, secretKey);
  return JSON.stringify({ signatures: [Bytes.toHex(signature)] });
}

/**
 * Verify one input's key-path witness against its 33-byte secret.
 */
export function verifyTransactionInputWitness(
  digest: Uint8Array,
  secretHex: string,
  witnessJson: string,
): boolean {
  const secret = Bytes.fromHex(secretHex);
  if (secret.length !== 33) return false;
  let signatures: unknown;
  try {
    signatures = (JSON.parse(witnessJson) as { signatures?: unknown }).signatures;
  } catch {
    return false;
  }
  if (!Array.isArray(signatures) || signatures.length === 0) return false;
  const sig: unknown = signatures[0];
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return false;
  return schnorr.verify(Bytes.fromHex(sig), digest, secret.subarray(1));
}
