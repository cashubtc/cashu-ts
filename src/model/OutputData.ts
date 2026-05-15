import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

import {
  asBlsG1Point,
  asSecpPoint,
  blindMessage,
  blindMessageBls,
  constructUnblindedSignatureBls,
  createSecretAndBlindingFactorDeriver,
  constructUnblindedSignature,
  deriveP2BKBlindedPubkeys,
  deriveSecretAndBlindingFactor,
  isBlsKeyset,
  normalizeP2PKOptions,
  parseMintPubKey,
  pointFromHex,
  pointFromHexAuto,
  pointFromHexG1,
  verifyDLEQProof,
  verifyUnblindedSignatureBls,
  type CurvePoint,
  type DLEQ,
  type BlindSignature,
  type P2PKOptions,
} from '../crypto';
import { Bytes, numberToHexPadded64, splitAmount } from '../utils';

import { Amount, type AmountLike } from './Amount';
import { BlindedMessage } from './BlindedMessage';
import { CTSError } from './Errors';
import {
  type HasKeysetKeys,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
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
 * JSON-safe representation of an {@link OutputData} entry.
 */
export type SerializedOutputData = {
  /**
   * Storage shape: `amount` is a decimal string, not an {@link Amount} instance like the wire-shape
   * {@link SerializedBlindedMessage}.
   */
  blindedMessage: {
    amount: string;
    B_: string;
    id: string;
  };
  /**
   * Decimal-encoded bigint.
   */
  blindingFactor: string;
  secret: string;
  ephemeralE?: string;
};

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
  if (!key || typeof key !== 'string') throw new CTSError('tag key must be a non empty string');
  if (RESERVED_P2PK_TAGS.has(key)) {
    throw new CTSError(`additionalTags must not use reserved key "${key}"`);
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
    if (sig == undefined) {
      throw new CTSError(
        'Mint response is missing a signature for one of the outputs. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.',
      );
    }
    if (sig.id !== this.blindedMessage.id) {
      throw new CTSError(
        `Mint signature keyset id ${sig.id} does not match output ${this.blindedMessage.id}`,
      );
    }

    // v3 (BLS12-381) path: multiplicative unblinding, then pairing equality
    // `e(C, G2_gen) == e(Y, K2)` to confirm the mint actually signed this output. v3 carries no
    // DLEQ — the pairing is the only check that the returned `C_` is a real signature, so it
    // MUST run here. Without it, a malicious mint can return garbage `C_`, the wallet stores an
    // invalid `C`, marks inputs spent, and the user loses funds. Mirrors the secp DLEQ check below.
    if (isBlsKeyset(sig.id)) {
      const blindSig: BlindSignature = { id: sig.id, C_: pointFromHexG1(sig.C_) };
      const unblinded = constructUnblindedSignatureBls(blindSig, this.blindingFactor, this.secret);
      const k2 = parseMintPubKey(sig.id, keyset.keys[sig.amount.toString()]);
      // Type-narrow only — `parseMintPubKey` returns `blsG2` iff `isBlsKeyset(sig.id)` is true.
      /* c8 ignore next 3 */
      if (k2.kind !== 'blsG2') {
        throw new CTSError('BLS pairing verification failed on mint response');
      }
      if (!verifyUnblindedSignatureBls(k2.pt, unblinded.C, unblinded.secret)) {
        throw new CTSError('BLS pairing verification failed on mint response');
      }
      const proof: Proof = {
        id: sig.id,
        amount: sig.amount,
        C: unblinded.C.toHex(true),
        secret: new TextDecoder().decode(unblinded.secret),
      };
      if (this.ephemeralE) proof.p2pk_e = this.ephemeralE;
      return proof;
    }

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

    // NUT-12: Verify DLEQ proof if present. Only secp keysets carry DLEQ.
    if (dleq) {
      const bAuto = pointFromHexAuto(this.blindedMessage.B_);
      if (bAuto.kind === 'secp') {
        const C_ = pointFromHex(sig.C_);
        if (!verifyDLEQProof(dleq, bAuto.pt, C_, A)) {
          throw new CTSError('DLEQ verification failed on mint response');
        }
      }
    }

    const blindSig: BlindSignature = { id: sig.id, C_: pointFromHex(sig.C_) };
    const unblinded = constructUnblindedSignature(blindSig, this.blindingFactor, this.secret, A);
    const proof: Proof = {
      id: sig.id,
      amount: sig.amount,
      C: unblinded.C.toHex(true),
      secret: new TextDecoder().decode(unblinded.secret),
      ...(dleq && {
        dleq: {
          s: bytesToHex(dleq.s),
          e: bytesToHex(dleq.e),
          r: numberToHexPadded64(dleq.r ?? BigInt(0)),
        },
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
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
  }

  static createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string): OutputData {
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
    const parsed = JSON.stringify(newSecret);

    // Check secret length, counting Unicode code points
    // Same semantics as Nutshell python: len(str)
    const charCount = [...parsed].length;
    if (charCount > MAX_SECRET_LENGTH) {
      throw new CTSError(
        `Secret too long (${charCount} characters), maximum is ${MAX_SECRET_LENGTH}`,
      );
    }

    // blind the message
    const secretBytes = new TextEncoder().encode(parsed);
    const { r, B_ } = blindMessageForKeyset(secretBytes, keysetId);

    // create OutputData
    return new OutputData(
      new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
      r,
      secretBytes,
      Ehex,
    );
  }

  static createRandomData(amount: AmountLike, keyset: HasKeysetKeys, customSplit?: AmountLike[]) {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleRandomData(a, keyset.id));
  }

  static createSingleRandomData(amount: AmountLike, keysetId: string): OutputData {
    const amountValue = Amount.from(amount);
    const randomHex = bytesToHex(randomBytes(32));
    const secretBytes = new TextEncoder().encode(randomHex);
    const { r, B_ } = blindMessageForKeyset(secretBytes, keysetId);
    return new OutputData(
      new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
      r,
      secretBytes,
    );
  }

  static createDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputData[] {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    // Create a "deriver" up front for this batch of outputs
    // This ensures the HDKey is only created once for legacy BIP-32 keysets
    const derive = createSecretAndBlindingFactorDeriver(seed, keyset.id);
    return amounts.map((a, i) =>
      createSingleDeterministicDataFromBytes(a, keyset.id, derive(counter + i)),
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
  ): OutputData {
    return createSingleDeterministicDataFromBytes(
      amount,
      keysetId,
      deriveSecretAndBlindingFactor(seed, keysetId, counter),
    );
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

  /**
   * Converts output data to a JSON-safe representation.
   *
   * @remarks
   * Pair with {@link OutputData.deserialize} to persist prepared melt change outputs (e.g. across a
   * NUT-06 async melt's pending window) and reconstruct spendable change proofs via
   * `wallet.createMeltChangeProofs` once the quote is paid.
   * @example
   *
   * ```ts
   * // Save while async melt is pending:
   * const preview = await wallet.prepareMelt('bolt11', meltQuote, proofs);
   * const stored = JSON.stringify(preview.outputData.map((o) => OutputData.serialize(o)));
   * await wallet.completeMelt(preview, undefined, { preferAsync: true });
   *
   * // ... time passes, quote pays ...
   * const restored = (JSON.parse(stored) as SerializedOutputData[]).map((s) =>
   *   OutputData.deserialize(s),
   * );
   * const change = wallet.createMeltChangeProofs(restored, paidQuote.change ?? []);
   * ```
   */
  static serialize(output: OutputDataLike): SerializedOutputData {
    return {
      blindedMessage: {
        amount: output.blindedMessage.amount.toString(),
        B_: output.blindedMessage.B_,
        id: output.blindedMessage.id,
      },
      blindingFactor: output.blindingFactor.toString(),
      secret: bytesToHex(output.secret),
      ...(output.ephemeralE && { ephemeralE: output.ephemeralE }),
    };
  }

  /**
   * Reconstructs concrete {@link OutputData} from its JSON-safe representation.
   *
   * @throws {@link CTSError} If any field fails validation (non-canonical blindingFactor, malformed
   *   hex secret/ephemeralE, or an Amount that cannot be parsed).
   * @see {@link OutputData.serialize} for the persist/restore lifecycle example.
   */
  static deserialize(serialized: SerializedOutputData): OutputData {
    try {
      if (!/^(0|[1-9]\d*)$/.test(serialized.blindingFactor)) {
        throw new Error('blindingFactor must be a canonical decimal integer');
      }
      return new OutputData(
        {
          amount: Amount.from(serialized.blindedMessage.amount),
          B_: serialized.blindedMessage.B_,
          id: serialized.blindedMessage.id,
        },
        BigInt(serialized.blindingFactor),
        hexToBytes(serialized.secret),
        serialized.ephemeralE,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new CTSError(`Invalid SerializedOutputData: ${message}`, { cause: e });
    }
  }
}

/**
 * Derives OutputData from specified derived bytes.
 */
function createSingleDeterministicDataFromBytes(
  amount: AmountLike,
  keysetId: string,
  derived: { blindingFactor: Uint8Array; secret: Uint8Array },
): OutputData {
  const amountValue = Amount.from(amount);
  const secretBytesAsHex = bytesToHex(derived.secret);
  const utf8SecretBytes = new TextEncoder().encode(secretBytesAsHex);
  // Note: Bytes.toBigInt is used here so invalid values bubble up as throws
  // for BIP32-style retry logic (caller increments counter and retries).
  const deterministicR = Bytes.toBigInt(derived.blindingFactor);
  const { r, B_ } = blindMessageForKeyset(utf8SecretBytes, keysetId, deterministicR);
  return new OutputData(
    new BlindedMessage(amountValue, B_, keysetId).getSerializedBlindedMessage(),
    r,
    utf8SecretBytes,
  );
}

/**
 * Curve dispatch for output blinding: v3 (`02…`) keysets use multiplicative BLS12-381 G1;
 * everything else uses secp256k1 additive blinding.
 */
function blindMessageForKeyset(
  secret: Uint8Array,
  keysetId: string,
  r?: bigint,
): { r: bigint; B_: CurvePoint } {
  if (isBlsKeyset(keysetId)) {
    const out = blindMessageBls(secret, r);
    return { r: out.r, B_: asBlsG1Point(out.B_) };
  }
  const out = blindMessage(secret, r);
  return { r: out.r, B_: asSecpPoint(out.B_) };
}
