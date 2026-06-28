import { bytesToHex, hexToBytes, randomBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { type Logger, NULL_LOGGER } from '../logger';
import { CTSError } from '../model/Errors';
import { type HTLCWitness, type Proof } from '../model/types';

import {
  assertSecretKind,
  createSecret,
  type Secret,
  getDataField,
  parseSecret,
  getSecretKind,
} from './NUT10';
import { type P2PKVerificationResult, verifyP2PKSpendingConditions } from './NUT11';

// ------------------------------
// NUT-14 Secrets
// ------------------------------

/**
 * Create an HTLC secret.
 *
 * @remarks
 * Use `createHTLCHash()` for hash creation.
 * @param hash - The HTLC hash to add to Secret.data.
 * @param tags - Optional. Additional P2PK tags.
 */
export function createHTLCsecret(hash: string, tags?: string[][]): string {
  return createSecret('HTLC', hash, tags);
}

/**
 * Parse an HTLC Secret and validate NUT-10 shape.
 *
 * @param secret - The Proof secret.
 * @returns Secret object.
 * @throws If the JSON is invalid or NUT-10 secret is malformed.
 */
export function parseHTLCSecret(secret: string | Secret): Secret {
  return assertSecretKind('HTLC', secret);
}

// ------------------------------
// Creating and Verifying Hashes
// ------------------------------

/**
 * Create an HTLC hash/preimage pair.
 *
 * @param preimage - Optional. Preimage to use (Default: random preimage)
 * @returns Hash and preimage pair.
 * @throws If the preimage supplied is not a 64-char hex string.
 */
export function createHTLCHash(preimage?: string): { hash: string; preimage: string } {
  const hasPreimage = preimage !== undefined;
  if (hasPreimage && !/^[0-9a-f]{64}$/i.test(preimage)) {
    throw new CTSError('Preimage must be a 64 character hexadecimal string (32 bytes).');
  }
  // Create hash
  const piBytes = hasPreimage ? hexToBytes(preimage) : randomBytes(32);
  const hash = bytesToHex(sha256(piBytes));
  return { hash, preimage: bytesToHex(piBytes) };
}

/**
 * Verify an HTLC hash/preimage pair.
 *
 * @param preimage - As a 64-character lowercase hexadecimal string.
 * @param hash - As a 64-character lowercase hexadecimal string.
 * @returns True if preimage calculates the same hash, False otherwise.
 */
export function verifyHTLCHash(preimage: string, hash: string): boolean {
  const { hash: valid } = createHTLCHash(preimage);
  return hash === valid;
}

/**
 * Verify HTLC spending conditions for a single input.
 *
 * Two spending paths are available:
 *
 * 1. Hashlock path: Preimage + signatures from the main pubkeys (always valid)
 * 2. Refund path: signatures from refund pubkeys (only valid after locktime)
 *
 * In addition, if the lock has expired and no refund keys are present, the proof is considered
 * unlocked and spendable without witness signatures.
 *
 * @remarks
 * Returns a detailed P2PKVerificationResult showing the conditions. If you just want a boolean
 * result, use isP2PKSpendAuthorised().
 * @param proof - The Proof to check.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns A P2PKVerificationResult describing the spending outcome.
 * @throws If verification is impossible.
 */
export function verifyHTLCSpendingConditions(
  proof: Proof,
  logger: Logger = NULL_LOGGER,
  message?: string,
): P2PKVerificationResult {
  // Init
  let result: P2PKVerificationResult;
  message = message ?? proof.secret; // default message is proof secret

  // Verify the underlying P2PK conditions first. Only the hashlock (receiver)
  // pathway is HTLC-specific; the refund and unlocked outcomes are plain P2PK
  // verdicts and pass straight through.
  const secret = parseSecret(proof.secret); // no assert
  const p2pkResult = verifyP2PKSpendingConditions(proof, logger, message);
  if (getSecretKind(secret) !== 'HTLC') {
    return p2pkResult; // not an HTLC proof
  }

  // Receiver pathway (NUT-14): always available to receivers — even during an
  // active locktime or with refund keys present — given the preimage plus, when
  // main pubkeys exist, their signature threshold. A hashlock-only HTLC has no
  // main keys and so no threshold, so the preimage alone authorises it.
  const hashlockOnly = p2pkResult.main.pubkeys.length === 0;

  // Keyed HTLC: the main signatures must meet the threshold (a 'MAIN' verdict).
  if (!hashlockOnly && p2pkResult.path !== 'MAIN') {
    return p2pkResult; // threshold not met: defer to the P2PK verdict
  }
  // Keyless HTLC never yields 'MAIN' (no keys to sign), so the guard above can't
  // gate it. If another pathway already authorised the spend (e.g. expired with
  // no refund keys = anyone-can-spend), keep that verdict; no preimage needed.
  if (hashlockOnly && p2pkResult.success) {
    return p2pkResult;
  }

  // From here, the spend depends solely on a valid preimage.
  const preimage = getHTLCWitnessPreimage(proof.witness);
  if (!preimage) {
    result = { ...p2pkResult, success: false, path: 'FAILED' };
    logger.debug('Hashlock spend failed, no preimage found', { result });
    return result;
  }

  // Confirm the preimage hashes to the lock in Secret.data.
  const hash = getDataField(secret);
  if (verifyHTLCHash(preimage, hash)) {
    // Authorised via the receiver pathway. A keyless HTLC carries a FAILED P2PK
    // verdict (no keys to meet a threshold), so stamp the successful MAIN result.
    result = { ...p2pkResult, success: true, path: 'MAIN' };
    logger.debug('Spending condition satisfied via hashlock (receiver) pathway', { result });
    return result;
  }

  // Preimage present but does not match the hash lock.
  result = { ...p2pkResult, success: false, path: 'FAILED' };
  logger.debug('Hashlock spend failed, wrong preimage for hash', { result });
  return result;
}

/**
 * Verify HTLC spending conditions for a single input.
 *
 * @param proof - The Proof to check.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns True if spending conditions are satisfied, false otherwise.
 * @throws If verification is impossible.
 */
export function isHTLCSpendAuthorised(
  proof: Proof,
  logger: Logger = NULL_LOGGER,
  message?: string,
): boolean {
  return verifyHTLCSpendingConditions(proof, logger, message).success;
}

/**
 * Get preimage from a witness if present.
 *
 * @param witness From a Proof.
 * @returns Preimage if present.
 */
export function getHTLCWitnessPreimage(witness: Proof['witness']): string | undefined {
  if (!witness) return undefined;
  let parsed: Partial<HTLCWitness>;
  try {
    parsed = typeof witness === 'string' ? (JSON.parse(witness) as Partial<HTLCWitness>) : witness;
  } catch (e) {
    console.error('Failed to parse HTLC witness string:', e);
    return undefined;
  }
  // Check preimage is a non-empty string
  const preimage = parsed.preimage;
  return typeof preimage === 'string' && preimage.length > 0 ? preimage : undefined;
}
