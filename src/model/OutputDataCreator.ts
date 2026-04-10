import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

import {
  blindMessage,
  deriveBlindingFactor,
  deriveP2BKBlindedPubkeys,
  deriveSecret,
  normalizeP2PKOptions,
  type P2PKOptions,
} from '../crypto';
import { Bytes, splitAmount } from '../utils';

import { Amount, type AmountLike } from './Amount';
import { BlindedMessage } from './BlindedMessage';
import {
  assertValidTagKey,
  MAX_SECRET_LENGTH,
  OutputData,
  type OutputDataLike,
} from './OutputData';
import type { HasKeysetKeys } from './types';

export interface OutputDataCreator {
  createP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[];
  createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string): OutputDataLike;
  createRandomData(
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[];
  createSingleRandomData(amount: AmountLike, keysetId: string): OutputDataLike;
  createDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[];
  createSingleDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keysetId: string,
  ): OutputDataLike;
}

export class DefaultOutputDataCreator implements OutputDataCreator {
  createP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
  }

  createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string): OutputData {
    const amountValue = Amount.from(amount);
    const normalized = normalizeP2PKOptions(p2pk);
    const lockKeys = Array.isArray(normalized.pubkey) ? normalized.pubkey : [normalized.pubkey];
    const refundKeys = normalized.refundKeys ?? [];
    const reqLock = normalized.requiredSignatures ?? 1;
    const reqRefund = normalized.requiredRefundSignatures ?? 1;

    // Init vars
    const hashlock = normalized.hashlock;
    const isHTLC = typeof hashlock === 'string' && hashlock.length > 0;
    let data = isHTLC ? hashlock : lockKeys[0];
    let pubkeys = isHTLC ? lockKeys : lockKeys.slice(1);
    let refund = refundKeys;

    // Optional key blinding (P2BK)
    let Ehex: string | undefined;
    if (p2pk.blindKeys) {
      const ordered = [...lockKeys, ...refundKeys];
      const { blinded, Ehex: _E } = deriveP2BKBlindedPubkeys(ordered);
      if (isHTLC) {
        // hashlock is in data, all locking keys into pubkeys
        pubkeys = blinded.slice(0, lockKeys.length);
      } else {
        // first locking key in data, rest into pubkeys
        data = blinded[0];
        pubkeys = blinded.slice(1, lockKeys.length);
      }
      refund = blinded.slice(lockKeys.length);
      Ehex = _E;
    }

    // build P2PK Tags (NUT-11)
    const tags: string[][] = [];

    const ts = normalized.locktime ?? NaN;
    if (Number.isSafeInteger(ts) && ts >= 0) {
      tags.push(['locktime', String(ts)]);
    }

    if (pubkeys.length > 0) {
      tags.push(['pubkeys', ...pubkeys]);
      if (reqLock > 1) {
        tags.push(['n_sigs', String(reqLock)]);
      }
    }

    if (refund.length > 0) {
      tags.push(['refund', ...refund]);
      if (reqRefund > 1) {
        tags.push(['n_sigs_refund', String(reqRefund)]);
      }
    }

    if (normalized.sigFlag == 'SIG_ALL') {
      tags.push(['sigflag', 'SIG_ALL']);
    }

    // Append additional tags if any
    if (normalized.additionalTags?.length) {
      const extraTags = normalized.additionalTags.map(([k, ...vals]) => {
        assertValidTagKey(k); // Validate key
        return [k, ...vals.map(String)]; // all to strings
      });
      tags.push(...extraTags);
    }

    // Construct secret
    const kind = isHTLC ? 'HTLC' : 'P2PK';
    const newSecret: [string, { nonce: string; data: string; tags: string[][] }] = [
      kind,
      {
        nonce: bytesToHex(randomBytes(32)),
        data,
        tags,
      },
    ];

    // blind the message
    const parsed = JSON.stringify(newSecret);

    // Check secret length, counting Unicode code points
    // Same semantics as Nutshell python: len(str)
    const charCount = [...parsed].length;
    if (charCount > MAX_SECRET_LENGTH) {
      throw new Error(`Secret too long (${charCount} characters), maximum is ${MAX_SECRET_LENGTH}`);
    }
    // blind the message
    const secretBytes = new TextEncoder().encode(parsed);
    const { r, B_ } = blindMessage(secretBytes);

    // create OutputData
    return new OutputData(
      new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
      r,
      secretBytes,
      Ehex,
    );
  }

  createRandomData(
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleRandomData(a, keyset.id));
  }

  createSingleRandomData(amount: AmountLike, keysetId: string): OutputData {
    const amountValue = Amount.from(amount);
    const randomHex = bytesToHex(randomBytes(32));
    const secretBytes = new TextEncoder().encode(randomHex);
    const { r, B_ } = blindMessage(secretBytes);
    return new OutputData(
      new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
      r,
      secretBytes,
    );
  }

  createDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a, i) =>
      this.createSingleDeterministicData(a, seed, counter + i, keyset.id),
    );
  }

  /**
   * @throws May throw if blinding factor is out of range. Caller should catch, increment counter,
   *   and retry per BIP32-style derivation.
   */
  createSingleDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keysetId: string,
  ): OutputData {
    const amountValue = Amount.from(amount);
    const secretBytes = deriveSecret(seed, keysetId, counter);
    const secretBytesAsHex = bytesToHex(secretBytes);
    const utf8SecretBytes = new TextEncoder().encode(secretBytesAsHex);
    // Note: Bytes.toBigInt is used here so invalid values bubble up as throws
    // for BIP32-style retry logic (caller increments counter and retries).
    const deterministicR = Bytes.toBigInt(deriveBlindingFactor(seed, keysetId, counter));
    const { r, B_ } = blindMessage(utf8SecretBytes, deterministicR);
    return new OutputData(
      new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
      r,
      utf8SecretBytes,
    );
  }
}

export const defaultOutputDataCreator = new DefaultOutputDataCreator();
