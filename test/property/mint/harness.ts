import * as fc from 'fast-check';
import { expect } from 'vitest';

import { Wallet, sumProofs, type Proof } from '../../../src';

import { InMemoryMint, invoice, mintKeys, mintUrl, proofY, unit } from './mint';

export type Op =
  | { kind: 'mint'; amount: number; byId: boolean }
  | { kind: 'send'; amount: number; includeFees: boolean }
  | { kind: 'receive'; pick: number }
  | { kind: 'melt'; amount: number }
  | { kind: 'restore' };

// Mints outweigh spends so most spends are funded.
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('mint'),
      amount: fc.integer({ min: 1, max: 6 }),
      byId: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('send'),
      amount: fc.integer({ min: 1, max: 3 }),
      includeFees: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('receive'), pick: fc.nat(3) }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('melt'), amount: fc.integer({ min: 1, max: 3 }) }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'restore' as const }) },
);

/**
 * Op sequences that start by funding the wallet.
 */
export function ops(maxLength = 7): fc.Arbitrary<Op[]> {
  return fc
    .tuple(fc.integer({ min: 4, max: 8 }), fc.array(opArb, { maxLength }))
    .map(([amount, rest]) => [{ kind: 'mint', amount, byId: false }, ...rest]);
}

export const fees = [0, 200, 600];

/**
 * The wallet under test, its mint, and what the app believes it owns.
 */
export type World = {
  mint: InMemoryMint;
  wallet: Wallet;
  seed: Uint8Array;
  held: Proof[];
  tokens: Proof[][];
  /**
   * Minted minus melted, before fees.
   */
  balance: bigint;
};

const keysByFee = new Map<number, ReturnType<typeof mintKeys>>();

// DLEQ costs a few curve multiplications per output on each side, so only the faulty-mint
// properties, which need it to tell a substituted signature apart, turn it on.
export function newMint(feePpk: number, dleq = false): InMemoryMint {
  let keys = keysByFee.get(feePpk);
  if (!keys) keysByFee.set(feePpk, (keys = mintKeys(feePpk)));
  return new InMemoryMint(keys, { feePpk, feeReserve: 2, lnFee: 1, dleq });
}

export async function newWallet(
  mint: InMemoryMint,
  seed: Uint8Array,
  options?: ConstructorParameters<typeof Wallet>[1],
  signal?: AbortSignal,
): Promise<Wallet> {
  const wallet = new Wallet(mintUrl, {
    unit,
    bip39seed: seed,
    requestFetch: mint.fetch,
    requireSigDleq: true,
    denominationTarget: 1,
    ...options,
  });
  await wallet.loadMint(false, { signal });
  return wallet;
}

export async function newWorld(fee: number, dleq = false): Promise<World> {
  const mint = newMint(fee, dleq);
  const seed = new Uint8Array(64).fill(1);
  return { mint, wallet: await newWallet(mint, seed), seed, held: [], tokens: [], balance: 0n };
}

/**
 * Restores from the seed alone, as a fresh install would.
 */
export async function restoreFromSeed(
  world: World,
  gapLimit = 10,
  signal?: AbortSignal,
): Promise<Proof[]> {
  const fresh = await newWallet(world.mint, world.seed, undefined, signal);
  const { proofs } = await fresh.batchRestore({ gapLimit, batchSize: 10, signal });
  return proofs;
}

/**
 * Runs one op against the wallet, changing the app's view only from what the wallet returns.
 *
 * @returns The proofs the op produced; for a restore, every proof the seed recovers.
 */
export async function apply(world: World, op: Op, signal?: AbortSignal): Promise<Proof[]> {
  const { wallet } = world;
  switch (op.kind) {
    case 'mint': {
      const { pubkey, privkey } = await wallet.createQuoteLockKey();
      const quote = await wallet.createMintQuoteBolt11(op.amount, pubkey, undefined, { signal });
      const proofs = await wallet.mintProofsBolt11(op.amount, op.byId ? quote.quote : quote, {
        privkey,
        signal,
      });
      world.held.push(...proofs);
      world.balance += BigInt(op.amount);
      return proofs;
    }
    case 'send': {
      const { keep, send } = await wallet.send(op.amount, world.held, {
        includeFees: op.includeFees,
        signal,
      });
      world.held = keep;
      world.tokens.push(send);
      return [...keep, ...send];
    }
    case 'receive': {
      if (world.tokens.length === 0) return [];
      const token = world.tokens[op.pick % world.tokens.length];
      const proofs = await wallet.receive(token, { signal });
      world.tokens = world.tokens.filter((t) => t !== token);
      world.held.push(...proofs);
      return proofs;
    }
    case 'melt': {
      const request = invoice(op.amount, `${world.mint.log.length}`);
      const quote = await wallet.createMeltQuoteBolt11(request, undefined, { signal });
      const { keep, send } = await wallet.send(quote.amount.add(quote.fee_reserve), world.held, {
        includeFees: true,
        signal,
      });
      world.held = [...keep, ...send];
      const { change } = await wallet.meltProofsBolt11(quote, send, { signal });
      world.held = [...keep, ...change];
      world.balance -= BigInt(op.amount);
      return change;
    }
    case 'restore':
      return restoreFromSeed(world, 10, signal);
  }
}

/**
 * Every proof the app holds or has handed out and not yet seen received.
 */
export function owned(world: World): Proof[] {
  return [...world.held, ...world.tokens.flat()];
}

export function secrets(proofs: Proof[]): string[] {
  return proofs.map((p) => p.secret).sort();
}

export function total(proofs: Proof[]): bigint {
  return sumProofs(proofs).toBigInt();
}

const signingPaths = ['/v1/mint/bolt11', '/v1/swap', '/v1/melt/bolt11'];

/**
 * Every B_ the wallet asked the mint to sign, refused requests included.
 */
export function submittedOutputs(mint: InMemoryMint): string[] {
  return mint.log
    .filter((ex) => ex.method === 'POST' && signingPaths.includes(ex.path))
    .flatMap((ex) => ((ex.body?.outputs ?? []) as Array<{ B_: string }>).map((o) => o.B_));
}

/**
 * Every input Y the wallet offered the mint, refused requests included.
 */
export function submittedInputs(mint: InMemoryMint): string[] {
  return mint.log
    .filter((ex) => ex.method === 'POST' && signingPaths.includes(ex.path))
    .flatMap((ex) =>
      ((ex.body?.inputs ?? []) as Array<{ secret: string }>).map((p) => proofY(p.secret)),
    );
}

export function expectUnique(values: string[], what: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    expect(seen.has(v), `${what} repeated: ${v}`).toBe(false);
    seen.add(v);
  }
}

/**
 * The app's proofs are distinct, signed by the mint and unspent.
 */
export function expectSound(world: World): void {
  const all = owned(world);
  expectUnique(secrets(all), 'secret');
  for (const p of all) expect(world.mint.holds(p), `unusable proof ${p.secret}`).toBe(true);
}

/**
 * The honest-mint model: sound proofs worth what was minted, less melts and fees, and a mint that
 * saw no secret or B_ twice.
 */
export function expectModel(world: World): void {
  expectSound(world);
  const value = total(owned(world));
  expect(value).toBe(world.balance - world.mint.feesCharged);
  expect(value).toBe(world.mint.outstanding());
  expectUnique(submittedOutputs(world.mint), 'B_');
  expectUnique(submittedInputs(world.mint), 'input Y');
}

export type Snapshot = { owned: bigint; outstanding: bigint; log: number };

export function snapshot(world: World): Snapshot {
  return {
    owned: total(owned(world)),
    outstanding: world.mint.outstanding(),
    log: world.mint.log.length,
  };
}

/**
 * Every mint or melt the wallet sent since `from` names a quote it was shown since then.
 */
export function expectQuotesEcho(mint: InMemoryMint, from: number): void {
  const exchanges = mint.log.slice(from);
  function issued(path: string): unknown[] {
    return exchanges
      .filter((ex) => ex.method === 'POST' && ex.path === path && ex.status === 200)
      .map((ex) => ((ex.sent ?? ex.response) as { quote: string }).quote);
  }
  for (const ex of exchanges) {
    if (ex.method !== 'POST') continue;
    if (ex.path === '/v1/mint/bolt11')
      expect(issued('/v1/mint/quote/bolt11')).toContain(ex.body?.quote);
    if (ex.path === '/v1/melt/bolt11')
      expect(issued('/v1/melt/quote/bolt11')).toContain(ex.body?.quote);
  }
}

/**
 * A resolved op returned what was asked for, and the app's holdings moved with the mint's debt.
 *
 * @remarks
 * A melt may move less: a mint can sign fewer change outputs than it was offered (NUT-08).
 */
export function expectResult(world: World, op: Op, produced: Proof[], before: Snapshot): void {
  const { mint } = world;
  const moved = total(owned(world)) - before.owned;
  const owed = mint.outstanding() - before.outstanding;
  if (op.kind === 'melt') expect(moved <= owed, `melt moved ${moved}, owed ${owed}`).toBe(true);
  else expect(moved).toBe(owed);
  if (op.kind === 'mint') expect(total(produced)).toBe(BigInt(op.amount));
  if (op.kind === 'send') {
    const sent = world.tokens[world.tokens.length - 1];
    const fee = op.includeFees ? mint.fee(sent.length) : 0n;
    expect(total(sent)).toBe(BigInt(op.amount) + fee);
  }
  for (const p of produced) expect(mint.holds(p), `unusable proof ${p.secret}`).toBe(true);
  expectSound(world);
  expectQuotesEcho(mint, before.log);
}

/**
 * Rebuilds the app's view from the seed and the mint's own ledger, after a refused op.
 */
export async function resync(world: World): Promise<void> {
  const restored = await restoreFromSeed(world, 20);
  const { spent } = world.mint;
  world.tokens = world.tokens.filter((t) => t.every((p) => !spent.has(proofY(p.secret))));
  const inTokens = new Set(world.tokens.flat().map((p) => p.secret));
  world.held = restored.filter((p) => !inTokens.has(p.secret));
}
