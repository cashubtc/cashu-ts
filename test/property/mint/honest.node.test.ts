import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isLibraryError, runs } from '../arbitraries';

import {
  apply,
  expectModel,
  expectResult,
  fees,
  newWorld,
  ops,
  owned,
  secrets,
  snapshot,
  submittedOutputs,
} from './harness';

describe.each(fees)('wallet against an honest mint, input fee %i ppk', (fee) => {
  it('keeps proofs worth the model balance less fees, and restore recovers exactly them', async () => {
    await fc.assert(
      fc.asyncProperty(ops(), async (sequence) => {
        const world = await newWorld(fee);
        for (const op of sequence) {
          const before = snapshot(world);
          const signing = submittedOutputs(world.mint).length;
          let refused = false;
          const produced = await apply(world, op).catch((e: unknown) => {
            // Only a shortfall may refuse, and it must refuse before asking the mint to sign.
            refused = true;
            expect(isLibraryError(e), `unexpected ${String(e)}`).toBe(true);
            expect(submittedOutputs(world.mint).length).toBe(signing);
          });
          if (!refused) expectResult(world, op, produced ?? [], before);
          if (op.kind === 'restore') expect(secrets(produced ?? [])).toEqual(secrets(owned(world)));
          expect(world.mint.log.filter((ex) => ex.status !== 200)).toEqual([]);
          expectModel(world);
        }
      }),
      { numRuns: runs(5) },
    );
  });
});
