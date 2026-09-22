import { Server } from 'mock-socket';
import { test, describe, expect } from 'vitest';

import {
  Wallet,
  MeltQuoteState,
  MintQuoteState,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
} from '../../src';

import { mint, mintUrl, useTestServer } from './_setup';

useTestServer();

describe('WebSocket Updates', () => {
  test('wsKeepaliveMs on the wallet reaches the socket', async () => {
    const fakeUrl = 'ws://localhost:3338/v1/ws';
    const server = new Server(fakeUrl, { mock: false });
    const probes: string[] = [];
    server.on('connection', (socket) => {
      socket.on('message', (m) => {
        const parsed = JSON.parse(m.toString());
        if (parsed.method === 'unsubscribe') {
          probes.push(parsed.params.subId);
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Invalid params' },
              id: parsed.id,
            }),
          );
        }
      });
    });
    const wallet = new Wallet(mintUrl, { wsKeepaliveMs: 20 });
    try {
      await wallet.mint.connectWebSocket();
      const startedAt = Date.now();
      while (probes.length === 0) {
        if (Date.now() - startedAt > 2000) throw new Error('no keepalive probe within 2s');
        await new Promise((res) => setTimeout(res, 5));
      }
      for (const subId of probes) {
        expect(subId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
      expect(new Set(probes).size).toBe(probes.length);
    } finally {
      wallet.mint.disconnectWebSocket();
      server.close();
    }
  });

  test('mint update', async () => {
    const fakeUrl = 'ws://localhost:3338/v1/ws';
    const server = new Server(fakeUrl, { mock: false });
    server.on('connection', (socket) => {
      socket.on('message', (m) => {
        console.log(m);
        try {
          const parsed = JSON.parse(m.toString());
          if (parsed.method === 'subscribe') {
            const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
            socket.send(message);
            setTimeout(() => {
              const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "amount": 1, "state": "PAID", "paid": true, "expiry": 123}}}`;
              socket.send(message);
            }, 500);
          }
        } catch {
          console.log('Server parsing failed...');
        }
      });
    });
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const state = await new Promise((res, rej) => {
      const callback = (p: MintQuoteBolt11Response) => {
        if (p.state === MintQuoteState.PAID) {
          res(p);
        }
      };
      wallet.on
        .mintQuoteUpdates(['123'], callback, () => {
          rej(new Error('mint quote subscription error'));
        })
        .catch(rej);
    });
    expect(state).toMatchObject({ quote: '123' });
    mint.disconnectWebSocket();
    server.close();
  });
  test('melt update', async () => {
    const fakeUrl = 'ws://localhost:3338/v1/ws';
    const server = new Server(fakeUrl, { mock: false });
    server.on('connection', (socket) => {
      socket.on('message', (m) => {
        console.log(m);
        try {
          const parsed = JSON.parse(m.toString());
          if (parsed.method === 'subscribe') {
            const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
            socket.send(message);
            setTimeout(() => {
              const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "state": "PAID", "paid": true, "expiry": 123}}}`;
              socket.send(message);
            }, 500);
          }
        } catch {
          console.log('Server parsing failed...');
        }
      });
    });
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const state = await new Promise((res, rej) => {
      const callback = (p: MeltQuoteBolt11Response) => {
        console.log(p);
        if (p.state === MeltQuoteState.PAID) {
          res(p);
        }
      };
      wallet.on
        .meltQuoteUpdates(['123'], callback, (e) => {
          console.log(e);
          rej(new Error('melt quote subscription error'));
        })
        .catch(rej);
    });
    expect(state).toMatchObject({ quote: '123' });
    server.close();
  });
});
