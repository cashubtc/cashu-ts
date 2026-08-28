import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { Amount, type AmountLike } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { Bytes, isValidHex } from '../utils';

import { isBlsKeyset } from './curves';
import { minimalBE, tlvRecord } from './nutroot';

/**
 * Transaction transcript (NUT-10): the one message every input signs.
 *
 * @remarks
 * `msg = domain tag || TLV stream`; each input carries one BIP-340 signature over `SHA256(msg)`.
 * Containers: 0x01 proof input, 0x02 mint quote input, 0x03 blinded message output, 0x04 melt quote
 * output. Container types ascend (inputs before outputs by construction); elements keep request
 * order within their type; field streams inside are ascending unique (NUT-10).
 */

export const TRANSCRIPT_DOMAIN_TAG = 'Cashu_Transaction_v1';

const CONTAINER_PROOF_INPUT = 0x01;
const CONTAINER_MINT_QUOTE_INPUT = 0x02;
const CONTAINER_BLINDED_OUTPUT = 0x03;
const CONTAINER_MELT_QUOTE_OUTPUT = 0x04;
const CONTAINER_AUTHORIZED_REQUEST = 0x05;

export type TranscriptProofInput = {
  amount: bigint;
  keysetId: string;
  /**
   * The proof's secret: a v3 point `P` as 33-byte compressed SEC1 hex, or a v0-v2 secret verbatim,
   * which a mixed transaction carries alongside v3 inputs (NUT-10).
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
  /* v8 ignore next 3 -- unreachable: Amount.from refuses negatives first */
  if (value < 0n) {
    throw new CTSError('Transcript amount must be non-negative');
  }
  return tlvRecord(0x01, minimalBE(value));
}

/**
 * A keyset id as transcript bytes: raw bytes when it is hex, utf8 otherwise.
 *
 * @remarks
 * Legacy (pre-v1) keyset ids are base64, not hex, and a mixed transaction may carry one beside a v3
 * input. Hex-decoding unconditionally turns that into an exception rather than a transcript, so
 * such a transaction could be neither signed nor verified. Falling back to utf8 is the same rule
 * the secret already follows.
 */
function keysetIdBytes(keysetId: string): Uint8Array {
  if (keysetId.length === 0) {
    throw new CTSError('Transcript keyset id must be non-empty');
  }
  return isValidHex(keysetId) ? Bytes.fromHex(keysetId) : utf8ToBytes(keysetId);
}

function proofInputContainer(input: TranscriptProofInput): Uint8Array {
  // A v3 secret contributes its raw 33 bytes; a v0-v2 secret its utf8 bytes.
  const secret = isBlsKeyset(input.keysetId)
    ? Bytes.fromHex(input.secret)
    : new TextEncoder().encode(input.secret);
  if (secret.length === 0) {
    throw new CTSError('Transcript proof secret must be non-empty');
  }
  return tlvRecord(
    CONTAINER_PROOF_INPUT,
    Bytes.concat(
      amountRecord(input.amount),
      tlvRecord(0x02, keysetIdBytes(input.keysetId)),
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
      tlvRecord(0x02, keysetIdBytes(output.keysetId)),
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
 * The bytes every input signs over, before hashing: `domain tag || transcript`.
 *
 * @remarks
 * A signer handed this rather than the digest can hash it itself and refuse anything that does not
 * carry the tag, so it can never be tricked into signing some other 32 bytes.
 */
export function transactionMessage(tx: TransactionShape): Uint8Array {
  return Bytes.concat(utf8ToBytes(TRANSCRIPT_DOMAIN_TAG), buildTransactionTranscript(tx));
}

/**
 * The 32-byte digest every input signs: `SHA256(domain tag || transcript)`.
 */
export function transactionDigest(tx: TransactionShape): Uint8Array {
  return sha256(transactionMessage(tx));
}

type PayloadShape = {
  inputs?: Array<{ amount: AmountLike; id: string; secret: string; C: string }>;
  mintQuotes?: Array<{ quoteId: string; amount: AmountLike }>;
  outputs?: Array<{ amount: AmountLike; id: string; B_: string }>;
  meltQuote?: { quoteId: string; amount: AmountLike };
};

/**
 * {@link transactionDigest} over payload wire shapes: proofs, quotes and blinded messages as the
 * request carries them, amounts in any {@link AmountLike} form.
 */
export function digestForPayload(payload: PayloadShape): Uint8Array {
  return sha256(messageForPayload(payload));
}

/**
 * {@link transactionMessage} over payload wire shapes; see {@link digestForPayload}.
 */
export function messageForPayload(payload: PayloadShape): Uint8Array {
  const quote = (q: { quoteId: string; amount: AmountLike }): TranscriptQuote => ({
    amount: Amount.from(q.amount).toBigInt(),
    quoteId: q.quoteId,
  });
  return transactionMessage({
    ...(payload.inputs && {
      proofInputs: payload.inputs.map((p) => ({
        amount: Amount.from(p.amount).toBigInt(),
        keysetId: p.id,
        secret: p.secret,
        C: p.C,
      })),
    }),
    ...(payload.mintQuotes && { mintQuoteInputs: payload.mintQuotes.map(quote) }),
    ...(payload.outputs && {
      blindedOutputs: payload.outputs.map((o) => ({
        amount: Amount.from(o.amount).toBigInt(),
        keysetId: o.id,
        B_: o.B_,
      })),
    }),
    ...(payload.meltQuote && { meltQuoteOutputs: [quote(payload.meltQuote)] }),
  });
}

/**
 * Serialize a request to its authorized-request transcript (NUT-22).
 *
 * @remarks
 * One 0x05 container: 01 the uppercase HTTP method, 02 the origin-form request-target as sent, 03
 * SHA256 over the exact body bytes (a request without a body hashes the empty byte string).
 */
export function buildRequestTranscript(
  method: string,
  target: string,
  body: Uint8Array,
): Uint8Array {
  if (!method || !target) {
    throw new CTSError('Request transcript requires a method and a target');
  }
  return tlvRecord(
    CONTAINER_AUTHORIZED_REQUEST,
    Bytes.concat(
      tlvRecord(0x01, utf8ToBytes(method.toUpperCase())),
      tlvRecord(0x02, utf8ToBytes(target)),
      tlvRecord(0x03, sha256(body)),
    ),
  );
}

/**
 * The 32-byte digest a version 02 BAT witness signs (NUT-22).
 */
export function requestDigest(method: string, target: string, body: Uint8Array): Uint8Array {
  return sha256(
    Bytes.concat(utf8ToBytes(TRANSCRIPT_DOMAIN_TAG), buildRequestTranscript(method, target, body)),
  );
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
  // Exactly one entry (NUT-10): a doubled signature invalidates the witness.
  if (!Array.isArray(signatures) || signatures.length !== 1) return false;
  const sig: unknown = signatures[0];
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return false;
  try {
    return schnorr.verify(Bytes.fromHex(sig), digest, secret.subarray(1));
  } catch {
    return false;
  }
}
