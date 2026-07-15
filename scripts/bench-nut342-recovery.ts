/**
 * NUT-342 recovery strategy benchmark.
 *
 * Mirrors the Nutshell reference benchmark setup: probe batch 25, d_gap=100, one skipped counter
 * every 137 derivations, T in {100, 1k, 10k, 100k}. Runs the current branch's restoreEfficient
 * (plus optionally the linear NUT-09 batchRestore scan) against an in-process mock mint with a
 * simulated RTT per POST.
 *
 *     npx tsx scripts/bench-nut342-recovery.ts
 *
 * Env knobs: BRANCH_LABEL (row label), SKIP_LEGACY=1, T_LIST=100,1000,..., GRIDS=30,12,8
 * (probeBudget sweep, ladder branch only), RTT_MS=50.
 */
import { randomBytes } from '@noble/hashes/utils.js';

import { OutputData, Wallet, deriveKeysetId } from '../src';
import { DUMMY_TEST_KEYS } from '../test/consts';

const RTT_MS = Number(process.env.RTT_MS ?? 50);
const T_VALUES = (process.env.T_LIST ?? '100,1000,10000,100000').split(',').map(Number);
const GRIDS = process.env.GRIDS?.split(',').map(Number);
const MAX_T = Math.max(...T_VALUES);
const D_GAP = 100;
const SKIP_EVERY = 137; // counter c is never issued when c % 137 === 136
const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
// Real derived v1 id (verification-proof) -> fast HMAC derivation
const KEYSET_ID = deriveKeysetId(DUMMY_TEST_KEYS.keys, {
  unit: 'sat',
  versionByte: 1,
  input_fee_ppk: 0,
});
const KEYSET = { id: KEYSET_ID, unit: 'sat', input_fee_ppk: 0, keys: DUMMY_TEST_KEYS.keys };
const MINT_URL = 'http://bench.local:3338';
const LABEL = process.env.BRANCH_LABEL ?? 'efficient';

const skipped = (c: number) => c % SKIP_EVERY === SKIP_EVERY - 1;

// Derive B_ for every counter once (shared across runs)
console.error(`deriving ${MAX_T + 1} blanks...`);
const seed = randomBytes(64);
const blanks = OutputData.createDeterministicData(0, seed, 0, KEYSET, Array(MAX_T + 1).fill(0));
const counterByB = new Map<string, number>();
blanks.forEach((b, c) => counterByB.set(b.blindedMessage.B_, c));
console.error('derivation done');

type Stats = {
  restoreCalls: number;
  checkCalls: number;
  sent: number;
  unique: Set<string>;
  linked: Set<string>;
  checkedYs: number;
};

function mockMint(t: number) {
  const stats: Stats = {
    restoreCalls: 0,
    checkCalls: 0,
    sent: 0,
    unique: new Set(),
    linked: new Set(),
    checkedYs: 0,
  };
  const issued = (c: number) => c <= t && !skipped(c);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const wrapped: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/info')) {
      return json({
        name: 'bench',
        pubkey: VALID_POINT,
        version: 'bench/0',
        contact: [],
        nuts: {
          '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
          '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
          '7': { supported: true },
          '9': { supported: true },
          '342': { supported: true },
        },
      });
    }
    if (url.includes('/v1/keysets')) {
      return json({ keysets: [{ id: KEYSET_ID, unit: 'sat', active: true, input_fee_ppk: 0 }] });
    }
    if (url.includes('/v1/keys')) {
      return json({ keysets: [KEYSET] });
    }
    if (url.endsWith('/v1/restore')) {
      await new Promise((r) => setTimeout(r, RTT_MS));
      stats.restoreCalls++;
      const body = JSON.parse(String(init?.body)) as { outputs: Array<{ id: string; B_: string }> };
      stats.sent += body.outputs.length;
      const outputs: unknown[] = [];
      const signatures: unknown[] = [];
      for (const o of body.outputs) {
        stats.unique.add(o.B_);
        const c = counterByB.get(o.B_);
        if (c === undefined || !issued(c)) continue;
        stats.linked.add(o.B_);
        outputs.push(o);
        signatures.push({
          id: o.id,
          amount: 1,
          C_: VALID_POINT,
          ...(c === t && { d_gap: D_GAP }), // plaintext gap, per the reference run
        });
      }
      return json({ outputs, signatures });
    }
    if (url.endsWith('/v1/checkstate')) {
      await new Promise((r) => setTimeout(r, RTT_MS));
      stats.checkCalls++;
      const body = JSON.parse(String(init?.body)) as { Ys: string[] };
      stats.checkedYs += body.Ys.length;
      return json({ states: body.Ys.map((Y) => ({ Y, state: 'UNSPENT', witness: null })) });
    }
    throw new Error('unmocked url: ' + url);
  };
  return { wrapped, stats };
}

async function run(method: 'efficient' | 'legacy', tRequested: number, probeBudget?: number) {
  let t = tRequested;
  while (skipped(t)) t--; // T itself must be issued
  const { wrapped, stats } = mockMint(t);
  const wallet = new Wallet(MINT_URL, { bip39seed: seed, requestFetch: wrapped });
  await wallet.loadMint();
  const started = Date.now();
  const res =
    method === 'efficient'
      ? await wallet.restoreEfficient({
          probeWindow: 25,
          ...(probeBudget && { probeBudget }),
        })
      : await wallet.batchRestore();
  await wallet.groupProofsByState(res.proofs);
  const wallMs = Date.now() - started;
  return {
    method: method === 'efficient' ? (probeBudget ? `${LABEL}-g${probeBudget}` : LABEL) : 'legacy',
    T: t,
    calls: stats.restoreCalls + stats.checkCalls,
    restoreCalls: stats.restoreCalls,
    checkCalls: stats.checkCalls,
    messages: stats.sent,
    unique: stats.unique.size,
    linked: stats.linked.size,
    proofsChecked: stats.checkedYs,
    recoveredT: res.lastCounterWithSignature,
    wallMs,
  };
}

const rows: Array<Record<string, unknown>> = [];
for (const t of T_VALUES) {
  for (const grid of GRIDS ?? [undefined]) {
    rows.push(await run('efficient', t, grid));
    console.error(`efficient T=${t} grid=${grid ?? 'default'} done`);
  }
  if (!process.env.SKIP_LEGACY) {
    rows.push(await run('legacy', t));
    console.error(`legacy T=${t} done`);
  }
}
console.log(JSON.stringify(rows, null, 1));
