import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bytesToHex, getPubKeyFromPrivKey, type Amount, type Wallet } from '../../../src';
import { expectValidOrRejectedAsync, runs } from '../arbitraries';

import { faultOnce } from './faulty';
import { newWorld } from './harness';
import { invoice, unit } from './mint';

type Quote = {
  quote: string;
  request: string;
  amount?: Amount | null;
  pubkey?: string;
};
type Asked = {
  quote?: string;
  request?: string;
  pubkey?: string;
  amount?: number;
  atMost?: number;
};
type Entry = (wallet: Wallet, i: number) => Promise<[Asked, () => Promise<Quote>]>;

function lockKey(i: number): string {
  return bytesToHex(getPubKeyFromPrivKey(new Uint8Array(32).fill(i + 1)));
}

function offer(i: number): string {
  return `lno1offer${i}`;
}

function address(i: number): string {
  return `bc1qaddress${i}`;
}

const create: Record<string, Entry> = {
  'Wallet.createMintQuoteBolt11': async (w, i) => [
    { pubkey: lockKey(i), amount: 2 },
    () => w.createMintQuoteBolt11(2, lockKey(i)),
  ],
  'Wallet.createMintQuoteBolt12': async (w, i) => [
    { pubkey: lockKey(i), amount: 2 },
    () => w.createMintQuoteBolt12(lockKey(i), { amount: 2 }),
  ],
  'Wallet.createMintQuoteOnchain': async (w, i) => [
    { pubkey: lockKey(i) },
    () => w.createMintQuoteOnchain(lockKey(i)),
  ],
  'Mint.createMintQuoteOnchain': async (w, i) => [
    { pubkey: lockKey(i) },
    () => w.mint.createMintQuoteOnchain({ unit, pubkey: lockKey(i) }),
  ],
  'Wallet.createMeltQuoteBolt11': async (w, i) => [
    { request: invoice(2, `${i}`), atMost: 2 },
    () => w.createMeltQuoteBolt11(invoice(2, `${i}`)),
  ],
  'Wallet.createMeltQuoteBolt12': async (w, i) => [
    { request: offer(i), atMost: 2 },
    () => w.createMeltQuoteBolt12(offer(i), 2000),
  ],
  'Wallet.createMeltQuoteOnchain': async (w, i) => [
    { request: address(i), amount: 2 },
    () => w.createMeltQuoteOnchain(address(i), 2),
  ],
  'Wallet.createMeltQuote': async (w, i) => [
    { request: `account-${i}` },
    () => w.createMeltQuote('custom', { request: `account-${i}`, amount: 2 }),
  ],
};

function check(
  name: string,
  make: (w: Wallet, i: number) => Promise<Quote>,
  read: (w: Wallet, id: string) => Promise<Quote>,
): [string, Entry] {
  return [
    name,
    async (w, i) => {
      const { quote } = await make(w, i);
      return [{ quote }, () => read(w, quote)];
    },
  ];
}

const entries: Record<string, Entry> = Object.fromEntries([
  ...Object.entries(create),
  check(
    'Wallet.checkMintQuoteBolt11',
    (w, i) => w.createMintQuoteBolt11(1, lockKey(i)),
    (w, id) => w.checkMintQuoteBolt11(id),
  ),
  check(
    'Wallet.checkMintQuoteBolt12',
    (w, i) => w.createMintQuoteBolt12(lockKey(i)),
    (w, id) => w.checkMintQuoteBolt12(id),
  ),
  check(
    'Wallet.checkMintQuoteOnchain',
    (w, i) => w.createMintQuoteOnchain(lockKey(i)),
    (w, id) => w.checkMintQuoteOnchain(id),
  ),
  check(
    'Wallet.checkMeltQuoteBolt11',
    (w, i) => w.createMeltQuoteBolt11(invoice(1, `${i}`)),
    (w, id) => w.checkMeltQuoteBolt11(id),
  ),
  check(
    'Wallet.checkMeltQuoteBolt12',
    (w, i) => w.createMeltQuoteBolt12(offer(i), 1000),
    (w, id) => w.checkMeltQuoteBolt12(id),
  ),
  check(
    'Wallet.checkMeltQuoteOnchain',
    (w, i) => w.createMeltQuoteOnchain(address(i), 1),
    (w, id) => w.checkMeltQuoteOnchain(id),
  ),
  check(
    'Wallet.checkMeltQuote',
    (w, i) => w.createMeltQuote('custom', { request: `account-${i}`, amount: 1 }),
    (w, id) => w.checkMeltQuote('custom', id),
  ),
]);

function expectAnswers(asked: Asked, q: Quote): void {
  if (asked.quote !== undefined) expect(q.quote).toBe(asked.quote);
  if (asked.request !== undefined)
    expect(q.request.toLowerCase()).toBe(asked.request.toLowerCase());
  if (asked.pubkey !== undefined) expect(q.pubkey).toBe(asked.pubkey);
  if (asked.amount !== undefined) expect(q.amount?.toBigInt()).toBe(BigInt(asked.amount));
  if (asked.atMost !== undefined) expect(q.amount!.toBigInt() <= BigInt(asked.atMost)).toBe(true);
}

/**
 * Two honest quotes give the mint something to substitute; the third request gets one response
 * altered.
 */
async function expectAnswersTheRequest(entry: Entry): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('mutate', 'replay' as const), fc.gen(), async (kind, g) => {
      const { wallet, mint } = await newWorld(0);
      for (const i of [0, 1]) {
        const [asked, ask] = await entry(wallet, i);
        expectAnswers(asked, await ask());
      }
      const [asked, ask] = await entry(wallet, 2);
      faultOnce(mint, kind, 0, g);
      await expectValidOrRejectedAsync(ask, (q) => expectAnswers(asked, q));
    }),
    { numRuns: runs(20) },
  );
}

describe('a quote the mint returns answers the request it was asked', () => {
  it.each(Object.entries(entries))(
    '%s rejects or returns a quote for the request',
    (_name, entry) => expectAnswersTheRequest(entry),
  );
});
