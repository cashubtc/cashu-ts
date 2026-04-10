import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
  constructUnblindedSignature,
  pointFromHex,
  verifyDLEQProof,
  type DLEQ,
  type BlindSignature,
  type P2PKOptions,
} from '../crypto';
import { numberToHexPadded64 } from '../utils';

import { Amount, type AmountLike } from './Amount';
import { defaultOutputDataCreator } from './OutputDataCreator';
import {
  type HasKeysetKeys,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
  type SerializedDLEQ,
} from './types';

/**
 * Maximum secret length.
 *
 * @remarks
 * Based on the Nutshell default mint_max_secret_length.
 * @internal
 */
export const MAX_SECRET_LENGTH = 1024;

/**
 * Minimum interface for an output data object. OutputData helpers only require keyset `id` and
 * `keys`. Custom implementations must satisfy this interface to be used with wallet operations.
 */
export interface OutputDataLike {
  blindedMessage: SerializedBlindedMessage;
  blindingFactor: bigint;
  secret: Uint8Array;
  ephemeralE?: string;

  toProof: (signature: SerializedBlindedSignature, keyset: HasKeysetKeys) => Proof;
}

/**
 * Factory function that produces an {@link OutputDataLike} for a given amount and keyset. Implement
 * this to customise blinded-message construction (e.g. deterministic secrets, P2PK).
 */
export type OutputDataFactory = (amount: AmountLike, keys: HasKeysetKeys) => OutputDataLike;

/**
 * Core P2PK tags that must not be settable in additional tags.
 *
 * @internal
 */
export const RESERVED_P2PK_TAGS = new Set([
  'locktime',
  'pubkeys',
  'n_sigs',
  'refund',
  'n_sigs_refund',
  'sigflag',
]);

/**
 * Asserts P2PK Tag key is valid.
 *
 * @param key Tag Key.
 * @throws If not a string, or is a reserved string.
 */
export function assertValidTagKey(key: string) {
  if (!key || typeof key !== 'string') throw new Error('tag key must be a non empty string');
  if (RESERVED_P2PK_TAGS.has(key)) {
    throw new Error(`additionalTags must not use reserved key "${key}"`);
  }
}

export function isOutputDataFactory(
  value: OutputData[] | OutputDataFactory,
): value is OutputDataFactory {
  return typeof value === 'function';
}

export class OutputData implements OutputDataLike {
  blindedMessage: SerializedBlindedMessage;
  blindingFactor: bigint;
  secret: Uint8Array;
  ephemeralE?: string;

  constructor(
    blindedMessage: SerializedBlindedMessage,
    blindingFactor: bigint,
    secret: Uint8Array,
    ephemeralE?: string,
  ) {
    this.secret = secret;
    this.blindingFactor = blindingFactor;
    this.blindedMessage = blindedMessage;
    this.ephemeralE = ephemeralE;
  }

  toProof(sig: SerializedBlindedSignature, keyset: HasKeysetKeys) {
    let dleq: DLEQ | undefined;
    if (sig.dleq) {
      dleq = {
        s: hexToBytes(sig.dleq.s),
        e: hexToBytes(sig.dleq.e),
        r: this.blindingFactor,
      };
    }
    const sigAmountKey = sig.amount.toString();
    const A = pointFromHex(keyset.keys[sigAmountKey]);

    // NUT-12: Verify DLEQ proof if present
    if (dleq) {
      const B_ = pointFromHex(this.blindedMessage.B_);
      const C_ = pointFromHex(sig.C_);
      if (!verifyDLEQProof(dleq, B_, C_, A)) {
        throw new Error('DLEQ verification failed on mint response');
      }
    }

    const blindSig: BlindSignature = { id: sig.id, C_: pointFromHex(sig.C_) };
    const unblinded = constructUnblindedSignature(blindSig, this.blindingFactor, this.secret, A);
    const proof: Proof = {
      id: sig.id,
      amount: sig.amount.toBigInt(),
      C: unblinded.C.toHex(true),
      secret: new TextDecoder().decode(unblinded.secret),
      ...(dleq && {
        dleq: {
          s: bytesToHex(dleq.s),
          e: bytesToHex(dleq.e),
          r: numberToHexPadded64(dleq.r ?? BigInt(0)),
        } as SerializedDLEQ,
      }),
    };

    // Add P2BK (Pay to Blinded Key) blinding factors if needed
    if (this.ephemeralE) proof.p2pk_e = this.ephemeralE;

    return proof;
  }

  static createP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    return defaultOutputDataCreator.createP2PKData(p2pk, amount, keyset, customSplit);
  }

  static createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string) {
    return defaultOutputDataCreator.createSingleP2PKData(p2pk, amount, keysetId);
  }

  static createRandomData(amount: AmountLike, keyset: HasKeysetKeys, customSplit?: AmountLike[]) {
    return defaultOutputDataCreator.createRandomData(amount, keyset, customSplit);
  }

  static createSingleRandomData(amount: AmountLike, keysetId: string) {
    return defaultOutputDataCreator.createSingleRandomData(amount, keysetId);
  }

  static createDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    return defaultOutputDataCreator.createDeterministicData(
      amount,
      seed,
      counter,
      keyset,
      customSplit,
    );
  }

  /**
   * @throws May throw if blinding factor is out of range. Caller should catch, increment counter,
   *   and retry per BIP32-style derivation.
   */
  static createSingleDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keysetId: string,
  ) {
    return defaultOutputDataCreator.createSingleDeterministicData(amount, seed, counter, keysetId);
  }

  /**
   * Calculates the sum of amounts in an array of OutputDataLike objects.
   *
   * @param outputs Array of OutputDataLike objects.
   * @returns The total sum of amounts.
   */
  static sumOutputAmounts(outputs: OutputDataLike[]): Amount {
    return Amount.sum(outputs.map((output) => output.blindedMessage.amount));
  }
}
