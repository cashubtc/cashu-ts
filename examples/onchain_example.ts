import dns from 'node:dns';
import { Wallet, getEncodedToken, sumProofs } from '../src';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

dns.setDefaultResultOrder('ipv4first');

// Public CDK onchain test mint (Mutinynet / signet). Pays out and accepts
// payment in real testnet sats. Get funding sats at https://faucet.mutinynet.com/
// (login required). Mutinynet block time is ~30s, mint requires 2 confirmations.
const MINT_URL = 'https://onchain.cashudevkit.org';
const FAUCET_URL = 'https://faucet.mutinynet.com/';
// Mutinynet faucet's refund address — sending here returns sats to the faucet.
const FAUCET_REFUND_ADDRESS = 'tb1qmt3ue2senlg6ddgmr76hwsk0rdvdk4rgeaen7l';
const MEMPOOL_ADDRESS_URL = (addr: string) => `https://mutinynet.com/address/${addr}`;
const MEMPOOL_TX_URL = (txid: string) => `https://mutinynet.com/tx/${txid}`;
const POLL_INTERVAL_MS = 10_000;

const runOnchainExample = async () => {
  console.log('🚀 Onchain (NUT-XX) Wallet Example');
  console.log('===================================\n');

  const wallet = new Wallet(MINT_URL, { unit: 'sat' });
  await wallet.loadMint();

  // Per spec: payments below the mint's advertised min_amount MUST NOT count
  // toward amount_paid. Surface the mint's accepted range up-front so the human
  // doesn't waste a faucet claim on a sub-minimum payment.
  const onchainMintMethod = wallet
    .getMintInfo()
    .isSupported(4)
    .params.find((m) => m.method === 'onchain' && m.unit === 'sat');
  if (!onchainMintMethod) {
    throw new Error(`Mint at ${MINT_URL} does not support onchain mint for unit 'sat'`);
  }
  const minMint = onchainMintMethod.min_amount;
  const maxMint = onchainMintMethod.max_amount;

  // -------------------- 1. Mint --------------------
  // Each onchain mint quote is locked to a NUT-20 pubkey. We need the matching
  // privkey at mint-time to sign the mint request.
  const privateKey = randomBytes(32);
  const pubkey = bytesToHex(secp256k1.getPublicKey(privateKey));

  console.log('📋 Creating onchain mint quote');
  const mintQuote = await wallet.createMintQuoteOnchain(pubkey);
  console.log(`✅ Quote ID: ${mintQuote.quote}`);
  console.log(`\n💰 Send sats to this Bitcoin address:`);
  console.log(`\n     ${mintQuote.request}\n`);
  console.log(`📏 Mint accepts: min ${minMint} sats, max ${maxMint} sats per payment.`);
  console.log(`   Payments below the minimum will NOT be credited.\n`);
  console.log(`👉 Use the Mutinynet faucet: ${FAUCET_URL}`);
  console.log(`   Paste the address above, claim sats, and wait for 2 confirmations.\n`);

  const credited = await waitUntilCredited(wallet, mintQuote.quote);
  console.log(`\n✅ Mint detected payment: amount_paid=${credited.amount_paid.toString()} sats\n`);

  console.log(`💎 Minting proofs for ${credited.amount_paid.toString()} sats...`);
  const proofs = await wallet.mintProofsOnchain(
    credited.amount_paid,
    credited,
    bytesToHex(privateKey),
  );
  const minted = sumProofs(proofs);
  console.log(`✅ Minted ${proofs.length} proofs totalling ${minted.toString()} sats\n`);

  // -------------------- 2. Melt --------------------
  // Send sats back to the Mutinynet faucet refund address so the broadcast
  // tx can be verified visually on mempool.
  const onchainMeltMethod = wallet
    .getMintInfo()
    .isSupported(5)
    .params.find((m) => m.method === 'onchain' && m.unit === 'sat');
  if (!onchainMeltMethod) {
    throw new Error(`Mint at ${MINT_URL} does not support onchain melt for unit 'sat'`);
  }
  console.log(`📋 Melting back to the Mutinynet faucet refund address`);
  console.log(`   destination: ${FAUCET_REFUND_ADDRESS}`);
  console.log(`   verify on:   ${MEMPOOL_ADDRESS_URL(FAUCET_REFUND_ADDRESS)}`);
  console.log(
    `   mint accepts melt: min ${onchainMeltMethod.min_amount} sats, max ${onchainMeltMethod.max_amount} sats\n`,
  );

  // We want to send as much as possible. The proofs sent to the mint must cover:
  //   melt_amount + fee_reserve (mint's onchain fee buffer) + input_fee (NUT-02
  //   per-proof swap fee, scales with how many proofs we spend).
  // fee_reserve depends on tx shape (mostly fixed for one P2WPKH output);
  // input_fee depends on which proofs are selected. We start optimistically
  // (try to send everything), then scale down once we know fee_reserve.

  const inputFee = wallet.getFeesForProofs(proofs);
  const pickCheapest = (q: { fee_options: typeof meltQuote.fee_options }) =>
    q.fee_options.reduce((a, b) => (a.fee_reserve.lessThan(b.fee_reserve) ? a : b));

  console.log(`📋 First pass: requesting melt quote for full ${minted.toString()} sats`);
  let meltAmount = minted;
  let meltQuote = await wallet.createMeltQuoteOnchain(FAUCET_REFUND_ADDRESS, meltAmount);
  let cheapest = pickCheapest(meltQuote);
  console.log(`   fee_reserve (cheapest option): ${cheapest.fee_reserve.toString()} sats`);
  console.log(`   input_fee (NUT-02, all ${proofs.length} proofs): ${inputFee.toString()} sats`);

  let needed = meltAmount.add(cheapest.fee_reserve).add(inputFee);
  if (needed.greaterThan(minted)) {
    // Doesn't fit. Scale down to leave room for fee_reserve and input_fee.
    // For onchain, fee_reserve is fairly stable across amounts, so a single
    // adjustment suffices. In production code you may want a 1-sat safety
    // margin to absorb fee_reserve drift between quote requests or unexpected
    // coin-selection swaps.
    meltAmount = minted.subtract(cheapest.fee_reserve).subtract(inputFee);
    if (meltAmount.lessThanOrEqual(0)) {
      throw new Error(
        `Cannot fit melt: minted=${minted}, fee_reserve=${cheapest.fee_reserve}, input_fee=${inputFee}`,
      );
    }
    console.log(`\n📋 Second pass: requesting melt quote for ${meltAmount.toString()} sats`);
    meltQuote = await wallet.createMeltQuoteOnchain(FAUCET_REFUND_ADDRESS, meltAmount);
    cheapest = pickCheapest(meltQuote);
    console.log(`   fee_reserve: ${cheapest.fee_reserve.toString()} sats`);
    needed = meltAmount.add(cheapest.fee_reserve).add(inputFee);
  }

  console.log(
    `\n   melt_amount + fee_reserve + input_fee = ${needed.toString()} sats (have ${minted.toString()})`,
  );
  console.log(`✅ Melt quote ID: ${meltQuote.quote}`);
  console.log(`   fee_options:`);
  for (const opt of meltQuote.fee_options) {
    console.log(
      `     - ${opt.fee_reserve.toString()} sats reserve, ~${opt.estimated_blocks} blocks`,
    );
  }
  console.log(
    `\n👉 Selected cheapest: ${cheapest.fee_reserve.toString()} sats reserve, ~${cheapest.estimated_blocks} blocks\n`,
  );

  // Coin-select proofs covering amount + fee_reserve (input fees added by send())
  const totalNeeded = meltAmount.add(cheapest.fee_reserve);
  const sendResp = await wallet.send(totalNeeded, proofs, { includeFees: true });

  console.log(`💸 Executing melt...`);
  const response = await wallet.meltProofsOnchain(
    meltQuote,
    sendResp.send,
    cheapest.estimated_blocks,
  );
  console.log(`✅ Melt accepted: state=${response.quote.state}`);
  if (response.change.length > 0) {
    console.log(
      `   change: ${sumProofs(response.change).toString()} sats in ${response.change.length} proof(s)`,
    );
  }

  // The mint typically returns PENDING with no outpoint until it broadcasts the
  // tx. Per NUT-XX, mints MAY batch multiple melts into a single onchain tx,
  // so broadcast can be delayed until enough volume accumulates — there's no
  // SLA on how long PENDING lasts. Poll until the outpoint appears.
  if (!response.quote.outpoint) {
    console.log(`   (mint may batch melts; broadcast can take a while)`);
  }
  const broadcast = response.quote.outpoint
    ? response.quote
    : await waitUntilBroadcast(wallet, response.quote.quote);
  const txid = broadcast.outpoint?.split(':')[0];
  console.log(`✅ Broadcast: outpoint=${broadcast.outpoint}`);
  if (txid) {
    console.log(`   tx on mempool: ${MEMPOOL_TX_URL(txid)}`);
  }

  // -------------------- Summary --------------------
  const remainingProofs = [...sendResp.keep, ...response.change];
  console.log(`\n🎯 Summary`);
  console.log(`==========`);
  console.log(`💰 Started:    ${minted.toString()} sats minted from faucet payment`);
  console.log(`📤 Melted:     ${meltAmount.toString()} sats to ${FAUCET_REFUND_ADDRESS}`);
  console.log(
    `⛓️  Fee reserve: ${cheapest.fee_reserve.toString()} sats (mint may return unused as change)`,
  );
  console.log(`🔧 Input fee:  ${inputFee.toString()} sats (NUT-02 swap fee)`);
  console.log(
    `💼 Remaining:  ${sumProofs(remainingProofs).toString()} sats in ${remainingProofs.length} proof(s)`,
  );
  if (remainingProofs.length > 0) {
    const token = getEncodedToken({ mint: MINT_URL, proofs: remainingProofs, unit: 'sat' });
    console.log(`🎟️  Token (redeem in any cashu wallet pointed at ${MINT_URL}):`);
    console.log(`     ${token}`);
  }
  if (txid) {
    console.log(`🔍 Verify melt tx: ${MEMPOOL_TX_URL(txid)}`);
  } else {
    console.log(`🔍 Verify melt on mempool: ${MEMPOOL_ADDRESS_URL(FAUCET_REFUND_ADDRESS)}`);
  }
  console.log(`✅ Onchain example completed!`);
};

// Heartbeat helpers: write a dot per poll, terminate the dots line whenever
// something new gets printed so the output stays readable.
let dotsActive = false;
const tickDot = () => {
  process.stdout.write('. ');
  dotsActive = true;
};
const endDots = () => {
  if (dotsActive) {
    process.stdout.write('\n');
    dotsActive = false;
  }
};

const waitUntilCredited = async (wallet: Wallet, quoteId: string) => {
  console.log(
    `⏳ Waiting for mint to detect payment (polling every ${POLL_INTERVAL_MS / 1000}s, Ctrl-C to abort)...`,
  );
  let lastPaid = '0';
  while (true) {
    const quote = await wallet.checkMintQuoteOnchain(quoteId);
    const paidStr = quote.amount_paid.toString();
    if (paidStr !== lastPaid) {
      endDots();
      console.log(`   amount_paid: ${paidStr}`);
      lastPaid = paidStr;
    }
    if (quote.amount_paid.greaterThan(quote.amount_issued)) {
      endDots();
      return quote;
    }
    tickDot();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
};

const waitUntilBroadcast = async (wallet: Wallet, quoteId: string) => {
  console.log(
    `⏳ Waiting for mint to broadcast (polling every ${POLL_INTERVAL_MS / 1000}s, Ctrl-C to abort)...`,
  );
  let lastState: string | undefined;
  while (true) {
    const quote = await wallet.checkMeltQuoteOnchain(quoteId);
    if (quote.state !== lastState) {
      endDots();
      console.log(`   state: ${quote.state}`);
      lastState = quote.state;
    }
    if (quote.outpoint) {
      endDots();
      return quote;
    }
    tickDot();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
};

runOnchainExample().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
