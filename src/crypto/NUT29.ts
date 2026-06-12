import { schnorr } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { Amount } from '../model/Amount';
import { type SerializedBlindedMessage } from '../model/types';

// Domain-separation tag.
const NUT29_DST = utf8ToBytes('Cashu_MintQuoteSig_v1');

// Canonical minimal BE bytes of a non-negative amount (0 → empty, 1 → 0x01, 256 → 0x0100).
// Amount.from defensively normalizes a raw JSON number/string (Amount passes through).
function amountToMinimalBytes(blindedMessage: SerializedBlindedMessage): Uint8Array {
  const value = Amount.from(blindedMessage.amount).toBigInt();
  if (value === 0n) return new Uint8Array(0);
  const hex = value.toString(16);
  return hexToBytes(hex.length % 2 === 1 ? '0' + hex : hex);
}

/**
 * Amended mint-quote signature message (cashubtc/nuts#375): domain-separated and length-framed,
 * shared by NUT-20 single and NUT-29 batch minting. Mints predating the amendment only verify the
 * legacy message in `NUT20.ts` — see `wallet/mintCompat.ts`.
 */
function constructBatchMessage(
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): Uint8Array {
  // Stream into the digest rather than concat-then-hash: spreading the per-output chunks into
  // concatBytes(...) would hit V8's argument-count limit on large batches.
  const transcript = sha256.create();
  transcript.update(NUT29_DST);
  const quoteBytes = utf8ToBytes(quote);
  transcript.update(numberToBytesBE(quoteBytes.length, 4));
  transcript.update(quoteBytes);
  for (const blindedMessage of blindedMessages) {
    const amountBytes = amountToMinimalBytes(blindedMessage);
    transcript.update(numberToBytesBE(amountBytes.length, 4));
    transcript.update(amountBytes);
    const pointBytes = hexToBytes(blindedMessage.B_);
    transcript.update(numberToBytesBE(pointBytes.length, 4));
    transcript.update(pointBytes);
  }
  return transcript.digest();
}

export function signBatchMintQuote(
  privkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): string {
  const message = constructBatchMessage(quote, blindedMessages);
  const signature = schnorr.sign(message, hexToBytes(privkey));
  return bytesToHex(signature);
}

export function verifyBatchMintQuoteSignature(
  pubkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
  signature: string,
): boolean {
  let pubkeyBytes = hexToBytes(pubkey);
  if (pubkeyBytes.length !== 33) return false;
  pubkeyBytes = pubkeyBytes.slice(1);
  const message = constructBatchMessage(quote, blindedMessages);
  return schnorr.verify(hexToBytes(signature), message, pubkeyBytes);
}
