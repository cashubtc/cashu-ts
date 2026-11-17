import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { MintQuoteBolt11Response, Wallet } from '../../../src';
import { isLibraryError, runs } from '../arbitraries';

import {
  apply,
  expectUnique,
  newWallet,
  newWorld,
  restoreFromSeed,
  submittedOutputs,
  type Op,
  type World,
} from './harness';
import type { InMemoryMint } from './mint';

type Step =
  | Op
  | { kind: 'quote'; amount: number }
  | { kind: 'redeem'; pick: number }
  | { kind: 'reload'; from: 'events' | 'snapshot' }
  | { kind: 'stale' }
  | { kind: 'manual'; amount: number }
  | { kind: 'probe' };

/**
 * The app around the wallet: counters persisted from events, snapshots it took, and its quotes.
 * Quote keys live in memory only, so a reload must recover them from the seed.
 */
type App = World & {
  persisted: Record<string, number>;
  snapshots: Array<Record<string, number>>;
  quotes: Array<{ quote: MintQuoteBolt11Response; pubkey: string; redeemed: boolean }>;
  keys: Map<string, string>;
};

const amount = fc.integer({ min: 1, max: 5 });
const common: Array<fc.Arbitrary<Step>> = [
  fc.record({ kind: fc.constant('mint' as const), amount, byId: fc.constant(false) }),
  fc.record({ kind: fc.constant('quote' as const), amount }),
  fc.record({ kind: fc.constant('redeem' as const), pick: fc.nat(3) }),
  fc.record({
    kind: fc.constant('send' as const),
    amount: fc.integer({ min: 1, max: 3 }),
    includeFees: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('receive' as const), pick: fc.nat(3) }),
  fc.record({ kind: fc.constant('reload' as const), from: fc.constantFrom('events', 'snapshot') }),
];

// The step a property is about is drawn more often than the common ones.
function steps(...extra: Array<fc.Arbitrary<Step>>): fc.Arbitrary<Step[]> {
  const weighted = [
    ...common.map((arbitrary) => ({ arbitrary, weight: 1 })),
    ...extra.map((arbitrary) => ({ arbitrary, weight: 3 })),
  ];
  return fc
    .array(fc.oneof(...weighted), { minLength: 3, maxLength: 7 })
    .map((rest) => [{ kind: 'mint', amount: 8, byId: false }, ...rest]);
}

function persistCounters(app: App, wallet: Wallet): void {
  wallet.on.countersReserved(({ counterKey, next }) => {
    app.persisted[counterKey] = Math.max(app.persisted[counterKey] ?? 0, next);
  });
}

async function newApp(): Promise<App> {
  const app: App = {
    ...(await newWorld(0)),
    persisted: {},
    snapshots: [],
    quotes: [],
    keys: new Map(),
  };
  persistCounters(app, app.wallet);
  return app;
}

async function reload(app: App, counterInit: Record<string, number>): Promise<void> {
  app.wallet = await newWallet(app.mint, app.seed, { counterInit });
  persistCounters(app, app.wallet);
  app.keys.clear();
}

async function quote(app: App, amount: number): Promise<App['quotes'][number]> {
  const { pubkey, privkey } = await app.wallet.createQuoteLockKey();
  const q = {
    quote: await app.wallet.createMintQuoteBolt11(amount, pubkey),
    pubkey,
    redeemed: false,
  };
  app.quotes.push(q);
  app.keys.set(pubkey, privkey);
  return q;
}

async function redeem(app: App, q: App['quotes'][number], counter = 0): Promise<void> {
  const { wallet } = app;
  const privkey = app.keys.get(q.pubkey) ?? (await wallet.recoverQuoteLockKey(q.pubkey));
  if (!privkey) return;
  const proofs = await wallet.mintProofsBolt11(
    q.quote.amount,
    q.quote,
    { privkey },
    { type: 'deterministic', counter },
  );
  q.redeemed = true;
  app.held.push(...proofs);
}

/**
 * Restore as the docs describe: scan, then move each cursor past what was found.
 */
async function restoreAndAdvance(app: App): Promise<void> {
  const { lastCounters } = await app.wallet.restoreAll({ gapLimit: 10, batchSize: 10 });
  for (const [id, last] of Object.entries(lastCounters)) {
    await app.wallet.counters.advanceToAtLeast(id, last + 1);
  }
}

async function step(app: App, s: Step): Promise<void> {
  const pending = app.quotes.filter((q) => !q.redeemed);
  switch (s.kind) {
    case 'mint':
      return redeem(app, await quote(app, s.amount));
    case 'quote':
      await quote(app, s.amount);
      return;
    case 'redeem':
      if (pending.length > 0) await redeem(app, pending[s.pick % pending.length]);
      return;
    case 'manual': {
      // A caller-chosen counter at the cursor, as an app reserving its own range would pick.
      const q = await quote(app, s.amount);
      return redeem(app, q, await app.wallet.counters.peekNext(app.wallet.keysetId));
    }
    case 'reload': {
      const from =
        s.from === 'events' ? { ...app.persisted } : await app.wallet.counters.snapshot();
      return reload(app, from);
    }
    case 'stale': {
      await reload(app, app.snapshots[0]);
      await restoreAndAdvance(app);
      for (const q of app.quotes) {
        const key = await app.wallet.recoverQuoteLockKey(q.pubkey);
        if (key) app.keys.set(q.pubkey, key);
      }
      const unspent = await restoreFromSeed(app);
      const inTokens = new Set(app.tokens.flat().map((p) => p.secret));
      app.held = unspent.filter((p) => !inTokens.has(p.secret));
      return;
    }
    case 'probe':
      return restoreAndAdvance(app);
    default:
      await apply(app, s);
  }
}

function lockKeys(mint: InMemoryMint): string[] {
  return mint.log
    .filter((ex) => ex.method === 'POST' && ex.path === '/v1/mint/quote/bolt11')
    .map((ex) => String(ex.body?.pubkey));
}

async function expectNoReissue(sequence: fc.Arbitrary<Step[]>): Promise<void> {
  await fc.assert(
    fc.asyncProperty(sequence, async (sequence) => {
      const app = await newApp();
      for (const s of sequence) {
        await step(app, s).catch((e: unknown) => {
          expect(isLibraryError(e), `unexpected ${String(e)}`).toBe(true);
        });
        app.snapshots.push(await app.wallet.counters.snapshot());
        expectUnique(submittedOutputs(app.mint), 'B_');
        expectUnique(lockKeys(app.mint), 'quote lock key');
      }
    }),
    { numRuns: runs(10) },
  );
}

describe('outputs and quote lock keys across reloads', () => {
  it('reloading from persisted counters never issues an output or quote lock key twice', () =>
    expectNoReissue(steps()));
  it('reloading from persisted counters after caller-chosen counters never issues an output twice', () =>
    expectNoReissue(
      steps(
        fc.record({ kind: fc.constant('manual' as const), amount }),
        fc.constant({ kind: 'reload' as const, from: 'events' as const }),
      ),
    ));
  it('reloading a stale snapshot and recovering never issues an output or quote lock key twice', () =>
    expectNoReissue(steps(fc.constant({ kind: 'stale' as const }))));
  it('a restore scan never causes an output to be submitted for signing twice', () =>
    expectNoReissue(steps(fc.constant({ kind: 'probe' as const }))));
});
