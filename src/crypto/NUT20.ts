import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { Amount } from '../model/Amount';
import { type SerializedBlindedMessage } from '../model/types';

import {
  schnorrSignDigest,
  schnorrSignMessage,
  schnorrVerifyDigest,
  schnorrVerifyMessage,
} from './core';

// Domain-separation tag.
const MINT_QUOTE_SIG_DST = utf8ToBytes('Cashu_MintQuoteSig_v1');

// Canonical minimal BE bytes of a non-negative amount (0 → empty, 1 → 0x01, 256 → 0x0100).
// Amount.from defensively normalizes a raw JSON number/string (Amount passes through).
function amountToMinimalBytes(blindedMessage: SerializedBlindedMessage): Uint8Array {
  const value = Amount.from(blindedMessage.amount).toBigInt();
  if (value === 0n) return new Uint8Array(0);
  const hex = value.toString(16);
  return hexToBytes(hex.length % 2 === 1 ? '0' + hex : hex);
}

/**
 * Mint-quote signature message per the amended NUT-20 (cashubtc/nuts#375): domain-separated and
 * length-framed, shared by NUT-20 single and NUT-29 batch minting.
 */
function constructMessage(quote: string, blindedMessages: SerializedBlindedMessage[]): Uint8Array {
  // Stream into the digest rather than concat-then-hash: spreading the per-output chunks into
  // concatBytes(...) would hit V8's argument-count limit on large batches.
  const transcript = sha256.create();
  transcript.update(MINT_QUOTE_SIG_DST);
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

/**
 * Legacy mint-quote signature message: `quote || B_0 || … || B_(n-1)`, hex strings concatenated as
 * UTF-8. Kept for mints that predate cashubtc/nuts#375 TODO: Remove legacy message support.
 */
function constructLegacyMessage(
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): Uint8Array {
  let message = quote;
  for (const blindedMessage of blindedMessages) {
    message += blindedMessage.B_;
  }
  return sha256(utf8ToBytes(message));
}

// NUT-20 quote pubkeys are compressed 33-byte SEC1 (66 hex chars).
function isCompressedPubkey(pubkey: string): boolean {
  return pubkey.length === 66;
}

export function signMintQuote(
  privkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): string {
  return schnorrSignDigest(constructMessage(quote, blindedMessages), privkey);
}

export function verifyMintQuoteSignature(
  pubkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
  signature: string,
): boolean {
  if (!isCompressedPubkey(pubkey)) return false;
  // Malformed outputs (negative amount, bad hex B_) must verify as false, not throw: these
  // functions take untrusted input and the boolean contract mirrors schnorrVerifyDigest's
  // own error swallowing.
  try {
    return schnorrVerifyDigest(signature, constructMessage(quote, blindedMessages), pubkey);
  } catch {
    return false;
  }
}

export function signMintQuoteLegacy(
  privkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): string {
  return schnorrSignDigest(constructLegacyMessage(quote, blindedMessages), privkey);
}

export function verifyMintQuoteSignatureLegacy(
  pubkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
  signature: string,
): boolean {
  if (!isCompressedPubkey(pubkey)) return false;
  // See verifyMintQuoteSignature: malformed input must verify as false rather than throw
  // past schnorrVerifyDigest's try/catch.
  try {
    return schnorrVerifyDigest(signature, constructLegacyMessage(quote, blindedMessages), pubkey);
  } catch {
    return false;
  }
}

// Domain-separation tag for mint quote lookup signatures (draft NUT: get quotes by pubkeys).
const MINT_QUOTE_LOOKUP_DST = 'Cashu_MintQuoteLookup_v1';

// Plain UTF-8 concat per the draft spec; hex is lowercased because the message is a string.
function constructLookupMessage(mintPubkey: string, pubkey: string): string {
  return MINT_QUOTE_LOOKUP_DST + mintPubkey.toLowerCase() + pubkey.toLowerCase();
}

/**
 * Signs a mint quote lookup request for one pubkey (draft NUT: get quotes by pubkeys).
 *
 * @remarks
 * `mintPubkey` is the mint's NUT-06 info pubkey; it binds the signature to one mint.
 */
export function signMintQuoteLookup(privkey: string, mintPubkey: string, pubkey: string): string {
  return schnorrSignMessage(constructLookupMessage(mintPubkey, pubkey), privkey);
}

/**
 * Verifies a mint quote lookup signature. Malformed input returns false, never throws.
 */
export function verifyMintQuoteLookupSignature(
  pubkey: string,
  mintPubkey: string,
  signature: string,
): boolean {
  if (!isCompressedPubkey(pubkey)) return false;
  return schnorrVerifyMessage(signature, constructLookupMessage(mintPubkey, pubkey), pubkey);
}
