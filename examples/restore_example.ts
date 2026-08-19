/**
 * NUT-13 seed recovery, and what each scan costs.
 *
 * A wallet gets a workout (two mints, random-value swap churn, a Lightning melt with NUT-08 change,
 * and one sent token nobody claims), then fresh wallets with the same seed recover from it three
 * ways:
 *
 * - `filterSpent: false` — restore every issued counter, drop the spent ones afterwards.
 * - `filterSpent: true` (the default) — state check each batch, restore only what is live.
 * - The default again at a smaller `batchSize`, which shrinks how far the scan overshoots.
 *
 * A never-used seed then recovers from the same mint both ways. That is the shape of most keysets a
 * multi-mint recovery scans (nothing issued, everything reports UNSPENT and is restored anyway),
 * and it prices the state check when there is nothing for it to skip.
 *
 * All three recover the same balance; what differs is the traffic. The report shows how many `B_`
 * and `Y` the wallet reveals and how many of those the mint has a record of. Only the wallet that
 * built an output can reproduce its `B_`, so a recognised one is close to proof of authorship,
 * while a `Y` travels with the token and is answered for anyone by an open oracle, making it much
 * weaker evidence. Revealing both for the same counter ties an issuance to its spend, which
 * blinding otherwise prevents.
 *
 * Env knobs: CHURN_ROUNDS, SPEND_FRAC, PIN_MID, BATCH (see main); RESTORE_MS, CHECK_MS (see
 * countingFetch).
 */
import dns from 'node:dns';

import { bytesToHex } from '@noble/curves/utils.js';
import { randomBytes } from '@noble/hashes/utils.js';

import {
  CheckStateEnum,
  MeltQuoteState,
  MintQuoteState,
  Wallet,
  createSecretAndBlindingFactorDeriver,
  sumProofs,
  type Proof,
} from '../src';

dns.setDefaultResultOrder('ipv4first');

const mintUrl = 'http://localhost:3338';
const seed = randomBytes(64);

// A 2000 sat bolt11 invoice; the FakeWallet backend "pays" it instantly.
const externalInvoice =
  'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

let proofs: Proof[] = []; // live wallet proofs
const sentPending: Proof[] = []; // sent, not yet claimed by the receiver

// ---------------------------------------------------------------------------
// A fetch wrapper that records recovery traffic on both endpoints.
//
// "revealed" counts the unique points the wallet hands the mint; "recognised" counts the ones
// the mint has a record of, which is the privacy cost. A B_ is recognised when the mint returns
// its signature; a Y is recognised when it comes back SPENT or PENDING (an unknown Y is reported
// UNSPENT by both reference mints, so it is indistinguishable from a live proof and matches
// nothing). Revealing both for the same counter joins an issuance to its spend, which blinding
// otherwise makes impossible.
// ---------------------------------------------------------------------------
function countingFetch() {
  const stats = {
    restoreRequests: 0,
    checkRequests: 0,
    bRevealed: new Set<string>(),
    bRecognised: new Set<string>(),
    yRevealed: new Set<string>(),
    yRecognised: new Set<string>(),
  };
  const wrapped: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const isRestore = url.endsWith('/v1/restore') && body !== undefined;
    const isCheck = url.endsWith('/v1/checkstate') && body !== undefined;
    if (isRestore) {
      stats.restoreRequests++;
      (JSON.parse(body!) as { outputs: { B_: string }[] }).outputs.forEach((o) =>
        stats.bRevealed.add(o.B_),
      );
    }
    if (isCheck) {
      stats.checkRequests++;
      (JSON.parse(body!) as { Ys: string[] }).Ys.forEach((y) => stats.yRevealed.add(y));
    }
    // RESTORE_MS / CHECK_MS add synthetic latency per request, modelling mints whose endpoints
    // respond at different speeds. Real mints differ by an order of magnitude here, and it decides
    // the outcome: a slow /v1/restore rewards the state-checked scan, a slow /v1/checkstate
    // punishes it.
    const delayMs = isRestore
      ? Number(process.env.RESTORE_MS ?? 0)
      : isCheck
        ? Number(process.env.CHECK_MS ?? 0)
        : 0;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    // One retry on a dropped keep-alive socket: the dev mint closes idle connections during
    // the demo's long derivation pauses, and this traffic is read-only.
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch {
      res = await fetch(input, init);
    }
    if (isRestore && res.ok) {
      const data = (await res.clone().json()) as { outputs?: { B_: string }[] };
      (data.outputs ?? []).forEach((o) => stats.bRecognised.add(o.B_));
    }
    if (isCheck && res.ok) {
      const data = (await res.clone().json()) as { states?: { Y: string; state: string }[] };
      (data.states ?? []).forEach((s) => {
        if (s.state !== CheckStateEnum.UNSPENT) stats.yRecognised.add(s.Y);
      });
    }
    return res;
  };
  return { wrapped, stats };
}

function report(label: string, stats: ReturnType<typeof countingFetch>['stats'], ms: number) {
  const requests = stats.restoreRequests + stats.checkRequests;
  console.log(
    `  ${label}: ${requests} requests in ${(ms / 1000).toFixed(1)}s ` +
      `(${stats.restoreRequests} restore, ${stats.checkRequests} checkstate)\n` +
      `  revealed ${stats.bRevealed.size} B_ and ${stats.yRevealed.size} Y; ` +
      `mint recognised ${stats.bRecognised.size} B_ and ${stats.yRecognised.size} Y ` +
      `(${stats.bRecognised.size + stats.yRecognised.size} linked)`,
  );
}

// ---------------------------------------------------------------------------
// Wallet operations
// ---------------------------------------------------------------------------
async function mintSats(wallet: Wallet, amount: number) {
  const quote = await wallet.createMintQuoteBolt11(amount);
  while ((await wallet.checkMintQuoteBolt11(quote.quote)).state !== MintQuoteState.PAID) {
    await new Promise((r) => setTimeout(r, 200));
  }
  proofs.push(...(await wallet.mintProofsBolt11(amount, quote)));
  console.log(`Minted ${amount} sats (balance ${sumProofs(proofs)})`);
}

async function selfSwap(wallet: Wallet, amount: number) {
  // includeFees: sender covers the receive fee, so tiny amounts stay receivable
  const { keep, send } = await wallet.send(amount, proofs, { includeFees: true });
  proofs = keep;
  proofs.push(...(await wallet.receive(send)));
  console.log(`Swapped ${amount} sats through the mint (balance ${sumProofs(proofs)})`);
}

async function sendUnclaimed(wallet: Wallet, amount: number) {
  const { keep, send } = await wallet.send(amount, proofs);
  proofs = keep;
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
  const { keep, send } = await wallet.send(amountToMelt, proofs, { includeFees: true });
  proofs = keep;
  let change: Proof[];
  try {
    ({ change } = await wallet.meltProofsBolt11(meltQuote, send));
  } catch (e) {
    // A failed melt may or may not have consumed its inputs. Take back whichever are still
    // live: dropping them would leave balance sitting at the mint that this demo no longer
    // tracks, which then turns up during recovery as a mismatch.
    const { unspent, pending } = await wallet.groupProofsByState(send);
    proofs.push(...unspent, ...pending);
    throw e;
  }
  proofs.push(...change); // NUT-08 change blanks are deterministic outputs too
  while ((await wallet.checkMeltQuoteBolt11(meltQuote.quote)).state !== MeltQuoteState.PAID) {
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(
    `Melted ${meltQuote.amount} sats over Lightning, ` +
      `${sumProofs(change)} sats change (balance ${sumProofs(proofs)})`,
  );
}

/**
 * Where the live proofs actually sit in the counter space.
 *
 * The scan returns proofs, not counters, so rebuild the secret-to-counter map from the seed. The
 * spread between the oldest live counter and T is what a backwards scan with an early stop would
 * have to cover, so it says whether that stop is worth having.
 */
function liveWindow(walletSeed: Uint8Array, keysetId: string, found: Proof[], T: number) {
  const derive = createSecretAndBlindingFactorDeriver(walletSeed, keysetId);
  const counterBySecret = new Map<string, number>();
  for (let c = 0; c <= T; c++) {
    try {
      counterBySecret.set(bytesToHex(derive(c).secret), c);
    } catch {
      continue;
    }
  }
  const counters = found
    .map((p) => counterBySecret.get(p.secret))
    .filter((c): c is number => c !== undefined)
    .sort((a, b) => a - b);
  if (counters.length === 0) return 'none located';
  const oldest = counters[0];
  return `${counters.length} live at counters ${oldest}..${counters[counters.length - 1]}, so the oldest sits ${T - oldest} below T`;
}

async function recover(
  label: string,
  filterSpent: boolean,
  expected: ReturnType<typeof sumProofs>,
  batchSize?: number,
  walletSeed: Uint8Array = seed,
) {
  const counted = countingFetch();
  const wallet = new Wallet(mintUrl, { bip39seed: walletSeed, requestFetch: counted.wrapped });
  await wallet.loadMint();
  const start = performance.now();
  const { proofs: all, lastCounters } = await wallet.restoreAll({ filterSpent, batchSize });
  // filterSpent: false returns every issued proof, so filter locally for a like-for-like total
  const found = filterSpent ? all : (await wallet.groupProofsByState(all)).unspent;
  const ms = performance.now() - start;
  const recovered = sumProofs(found);
  console.log(`\n${label}: recovered ${recovered} sats (T=${JSON.stringify(lastCounters)})`);
  report(label, counted.stats, ms);
  for (const [keysetId, T] of Object.entries(lastCounters)) {
    console.log(`  ${keysetId.slice(0, 8)}…: ${liveWindow(walletSeed, keysetId, found, T)}`);
  }
  if (!recovered.equals(expected)) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${recovered}`);
  }
}

async function main() {
  const wallet = new Wallet(mintUrl, { bip39seed: seed });
  await wallet.loadMint();
  console.log(`Churning a wallet on ${mintUrl} (${wallet.keysetId})\n`);

  //   CHURN_ROUNDS=n  swap rounds per churn block (default 4)
  //   SPEND_FRAC=f    max spend as a fraction of balance; small values model a lump-funded
  //                   wallet making everyday payments, which leaves old proofs live (default 0.9)
  //   PIN_MID=1       send the unclaimed token mid-history rather than at the end
  //   BATCH=n         batchSize for every leg except the @100 one (default: the mint's
  //                   advertised cap); the client does one derivation, Y and blinded message
  //                   per counter in a batch, so this also sweeps the crypto cost per wave
  const churnRounds = Number(process.env.CHURN_ROUNDS ?? 4);
  const spendFrac = Number(process.env.SPEND_FRAC ?? 0.9);
  const pinMid = process.env.PIN_MID === '1';
  const batchSize = process.env.BATCH ? Number(process.env.BATCH) : undefined;
  const churn = async (rounds: number) => {
    for (let i = 0; i < rounds; i++) {
      const balance = Number(sumProofs(proofs).toBigInt());
      if (balance < 20) {
        console.log(`Balance ${balance} too low to keep churning; stopping early`);
        return;
      }
      try {
        await selfSwap(wallet, 1 + Math.floor(Math.random() * Math.max(1, balance * spendFrac)));
      } catch (e) {
        // A low SPEND_FRAC fragments the wallet, and eventually the fee on the inputs a send
        // needs is more than the dust can cover. That is a legitimate wallet to recover from,
        // so stop churning rather than give up on the run.
        console.log(`Cannot swap further (${(e as Error).message}); stopping the churn early`);
        return;
      }
    }
  };

  await mintSats(wallet, 10000);
  await churn(churnRounds);
  await mintSats(wallet, 15000);
  if (pinMid) await sendUnclaimed(wallet, 21);
  try {
    await meltSats(wallet, externalInvoice);
  } catch {
    // The static invoice melts only once per mint instance. On re-runs, melt one of the
    // mint's own invoices instead (internal settlement, no change).
    console.log('External invoice already melted on this mint; melting an internal one instead');
    const target = await wallet.createMintQuoteBolt11(2000);
    await meltSats(wallet, target.request);
  }
  await churn(churnRounds);
  if (!pinMid) await sendUnclaimed(wallet, 21);

  const balance = sumProofs(proofs);
  const pending = sumProofs(sentPending);
  const expected = balance.add(pending);
  const nextCounter = await wallet.counters.peekNext(wallet.keysetId);
  console.log(
    `\nWallet state: ${balance} sats live + ${pending} sats sent-unclaimed, ` +
      `counters used 0..${nextCounter - 1}`,
  );

  console.log('\n--- Device lost! Recovering from seed on a fresh wallet ---');
  await recover('filterSpent off     ', false, expected, batchSize);
  await recover('filterSpent on      ', true, expected, batchSize);
  await recover('filterSpent on @100 ', true, expected, 100);

  // The empty-scan leg: a seed this mint has never signed for. Every counter reports UNSPENT and
  // is restored regardless, so the state check can skip nothing and its cost shows undiluted.
  console.log('\n--- Never-used seed: scanning a mint with nothing to find ---');
  const freshSeed = randomBytes(64);
  await recover('fresh seed, off     ', false, sumProofs([]), batchSize, freshSeed);
  await recover('fresh seed, on      ', true, sumProofs([]), batchSize, freshSeed);

  console.log(
    `\nSuccess: both recovered ${expected} sats = ${balance} live + ${pending} unclaimed`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
