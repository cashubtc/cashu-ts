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
 * Flow: a wallet with a `recoveryGapProvider` gets a thorough workout — two mints, several swap
 * rounds, a Lightning melt with NUT-08 change, and one sent token that is never claimed. Every
 * operation backs up an encrypted recovery gap on the mint. Then a second wallet with the same seed
 * recovers everything via `restoreEfficient()`, including the unclaimed token. A plain
 * `batchRestore()` (NUT-13 linear scan) runs last for comparison.
 */
import { randomBytes } from '@noble/hashes/utils.js';

import { MeltQuoteState, MintQuoteState, Wallet, sumProofs, type Proof } from '../../src';

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
// A fetch wrapper that records NUT-09 restore traffic (requests + nonces).
// ---------------------------------------------------------------------------
function countingFetch() {
  const stats = { requests: 0, nonces: 0, sizes: [] as number[] };
  const wrapped: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/restore') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { outputs: unknown[] };
      stats.requests++;
      stats.nonces += body.outputs.length;
      stats.sizes.push(body.outputs.length);
    }
    return fetch(input, init);
  };
  return { wrapped, stats };
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
  const { keep, send } = await wallet.send(amount, proofs, { onCountersReserved });
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

  // A thorough workout: every operation writes fresh encrypted gaps
  await mintSats(wallet, 1000);
  await selfSwap(wallet, 400);
  await selfSwap(wallet, 150);
  await mintSats(wallet, 1500);
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
  await selfSwap(wallet, 100);
  await selfSwap(wallet, 42);

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
  const recovery = new Wallet(mintUrl, { bip39seed: seed, requestFetch: efficient.wrapped });
  await recovery.loadMint();

  const restored = await recovery.restoreEfficient();
  const { unspent } = await recovery.groupProofsByState(restored.proofs);
  console.log(
    `restoreEfficient: recovered ${sumProofs(unspent)} sats ` +
      `(${unspent.length} unspent of ${restored.proofs.length} issued, ` +
      `T=${restored.lastCounterWithSignature})`,
  );
  console.log(
    `  ${efficient.stats.requests} restore requests, ${efficient.stats.nonces} nonces revealed ` +
      `(final window: ${efficient.stats.sizes.at(-1)} nonces)`,
  );
  if (efficient.stats.sizes.slice(0, -1).every((s) => s <= 25)) {
    console.log('  all search requests were <=25-nonce probes: the NUT-342 path ran, no fallback');
  }

  // For comparison: the NUT-13 linear scan. Its cost grows with wallet age
  // (total counters used) and it silently misses proofs beyond the gap limit;
  // the NUT-342 search stays at ~30 requests regardless of age.
  const linear = countingFetch();
  const legacy = new Wallet(mintUrl, { bip39seed: seed, requestFetch: linear.wrapped });
  await legacy.loadMint();
  const scanned = await legacy.batchRestore();
  console.log(
    `\nbatchRestore:     recovered ${sumProofs(
      (await legacy.groupProofsByState(scanned.proofs)).unspent,
    )} sats`,
  );
  console.log(`  ${linear.stats.requests} restore requests, ${linear.stats.nonces} nonces sent`);

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
