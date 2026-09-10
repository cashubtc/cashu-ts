import { createRandomSecretKey, type P2PKOptions } from '../crypto';
import { splitAmount } from '../utils';

import { type AmountLike } from './Amount';
import { CTSError } from './Errors';
import { OutputData, type OutputDataLike } from './OutputData';
import type { HasKeysetKeys } from './types';

/**
 * Injectable output-construction strategy used by {@link Wallet}.
 *
 * @remarks
 * The canonical and maintained implementation is the Noble Curves based default exposed through
 * `OutputData.create*()` and adapted by DefaultOutputDataCreator. This interface provides an escape
 * hatch for runtime-specific needs, but compatibility and maintenance outside the default
 * implementation are the integrator's responsibility.
 */
export interface OutputDataCreator {
  createP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[];
  /**
   * @param eBytes Shared P2BK ephemeral key for a SIG_ALL batch (NUT-28). Batch callers pass the
   *   same key to every output in the split; an override must forward it as-is, not derive a fresh
   *   one, or the split's outputs stop sharing locking data.
   */
  createSingleP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keysetId: string,
    eBytes?: Uint8Array,
  ): OutputDataLike;
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

/**
 * Thin adapter exposing the canonical `OutputData.create*()` implementation via
 * {@link OutputDataCreator}.
 *
 * @internal
 */
export class DefaultOutputDataCreator implements OutputDataCreator {
  createP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[] {
    if (this.createSingleP2PKData === DefaultOutputDataCreator.prototype.createSingleP2PKData) {
      // Preserve subclasses that customize only the single-output hook. The default
      // hook can use the batch path, which shares one P2BK ephemeral key for SIG_ALL.
      return OutputData.createP2PKData(p2pk, amount, keyset, customSplit);
    }
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    // Mirrors OutputData.createP2PKData's shared key, so a subclassed hook's SIG_ALL
    // split still carries identical data/tags across every output (NUT-28).
    const eBytes =
      p2pk.blindKeys && p2pk.sigFlag === 'SIG_ALL' ? createRandomSecretKey() : undefined;
    const outputs = amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id, eBytes));
    // An override that ignores eBytes silently reverts to a fresh key per output, which
    // defeats the point of sharing one: catch that here rather than at the mint.
    if (eBytes && new Set(outputs.map((o) => o.ephemeralE)).size > 1) {
      throw new CTSError(
        'createSingleP2PKData override must reuse the shared eBytes ephemeral key for a SIG_ALL split',
      );
    }
    return outputs;
  }

  createSingleP2PKData(
    p2pk: P2PKOptions,
    amount: AmountLike,
    keysetId: string,
    eBytes?: Uint8Array,
  ): OutputDataLike {
    return OutputData.createSingleP2PKData(p2pk, amount, keysetId, eBytes);
  }

  createRandomData(
    amount: AmountLike,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[] {
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleRandomData(a, keyset.id));
  }

  createSingleRandomData(amount: AmountLike, keysetId: string): OutputDataLike {
    return OutputData.createSingleRandomData(amount, keysetId);
  }

  createDeterministicData(
    amount: AmountLike,
    seed: Uint8Array,
    counter: number,
    keyset: HasKeysetKeys,
    customSplit?: AmountLike[],
  ): OutputDataLike[] {
    if (
      this.createSingleDeterministicData ===
      DefaultOutputDataCreator.prototype.createSingleDeterministicData
    ) {
      // Preserve subclasses that customize only the single-output hook.
      // The default hook can use the optimized batch path.
      return OutputData.createDeterministicData(amount, seed, counter, keyset, customSplit);
    }
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    // The canonical batch path rejects an unsafe counter itself; a custom hook may not, so
    // the whole range is checked before it aliases two outputs onto the same counter.
    const lastCounter = counter + (amounts.length - 1);
    if (
      !Number.isSafeInteger(counter) ||
      counter < 0 ||
      (amounts.length > 0 && !Number.isSafeInteger(lastCounter))
    ) {
      throw new CTSError('Counter must be an integer in the range 0 <= counter <= 2^53 - 1');
    }
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
  ): OutputDataLike {
    return OutputData.createSingleDeterministicData(amount, seed, counter, keysetId);
  }
}
