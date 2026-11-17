import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isLibraryError, runs } from '../arbitraries';

import { faultKinds, faultOnce, type FaultKind } from './faulty';
import {
  apply,
  expectQuotesEcho,
  expectResult,
  expectSound,
  expectUnique,
  newWorld,
  ops,
  owned,
  resync,
  snapshot,
  submittedOutputs,
  total,
} from './harness';

/**
 * One response in the sequence is altered as `kind` says; the mint's ledger stays truthful.
 */
async function expectSurvivesOneFault(kind: FaultKind): Promise<void> {
  await fc.assert(
    fc.asyncProperty(ops(4), fc.nat(8), fc.gen(), async (sequence, at, g) => {
      const world = await newWorld(200, true);
      faultOnce(world.mint, kind, at, g);
      for (const op of sequence) {
        const before = snapshot(world);
        let failure: unknown;
        const produced = await apply(world, op).catch((e: unknown) => {
          failure = e ?? new Error('rejected without a reason');
        });
        const tamper = world.mint.tamper;
        world.mint.tamper = undefined;
        expectUnique(submittedOutputs(world.mint), 'B_');
        if (failure === undefined) {
          expectResult(world, op, produced ?? [], before);
        } else {
          expect(isLibraryError(failure), `unexpected ${String(failure)}`).toBe(true);
          expectQuotesEcho(world.mint, before.log);
          await resync(world);
          expectSound(world);
          expect(total(owned(world))).toBe(world.mint.outstanding());
        }
        world.mint.tamper = tamper;
      }
    }),
    { numRuns: runs(4) },
  );
}

describe('wallet against a mint that alters one response', () => {
  it.each(faultKinds)(
    '%s: each op rejects with a library error or returns what was asked, and no value is lost',
    (kind) => expectSurvivesOneFault(kind),
  );
});
