import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Amount, CallerAbortError, MintQuoteState, Wallet } from '../../../src';
import { runs } from '../arbitraries';

import {
  apply,
  expectResult,
  expectSound,
  newMint,
  newWallet,
  newWorld,
  owned,
  snapshot,
  total,
  type Op,
  type World,
} from './harness';
import { invoice, mintUrl, unit, type InMemoryMint } from './mint';

type Timing =
  { at: 'before' } | { at: 'during'; k: number } | { at: 'after'; k: number; ticks: number };

// Abort before the call, from another task while the k-th response is held, or some microtasks
// after it arrives.
const timing: fc.Arbitrary<Timing> = fc.oneof(
  fc.constant({ at: 'before' as const }),
  fc.record({ at: fc.constant('during' as const), k: fc.nat(5) }),
  fc.record({ at: fc.constant('after' as const), k: fc.nat(5), ticks: fc.nat(40) }),
);

async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

type Armed = { signal: AbortSignal; abort: () => void; firedAt?: number };

/**
 * Arms an abort at `t`, recording how many requests the mint had seen when it fired.
 */
function armAbort(mint: InMemoryMint, t: Timing): Armed {
  const ac = new AbortController();
  const armed: Armed = {
    signal: ac.signal,
    abort() {
      if (armed.firedAt !== undefined) return;
      armed.firedAt = mint.log.length;
      ac.abort();
    },
  };
  if (t.at === 'before') armed.abort();
  let n = 0;
  mint.hold = () => {
    if (t.at === 'before' || n++ !== t.k) return undefined;
    if (t.at === 'during') {
      return new Promise<void>((resolve) =>
        setImmediate(() => {
          armed.abort();
          resolve();
        }),
      );
    }
    void ticks(t.ticks).then(armed.abort);
    return undefined;
  };
  return armed;
}

async function funded(): Promise<World> {
  const world = await newWorld(200);
  await apply(world, { kind: 'mint', amount: 8, byId: false });
  await apply(world, { kind: 'mint', amount: 8, byId: false });
  await apply(world, { kind: 'send', amount: 2, includeFees: false });
  return world;
}

const opOf: Record<Op['kind'], fc.Arbitrary<Op>> = {
  mint: fc.record({
    kind: fc.constant('mint' as const),
    amount: fc.integer({ min: 1, max: 6 }),
    byId: fc.boolean(),
  }),
  send: fc.record({
    kind: fc.constant('send' as const),
    amount: fc.integer({ min: 1, max: 4 }),
    includeFees: fc.boolean(),
  }),
  receive: fc.constant({ kind: 'receive' as const, pick: 0 }),
  melt: fc.record({ kind: fc.constant('melt' as const), amount: fc.integer({ min: 1, max: 3 }) }),
  restore: fc.constant({ kind: 'restore' as const }),
};

function expectNothingAfter(mint: InMemoryMint, firedAt: number | undefined): void {
  if (firedAt !== undefined) expect(mint.log.slice(firedAt).map((ex) => ex.path)).toEqual([]);
}

// A one-shot op honours the signal until preparation finishes; its commit still goes out.
const commits = ['/v1/mint/bolt11', '/v1/swap', '/v1/melt/bolt11'];
function expectAtMostCommitAfter(mint: InMemoryMint, firedAt: number | undefined): void {
  if (firedAt === undefined) return;
  const after = mint.log.slice(firedAt).map((ex) => ex.path);
  expect(after.length, `sent after abort: ${after.join(', ')}`).toBeLessThanOrEqual(1);
  if (after.length === 1) expect(commits).toContain(after[0]);
}

describe('wallet ops under an abort signal', () => {
  it.each(Object.keys(opOf) as Array<Op['kind']>)(
    '%s: only a commit is sent after the abort, the op rejects with CallerAbortError unless committed, and no value is lost',
    async (kind) => {
      await fc.assert(
        fc.asyncProperty(opOf[kind], timing, async (op, t) => {
          const world = await funded();
          // A restore runs on a fresh install, loaded before the abort is armed.
          const fresh = op.kind === 'restore' ? await newWallet(world.mint, world.seed) : undefined;
          const before = snapshot(world);
          const abort = armAbort(world.mint, t);
          let failure: unknown;
          const run = fresh
            ? fresh
                .batchRestore({ gapLimit: 10, batchSize: 10, signal: abort.signal })
                .then((r) => r.proofs)
            : apply(world, op, abort.signal);
          const produced = await run.catch((e: unknown) => {
            failure = e ?? new Error('rejected without a reason');
          });
          world.mint.hold = undefined;
          expectAtMostCommitAfter(world.mint, abort.firedAt);
          if (failure === undefined) expectResult(world, op, produced ?? [], before);
          else expect(failure).toBeInstanceOf(CallerAbortError);
          expectSound(world);
          expect(total(owned(world))).toBe(world.mint.outstanding());
        }),
        { numRuns: runs(6) },
      );
    },
  );

  it('loadMint: nothing is sent after the abort and it rejects with CallerAbortError', async () => {
    await fc.assert(
      fc.asyncProperty(timing, async (t) => {
        const mint = newMint(200);
        const wallet = new Wallet(mintUrl, { unit, requestFetch: mint.fetch });
        const abort = armAbort(mint, t);
        let failure: unknown;
        await wallet.loadMint(false, { signal: abort.signal }).catch((e: unknown) => {
          failure = e;
        });
        expectNothingAfter(mint, abort.firedAt);
        if (failure !== undefined) expect(failure).toBeInstanceOf(CallerAbortError);
      }),
      { numRuns: runs(20) },
    );
  });
});

const pollMs = 10;

type Watch = (world: World, signal: AbortSignal, ids: string[]) => Promise<unknown>;

// Each watch resolves or rejects when it ends; an open subscription settles on setup.
const watches: Record<string, Watch> = {
  proofStateUpdates: (w, signal) =>
    w.wallet.on.proofStateUpdates(w.held, noop, noop, { signal, pollMs }),
  proofStatesStream: async (w, signal) => {
    for await (const update of w.wallet.on.proofStatesStream(w.held, { signal, pollMs })) {
      void update;
    }
  },
  mintQuoteUpdates: (w, signal, ids) =>
    w.wallet.on.mintQuoteUpdates(ids.slice(0, 2), noop, noop, { signal, pollMs }),
  meltQuoteUpdates: (w, signal, ids) =>
    w.wallet.on.meltQuoteUpdates(ids.slice(2), noop, noop, { signal, pollMs }),
  onceMintPaid: (w, signal, ids) => w.wallet.on.onceMintPaid(ids[0], { signal, pollMs }),
  onceAnyMintPaid: (w, signal, ids) => w.wallet.on.onceAnyMintPaid(ids, { signal, pollMs }),
  onceMeltPaid: (w, signal, ids) => w.wallet.on.onceMeltPaid(ids[2], { signal, pollMs }),
};

function noop(): void {}

/**
 * Two mint quotes left unpaid and one melt quote, for watches that wait on payment.
 */
async function unpaidQuotes(world: World): Promise<string[]> {
  const ids: string[] = [];
  for (const i of [0, 1]) {
    const { pubkey } = await world.wallet.createQuoteLockKey({ random: true });
    const quote = await world.wallet.createMintQuoteBolt11(1 + i, pubkey);
    world.mint.mintQuotes.set(quote.quote, {
      ...quote,
      state: MintQuoteState.UNPAID,
      amount_paid: Amount.zero(),
    });
    ids.push(quote.quote);
  }
  ids.push((await world.wallet.createMeltQuoteBolt11(invoice(1, 'watch'))).quote);
  return ids;
}

/**
 * One funded wallet per watch, reused across runs: a watch only reads, and each run checks the
 * requests made after its own abort.
 */
async function expectWatchStopsOnAbort(name: string): Promise<void> {
  // One Y per state check, so a proof watch polls in several batches.
  const world = await newWorld(0);
  world.mint.opts.maxArrayLength = 1;
  await world.wallet.loadMint(true);
  await apply(world, { kind: 'mint', amount: 15, byId: false });
  await apply(world, { kind: 'mint', amount: 3, byId: false });
  const ids = await unpaidQuotes(world);
  await fc.assert(
    fc.asyncProperty(timing, async (t) => {
      const abort = armAbort(world.mint, t);
      let failure: unknown;
      const watch = watches[name](world, abort.signal, ids).catch((e: unknown) => {
        failure = e;
      });
      for (let i = 0; i < 8 && abort.firedAt === undefined; i++) {
        await vi.advanceTimersByTimeAsync(pollMs);
      }
      abort.abort();
      await vi.advanceTimersByTimeAsync(20 * pollMs);
      world.mint.hold = undefined;
      expectNothingAfter(world.mint, abort.firedAt);
      if (name.startsWith('once')) {
        await watch;
        expect((failure as Error | undefined)?.name).toBe('AbortError');
      }
    }),
    { numRuns: runs(20) },
  );
}

describe('polling watches under an abort signal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(Object.keys(watches))(
    '%s: nothing is sent after the abort, and a once* wait rejects with an AbortError',
    (name) => expectWatchStopsOnAbort(name),
  );
});
