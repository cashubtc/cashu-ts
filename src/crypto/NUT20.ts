import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { type SerializedBlindedMessage } from '../model/types';

/**
 * Legacy NUT-20 mint-quote signature message: `quote || B_0 || … || B_(n-1)`, hex strings
 * concatenated as UTF-8. cashubtc/nuts#375 replaces this with the domain-separated, length-framed
 * message in `NUT29.ts` for both single (NUT-20) and batch (NUT-29) minting. Kept for mints that
 * predate the amendment — see `wallet/mintCompat.ts`.
 */
function constructMessage(quote: string, blindedMessages: SerializedBlindedMessage[]): Uint8Array {
  let message = quote;
  for (const blindedMessage of blindedMessages) {
    message += blindedMessage.B_;
  }
  const msgbytes = new TextEncoder().encode(message);
  return sha256(msgbytes);
}

export function signMintQuote(
  privkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
): string {
  const message = constructMessage(quote, blindedMessages);
  const privkeyBytes = hexToBytes(privkey);
  const signature = schnorr.sign(message, privkeyBytes);
  return bytesToHex(signature);
}

export function verifyMintQuoteSignature(
  pubkey: string,
  quote: string,
  blindedMessages: SerializedBlindedMessage[],
  signature: string,
): boolean {
  const sigbytes = hexToBytes(signature);
  let pubkeyBytes = hexToBytes(pubkey);
  if (pubkeyBytes.length !== 33) return false;
  pubkeyBytes = pubkeyBytes.slice(1);
  const message = constructMessage(quote, blindedMessages);
  return schnorr.verify(sigbytes, message, pubkeyBytes);
}
