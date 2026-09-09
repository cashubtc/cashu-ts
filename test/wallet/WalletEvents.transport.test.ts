import { Server, WebSocket } from 'mock-socket';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Amount, WSConnection, injectWebSocketImpl } from '../../src';
import type { MintQuoteBolt11Response } from '../../src';
import { WalletEvents } from '../../src/wallet/WalletEvents';

let server: Server;
let conn: WSConnection;
let events: WalletEvents;
let replay: () => void;
let cancel: (() => void) | undefined;
const cb = vi.fn();
const err = vi.fn();
const modes: string[] = [];
const paid: MintQuoteBolt11Response = {
  quote: 'q',
  request: 'invoice',
  method: 'bolt11',
  unit: 'sat',
  amount: Amount.from(1),
  amount_paid: Amount.from(1),
  amount_issued: Amount.from(0),
  expiry: null,
  updated_at: null,
  state: 'PAID',
};
const checkMintQuote = vi.fn(async () => paid);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  modes.length = 0;
  cancel = undefined;
  injectWebSocketImpl(WebSocket);
  server = new Server('ws://localhost:3991');
  conn = new WSConnection('ws://localhost:3991');
  server.on('connection', (socket) =>
    socket.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.method !== 'subscribe') return;
      replay = () => {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { status: 'OK' } }));
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'subscribe',
            params: {
              subId: m.params.subId,
              payload: { ...paid, state: 'UNPAID', amount_paid: 0 },
            },
          }),
        );
      };
    }),
  );
  const wallet = {
    mint: { connectWebSocket: () => conn.connect(), webSocketConnection: conn },
    getMintInfo: () => {
      throw new Error('not loaded');
    },
    checkMintQuote,
  };
  // @ts-expect-error only the exercised wallet surface
  events = new WalletEvents(wallet);
  const connecting = conn.connect();
  await vi.advanceTimersByTimeAsync(10);
  await connecting;
});

afterEach(() => {
  cancel?.();
  conn.close();
  server.stop();
  vi.useRealTimers();
});

it.each([
  { code: 1000, wasClean: true, reason: '' },
  { code: 1006, wasClean: false, reason: '' },
])('polls after an acknowledged subscription closes ($code)', async (close) => {
  cancel = await events.mintQuoteUpdates(['q'], cb, err, {
    pollMs: 10,
    replayTimeoutMs: 100,
    onMode: (m) => modes.push(m),
  });
  await vi.advanceTimersByTimeAsync(10);
  replay();
  await vi.advanceTimersByTimeAsync(10);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(modes).toEqual(['websocket']);
  server.close(close);
  await vi.advanceTimersByTimeAsync(150);
  expect(modes).toEqual(['websocket', 'polling']);
  expect(checkMintQuote).toHaveBeenCalled();
  expect(cb).toHaveBeenLastCalledWith(paid);
  expect(err).not.toHaveBeenCalled();
});

it.each([false, true])(
  'ignores a late acknowledgement after fallback (cancelled: %s)',
  async (cancelled) => {
    cancel = await events.mintQuoteUpdates(['q'], cb, err, {
      pollMs: 1000,
      replayTimeoutMs: 30,
      onMode: (m) => modes.push(m),
    });
    await vi.advanceTimersByTimeAsync(10);
    const lateReplay = replay;
    const sibling = vi.fn();
    const siblingId = conn.createSubscription(
      { kind: 'bolt11_mint_quote', filters: ['q'] },
      sibling,
      err,
    );
    await vi.advanceTimersByTimeAsync(40);
    expect(checkMintQuote).toHaveBeenCalledTimes(1);
    if (cancelled) cancel();
    lateReplay();
    replay(); // The other subscription's pending acknowledgement must survive cancellation.
    await vi.advanceTimersByTimeAsync(10);
    expect(modes).toEqual(['polling']);
    expect(cb).toHaveBeenCalledExactlyOnceWith(paid);
    expect(conn.activeSubscriptions).toEqual([siblingId]);
    expect(sibling).toHaveBeenCalledTimes(1);
    conn.cancelSubscription(siblingId, sibling);
    expect(err).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  'stops polling when cancelled before delivery: %s',
  async (beforeDelivery) => {
    let finish!: (quote: MintQuoteBolt11Response) => void;
    checkMintQuote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    if (!beforeDelivery) cb.mockImplementationOnce(() => cancel?.());
    cancel = await events.mintQuoteUpdates(['q'], cb, err, { pollMs: 10, replayTimeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(50);
    if (beforeDelivery) cancel();
    finish(paid);
    await vi.advanceTimersByTimeAsync(100);
    expect(cb).toHaveBeenCalledTimes(beforeDelivery ? 0 : 1);
    expect(checkMintQuote).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
  },
);
