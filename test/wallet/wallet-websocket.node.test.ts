import { Server } from 'mock-socket';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Mint,
  Wallet,
  MeltQuoteState,
  MintQuoteState,
  type AuthProvider,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
} from '../../src';

import { mint, mintInfoResp, mintUrl, useTestServer } from './_setup';

const server = useTestServer();

describe('WebSocket Updates', () => {
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

  test('authenticates before subscribing on a protected mint', async () => {
    const authInfo = {
      ...mintInfoResp,
      nuts: {
        ...mintInfoResp.nuts,
        22: { bat_max_mint: 10, protected_endpoints: [{ method: 'GET', path: '/v1/ws' }] },
      },
    };
    server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(authInfo)));

    const fakeUrl = 'ws://localhost:3338/v1/ws';
    const wsServer = new Server(fakeUrl, { mock: false });
    const methods: string[] = [];
    wsServer.on('connection', (socket) => {
      socket.on('message', (m) => {
        const parsed = JSON.parse(m.toString());
        methods.push(parsed.method);
        if (parsed.method === 'authenticate') {
          socket.send(JSON.stringify({ jsonrpc: '2.0', result: { status: 'OK' }, id: parsed.id }));
          return;
        }
        if (parsed.method === 'subscribe') {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              result: { status: 'OK', subId: parsed.params.subId },
              id: parsed.id,
            }),
          );
          setTimeout(() => {
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'subscribe',
                params: {
                  subId: parsed.params.subId,
                  payload: { quote: '123', request: '456', state: 'PAID', expiry: 123 },
                },
              }),
            );
          }, 20);
        }
      });
    });

    const authProvider: AuthProvider = {
      getBlindAuthToken: vi.fn(async () => 'authAbat'),
      getCAT: vi.fn(() => undefined),
      setCAT: vi.fn(),
    };
    const authMint = new Mint(mintUrl, { authProvider });
    const wallet = new Wallet(authMint);
    await wallet.loadMint();

    try {
      const state = await new Promise((res, rej) => {
        wallet.on
          .mintQuoteUpdates(
            ['123'],
            (p: MintQuoteBolt11Response) => {
              if (p.state === MintQuoteState.PAID) res(p);
            },
            rej,
          )
          .catch(rej);
      });

      expect(state).toMatchObject({ quote: '123' });
      expect(authProvider.getBlindAuthToken).toHaveBeenCalledTimes(1);
      expect(methods).toEqual(['authenticate', 'subscribe']);
    } finally {
      authMint.disconnectWebSocket();
      wsServer.close();
    }
  });
});
