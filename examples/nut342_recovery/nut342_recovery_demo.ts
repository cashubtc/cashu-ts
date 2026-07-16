/**
 * Live demo of draft NUT-342 efficient wallet recovery (cashubtc/nuts#342).
 *
 * Requires a mint running the Nutshell reference implementation branch (cashubtc/nutshell#1081) on
 * port 3338. From this directory:
 *
 *     make up
 *     make demo
 *     make down
 *
 * Flow: a wallet with a `recoveryGapProvider` gets a thorough workout — two mints, random-value
 * swap churn, a Lightning melt with NUT-08 change, and one sent token that is never claimed. Every
 * operation backs up an encrypted recovery gap on the mint. Then a second wallet with the same seed
 * recovers everything via `restoreEfficient()` (batched exponential-ladder search plus chunked
 * window restore, typically ~4 requests). A plain `batchRestore()` (the linear NUT-09 restore scan)
 * runs last for comparison, including the count of issued signatures each method lets the mint
 * link.
 */
import { randomBytes } from '@noble/hashes/utils.js';

import {
  ConsoleLogger,
  MeltQuoteState,
  MintQuoteState,
  Wallet,
  sumProofs,
  type Proof,
} from '../../src';

const mintUrl = 'http://localhost:3338';
const seed = randomBytes(64);

// A 2000 sat bolt11 invoice; the FakeWallet backend "pays" it instantly.
const externalInvoice =
  'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

// ---------------------------------------------------------------------------
// Minimal app-side store. A real wallet persists proofs and, for NUT-342,
// which counter range each operation's outputs came from. The provider must
// report the lowest counter among unspent AND pending proofs — pending
// includes tokens we sent that the receiver has not claimed yet.
// ---------------------------------------------------------------------------
let proofs: Proof[] = []; // live wallet proofs
const sentPending: Proof[] = []; // sent, not yet claimed by the receiver
const batches: Array<{ start: number; secrets: Set<string> }> = [];
let reservedStart: number | undefined;
const onCountersReserved = (c: { start: number }) => (reservedStart = c.start);

function track(newProofs: Proof[]) {
  if (reservedStart === undefined) return; // op produced no deterministic outputs
  batches.push({ start: reservedStart, secrets: new Set(newProofs.map((p) => p.secret)) });
  reservedStart = undefined;
}

async function firstUnspentCounter(): Promise<number | undefined> {
  const liveSecrets = new Set([...proofs, ...sentPending].map((p) => p.secret));
  const live = batches.filter((b) => [...b.secrets].some((s) => liveSecrets.has(s)));
  return live.length ? Math.min(...live.map((b) => b.start)) : undefined;
}

// ---------------------------------------------------------------------------
// A fetch wrapper that records NUT-09 restore traffic. "Sent" counts unique
// blinded messages revealed to the mint; "linked" counts the issued signatures
// the mint could associate with this recovery session — the privacy metric.
// ---------------------------------------------------------------------------
function countingFetch() {
  const stats = {
    requests: 0,
    total: 0,
    sizes: [] as number[],
    sent: new Set<string>(),
    linked: new Set<string>(),
  };
  const wrapped: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const isRestore = url.endsWith('/v1/restore') && typeof init?.body === 'string';
    if (isRestore) {
      const body = JSON.parse(init!.body as string) as { outputs: Array<{ B_: string }> };
      stats.requests++;
      stats.total += body.outputs.length;
      stats.sizes.push(body.outputs.length);
      body.outputs.forEach((o) => stats.sent.add(o.B_));
    }
    // One retry on a dropped keep-alive socket: the dev mint closes idle connections
    // during the demo's long derivation pauses, and this traffic is read-only.
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch {
      res = await fetch(input, init);
    }
    if (isRestore && res.ok) {
      const data = (await res.clone().json()) as { outputs?: Array<{ B_: string }> };
      (data.outputs ?? []).forEach((o) => stats.linked.add(o.B_));
    }
    return res;
  };
  return { wrapped, stats };
}

function reportStats(label: string, stats: ReturnType<typeof countingFetch>['stats'], ms: number) {
  console.log(
    `  ${label}: ${stats.requests} requests in ${(ms / 1000).toFixed(1)}s ` +
      `(sizes: ${stats.sizes.join(', ')}),\n` +
      `  ${stats.total} messages sent (${stats.sent.size} unique), ` +
      `${stats.linked.size} issued signatures linked`,
  );
}

// ---------------------------------------------------------------------------
// Wallet operations, each tracking counters and proofs in the app store
// ---------------------------------------------------------------------------
async function mintSats(wallet: Wallet, amount: number) {
  const quote = await wallet.createMintQuoteBolt11(amount);
  while ((await wallet.checkMintQuoteBolt11(quote.quote)).state !== MintQuoteState.PAID) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const minted = await wallet.mintProofsBolt11(amount, quote, { onCountersReserved });
  proofs.push(...minted);
  track(minted);
  console.log(`Minted ${amount} sats (balance ${sumProofs(proofs)})`);
}

async function selfSwap(wallet: Wallet, amount: number) {
  // includeFees: sender covers the receive fee, so tiny amounts stay receivable
  const { keep, send } = await wallet.send(amount, proofs, {
    onCountersReserved,
    includeFees: true,
  });
  proofs = keep;
  track([...keep, ...send]);
  const received = await wallet.receive(send, { onCountersReserved });
  proofs.push(...received);
  track(received);
  console.log(`Swapped ${amount} sats through the mint (balance ${sumProofs(proofs)})`);
}

async function sendUnclaimed(wallet: Wallet, amount: number) {
  const { keep, send } = await wallet.send(amount, proofs, { onCountersReserved });
  proofs = keep;
  track([...keep, ...send]);
  sentPending.push(...send);
  console.log(`Sent a ${amount} sat token nobody claims (balance ${sumProofs(proofs)})`);
}

async function meltSats(wallet: Wallet, invoice: string) {
  const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
  const amountToMelt = meltQuote.amount.add(meltQuote.fee_reserve);
  if (sumProofs(proofs).compareTo(amountToMelt.add(30)) < 0) {
    console.log(`Balance too low to melt ${meltQuote.amount} sats; skipping the melt leg`);
    return;
  }
  const { keep, send } = await wallet.send(amountToMelt, proofs, {
    onCountersReserved,
    includeFees: true,
  });
  proofs = keep;
  track([...keep, ...send]);
  const { change } = await wallet.meltProofsBolt11(meltQuote, send, { onCountersReserved });
  proofs.push(...change);
  track(change); // NUT-08 change blanks are deterministic outputs too
  while ((await wallet.checkMeltQuoteBolt11(meltQuote.quote)).state !== MeltQuoteState.PAID) {
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(
    `Melted ${meltQuote.amount} sats over Lightning, ` +
      `${sumProofs(change)} sats change (balance ${sumProofs(proofs)})`,
  );
}

async function main() {
  // ------------------------------------------------------------------
  // Phase 1: a working wallet that backs up recovery gaps as it goes
  // ------------------------------------------------------------------
  const wallet = new Wallet(mintUrl, {
    bip39seed: seed,
    recoveryGapProvider: firstUnspentCounter,
  });
  await wallet.loadMint();

  if (!wallet.getMintInfo().isSupported(342).supported) {
    console.error('Mint does not advertise NUT-342. Run "make up" in this directory first.');
    process.exit(1);
  }
  console.log(`Mint advertises NUT-342 support (${wallet.keysetId})\n`);

  // A thorough workout: every operation writes fresh encrypted gaps.
  // Random-value swap churn approximates real wallet wear; override rounds
  // with CHURN_ROUNDS=n for a longer history.
  const churnRounds = Number(process.env.CHURN_ROUNDS ?? 4);
  const churn = async (rounds: number) => {
    for (let i = 0; i < rounds; i++) {
      const balance = Number(sumProofs(proofs).toBigInt());
      if (balance < 20) {
        console.log(`Balance ${balance} too low to keep churning; stopping early`);
        return;
      }
      await selfSwap(wallet, 1 + Math.floor(Math.random() * Math.max(1, balance / 3)));
    }
  };

  await mintSats(wallet, 10000);
  await churn(churnRounds);
  await mintSats(wallet, 15000);
  await sendUnclaimed(wallet, 21);
  try {
    await meltSats(wallet, externalInvoice);
  } catch {
    // The static invoice melts only once per mint instance. On re-runs, melt
    // one of the mint's own invoices instead (internal settlement, no change).
    // plus we don't actually mint proofs from this quote (no accounting)
    console.log('External invoice already melted on this mint; melting an internal one instead');
    const target = await wallet.createMintQuoteBolt11(2000);
    await meltSats(wallet, target.request);
  }
  await churn(churnRounds);

  const balance = sumProofs(proofs);
  const pending = sumProofs(sentPending);
  const expected = balance.add(pending);
  const nextCounter = await wallet.counters.peekNext(wallet.keysetId);
  console.log(
    `\nWallet state: ${balance} sats live + ${pending} sats sent-unclaimed, ` +
      `counters used 0..${nextCounter - 1}, first unspent counter ${await firstUnspentCounter()}`,
  );

  // ------------------------------------------------------------------
  // Phase 2: the device is lost. Recover from seed alone.
  // ------------------------------------------------------------------
  console.log('\n--- Device lost! Recovering from seed on a fresh wallet ---\n');

  const efficient = countingFetch();
  // Debug logger: recovery degrades silently (chunk retries, scan fallback) without one.
  const recovery = new Wallet(mintUrl, {
    bip39seed: seed,
    requestFetch: efficient.wrapped,
    logger: new ConsoleLogger('debug'),
  });
  await recovery.loadMint();

  // filterSpent off: the demo compares raw restore traffic and state-checks explicitly below
  const efficientStart = performance.now();
  const restored = await recovery.restoreEfficient({ filterSpent: false });
  const efficientMs = performance.now() - efficientStart;
  const { unspent } = await recovery.groupProofsByState(restored.proofs);
  console.log(
    `restoreEfficient: recovered ${sumProofs(unspent)} sats ` +
      `(${unspent.length} unspent of ${restored.proofs.length} issued, ` +
      `T=${restored.lastCounterWithSignature})`,
  );
  reportStats('NUT-342 ladder', efficient.stats, efficientMs);
  console.log(
    '  (sizes are the search: ladder, grid rounds, tile; then the d_gap window in chunks)',
  );

  // For comparison: the linear NUT-09 restore scan. Its cost grows with wallet age
  // (total counters used) and it silently misses proofs beyond the gap limit;
  // the NUT-342 batched search stays at ~4 requests regardless of age.
  const linear = countingFetch();
  const legacy = new Wallet(mintUrl, { bip39seed: seed, requestFetch: linear.wrapped });
  await legacy.loadMint();
  const scanStart = performance.now();
  // filterSpent off: restoreEfficient returns unfiltered, so the comparison stays like for like
  const scanned = await legacy.batchRestore({ filterSpent: false });
  const scanMs = performance.now() - scanStart;
  console.log(
    `\nbatchRestore:     recovered ${sumProofs(
      (await legacy.groupProofsByState(scanned.proofs)).unspent,
    )} sats`,
  );
  reportStats('NUT-09 scan   ', linear.stats, scanMs);

  if (!sumProofs(unspent).equals(expected)) {
    throw new Error(`Recovery mismatch: expected ${expected}, got ${sumProofs(unspent)}`);
  }
  console.log(
    `\nSuccess: recovered ${expected} sats = live balance (${balance}) ` +
      `+ unclaimed sent token (${pending})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
