import { type P2PKOptions } from '../crypto';
import { splitAmount } from '../utils';

import { type AmountLike } from './Amount';
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
    const amounts = splitAmount(amount, keyset.keys, customSplit);
    return amounts.map((a) => this.createSingleP2PKData(p2pk, a, keyset.id));
  }

  createSingleP2PKData(p2pk: P2PKOptions, amount: AmountLike, keysetId: string): OutputDataLike {
    return OutputData.createSingleP2PKData(p2pk, amount, keysetId);
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
  ): OutputDataLike {
    return OutputData.createSingleDeterministicData(amount, seed, counter, keysetId);
  }
}
