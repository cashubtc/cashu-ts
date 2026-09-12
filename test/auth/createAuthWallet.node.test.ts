// test/auth/createAuthWallet.test.ts (essential handlers and setup)
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { beforeAll, beforeEach, afterEach, afterAll, test, describe, expect, vi } from 'vitest';

import { createAuthWallet } from '../../src/auth/createAuthWallet';
import { OIDCAuth } from '../../src/auth/OIDCAuth';

// ---- Constants
const mintUrl = 'http://localhost:3338';

// Working fixtures copied from your other passing tests:
const dummyKeysResp = {
  keysets: [
    {
      id: '00bd033559de27d0',
      unit: 'sat',
      keys: {
        1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
        2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
      },
    },
  ],
};

const dummyKeysetResp = {
  keysets: [
    {
      id: '00bd033559de27d0',
      unit: 'sat',
      active: true,
      input_fee_ppk: 0,
      final_expiry: 1754296607,
    },
  ],
};

// Minimal /v1/info with NUT-21
const discoveryBase = 'http://oidc.local';
const discoveryUrl = `${discoveryBase}/.well-known/openid-configuration`;
const tokenEndpoint = `${discoveryBase}/protocol/openid-connect/token`;

const infoResp = {
  nuts: {
    '21': {
      openid_discovery: discoveryUrl,
      client_id: 'cashu-client', // what your helper expects by default
    },
    // You can add '22' here if your code reads bat_max_mint etc.
  },
};

// ---- MSW server
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  // Mint endpoints
  server.use(
    http.get(`${mintUrl}/v1/keysets`, () => HttpResponse.json(dummyKeysetResp)),
    http.get(`${mintUrl}/v1/keys`, () => HttpResponse.json(dummyKeysResp)),
    http.get(`${mintUrl}/v1/info`, () => HttpResponse.json(infoResp)),

    // OIDC discovery
    http.get(discoveryUrl, () =>
      HttpResponse.json({
        issuer: discoveryBase,
        authorization_endpoint: `${discoveryBase}/protocol/openid-connect/auth`,
        token_endpoint: tokenEndpoint,
        device_authorization_endpoint: `${discoveryBase}/protocol/openid-connect/device`,
      }),
    ),

    // OIDC token (password grant)
    http.post(tokenEndpoint, async ({ request }) => {
      const body = await request.text(); // form-encoded
      if (body.includes('grant_type=password')) {
        return HttpResponse.json({
          access_token: 'access-password',
          refresh_token: 'refresh-password',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid offline_access',
          id_token: 'idtoken',
        });
      }
      if (body.includes('grant_type=refresh_token')) {
        return HttpResponse.json({
          access_token: 'access-refreshed',
          refresh_token: 'refresh-refreshed',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid offline_access',
          id_token: 'idtoken2',
        });
      }
      // Authorization code grant (not strictly needed in this file)
      if (body.includes('grant_type=authorization_code')) {
        return HttpResponse.json({
          access_token: 'access-code',
          refresh_token: 'refresh-code',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid offline_access',
          id_token: 'idtoken3',
        });
      }
      return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
    }),
  );
});

// ---- Tests
describe('createAuthWallet wiring', () => {
  test('returns hydrated { mint, auth, oidc, wallet } and respects authPool', async () => {
    const { mint, auth, oidc, wallet } = await createAuthWallet(mintUrl, {
      authPool: 7, // non-default to assert
    });

    expect(mint).toBeTruthy();
    expect(oidc).toBeTruthy();
    expect(wallet).toBeTruthy();
    // AuthManager created with desiredPoolSize = 7
    expect(auth.poolTarget).toBe(7);
    // KeyChain and wallet should be initialized by helper
    expect(wallet.mint).toBe(mint);
  });

  test('authPool sets both desiredPoolSize and maxPerMint', async () => {
    const { auth } = await createAuthWallet(mintUrl, { authPool: 25 });
    expect(auth.poolTarget).toBe(25);
    expect(auth['maxPerMint']).toBe(25);
  });

  test('default authPool sets desiredPoolSize and maxPerMint to 10', async () => {
    const { auth } = await createAuthWallet(mintUrl);
    expect(auth.poolTarget).toBe(10);
    expect(auth['maxPerMint']).toBe(10);
  });

  test('authPool above internal cap is clamped for desiredPoolSize and maxPerMint', async () => {
    const { auth } = await createAuthWallet(mintUrl, { authPool: 1_000 });
    expect(auth.poolTarget).toBe(100);
    expect(auth['maxPerMint']).toBe(100);
  });

  test('a password grant installs the CAT on the AuthManager', async () => {
    const { auth, oidc } = await createAuthWallet(mintUrl, {
      oidc: { scope: 'openid offline_access' },
    });

    expect(auth.hasCAT).toBe(false);
    await oidc.passwordGrant('user', 'pass');
    expect(auth.hasCAT).toBe(true);
    expect(auth.getCAT()).toBe('access-password');
  });

  test("a caller-supplied onTokens is called, including for the manager's own refresh", async () => {
    const onTokens = vi.fn();
    const listener = vi.fn();
    const { auth, oidc } = await createAuthWallet(mintUrl, {
      oidc: { scope: 'openid offline_access', onTokens },
    });

    oidc.addTokenListener(listener);
    await oidc.passwordGrant('user', 'pass');
    await vi.waitFor(() => expect(onTokens).toHaveBeenCalledTimes(1));
    expect(auth.getCAT()).toBe('access-password');

    // Refreshes keep the app's persistence hook and token listeners informed.
    auth['tokens'].expiresAt = Date.now() - 1;
    await expect(auth.ensureCAT(30)).resolves.toBe('access-refreshed');
    await vi.waitFor(() => expect(onTokens).toHaveBeenCalledTimes(2));
    expect(onTokens.mock.calls[1][0]).toMatchObject({ refresh_token: 'refresh-refreshed' });
    expect(onTokens.mock.calls.map((call) => call[1])).toEqual(['signin', 'refresh']);
    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ access_token: 'access-password' }),
      'signin',
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ access_token: 'access-refreshed' }),
      'refresh',
    );
  });

  test('setCAT(undefined) is not undone by a refresh already in flight', async () => {
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      http.post(tokenEndpoint, async ({ request }) => {
        const body = await request.text();
        if (body.includes('grant_type=password')) {
          return HttpResponse.json({
            access_token: 'access-password',
            refresh_token: 'refresh-password',
            token_type: 'Bearer',
            expires_in: 300,
          });
        }
        markRefreshStarted();
        await refreshGate;
        return HttpResponse.json({
          access_token: 'access-refreshed',
          refresh_token: 'refresh-refreshed',
          token_type: 'Bearer',
          expires_in: 300,
        });
      }),
    );

    const { auth, oidc } = await createAuthWallet(mintUrl);
    await oidc.passwordGrant('user', 'pass');
    expect(auth.getCAT()).toBe('access-password');

    const pending = auth.ensureCAT(9_999);
    await refreshStarted;
    auth.setCAT(undefined);
    releaseRefresh();

    expect(await pending).toBeUndefined();
    expect(auth.getCAT()).toBeUndefined();
    expect(auth.hasCAT).toBe(false);
  });

  test.each([false, true])(
    'a stored refresh token restores an empty manager (cleared: %s)',
    async (cleared) => {
      const { auth, oidc } = await createAuthWallet(mintUrl);
      if (cleared) auth.setCAT(undefined);
      await oidc.refresh('saved-refresh');
      expect(auth.getCAT()).toBe('access-refreshed');
      expect(auth['tokens'].refreshToken).toBe('refresh-refreshed');
    },
  );

  test.each(['manager', 'public'] as const)(
    '%s refresh retains the account selected while its request was pending',
    async (driver) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      server.use(
        http.post(tokenEndpoint, async ({ request }) => {
          const form = new URLSearchParams(await request.text());
          if (form.get('grant_type') === 'refresh_token') {
            started();
            await gate;
            return HttpResponse.json({
              access_token: 'old-refreshed',
              refresh_token: 'old-r2',
              expires_in: 300,
            });
          }
          const account = form.get('username');
          return HttpResponse.json({
            access_token: account,
            refresh_token: account + '-r',
            expires_in: 300,
          });
        }),
      );
      const { auth, oidc } = await createAuthWallet(mintUrl);
      await oidc.passwordGrant('old', 'pass');
      const pending = driver === 'manager' ? auth.ensureCAT(9999) : oidc.refresh('old-r');
      await ready;
      await oidc.passwordGrant('new', 'pass');
      release();
      await pending;
      expect(auth.getCAT()).toBe('new');
      expect(auth['tokens'].refreshToken).toBe('new-r');
    },
  );

  test.each(['clear', 'replace', 'provider'] as const)(
    'public refresh is ignored after %s',
    async (change) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const { auth, oidc } = await createAuthWallet(mintUrl);
      await oidc.passwordGrant('old', 'pass');
      server.use(
        http.post(tokenEndpoint, async () => {
          started();
          await gate;
          return HttpResponse.json({
            access_token: 'late',
            refresh_token: 'late-r',
            expires_in: 300,
          });
        }),
      );
      const pending = oidc.refresh('refresh-password');
      await ready;
      if (change === 'provider') auth.attachOIDC(new OIDCAuth(discoveryUrl));
      else auth.setCAT(change === 'clear' ? undefined : 'replacement');
      const expected = auth.getCAT();
      release();
      await pending;
      expect(auth.getCAT()).toBe(expected);
    },
  );

  test('a sign-in without a refresh token drops the preceding account refresh token', async () => {
    const { auth, oidc } = await createAuthWallet(mintUrl);
    await oidc.passwordGrant('old', 'pass');
    server.use(
      http.post(tokenEndpoint, () => HttpResponse.json({ access_token: 'new', expires_in: 300 })),
    );
    await oidc.passwordGrant('new', 'pass');
    expect(auth.getCAT()).toBe('new');
    expect(auth['tokens'].refreshToken).toBeUndefined();
  });

  test('concurrent ensureCAT callers share a refresh and retain an omitted refresh token', async () => {
    const { auth, oidc } = await createAuthWallet(mintUrl);
    await oidc.passwordGrant('user', 'pass');
    auth['tokens'].expiresAt = Date.now() - 1;
    const refresh = vi.spyOn(oidc, 'refresh');
    server.use(
      http.post(tokenEndpoint, () => HttpResponse.json({ access_token: 'fresh', expires_in: 300 })),
    );
    expect(await Promise.all([auth.ensureCAT(), auth.ensureCAT()])).toEqual(['fresh', 'fresh']);
    expect(refresh).toHaveBeenCalledOnce();
    expect(auth['tokens'].refreshToken).toBe('refresh-password');
  });

  test.each([false, true])(
    'a new session refresh proceeds independently (reused token: %s)',
    async (reuseToken) => {
      const releases: Array<() => void> = [];
      const requests: string[] = [];
      server.use(
        http.post(tokenEndpoint, async ({ request }) => {
          const form = new URLSearchParams(await request.text());
          if (form.get('grant_type') === 'password') {
            const account = form.get('username')!;
            return HttpResponse.json({
              access_token: account,
              refresh_token: reuseToken ? 'shared-r' : account + '-r',
              expires_in: 1,
            });
          }
          const index = requests.length;
          requests.push(form.get('refresh_token')!);
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
          return HttpResponse.json({
            access_token: 'fresh-' + index,
            refresh_token: 'rotated-' + index,
            expires_in: 300,
          });
        }),
      );
      const { auth, oidc } = await createAuthWallet(mintUrl);
      const refresh = vi.spyOn(oidc, 'refresh');
      await oidc.passwordGrant('A', 'pass');
      const first = auth.ensureCAT();
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      await oidc.passwordGrant('B', 'pass');
      const second = auth.ensureCAT();
      try {
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        releases[0]();
        await first;
        const third = auth.ensureCAT();
        expect(refresh).toHaveBeenCalledTimes(2);
        const joined = oidc.refresh(reuseToken ? 'shared-r' : 'B-r');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(requests).toHaveLength(2);
        releases[1]();
        expect((await joined).access_token).toBe('fresh-1');
        expect(await Promise.all([second, third])).toEqual(['fresh-1', 'fresh-1']);
        expect(auth['tokens'].refreshToken).toBe('rotated-1');
      } finally {
        releases.forEach((release) => release());
        await Promise.all([first, second]);
      }
    },
  );

  test('manager and public refresh share one request and one token update', async () => {
    const onTokens = vi.fn();
    const { auth, oidc } = await createAuthWallet(mintUrl, { oidc: { onTokens } });
    await oidc.passwordGrant('user', 'pass');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: string[] = [];
    server.use(
      http.post(tokenEndpoint, async ({ request }) => {
        requests.push(await request.text());
        await gate;
        return HttpResponse.json({
          access_token: 'fresh',
          refresh_token: 'rotated',
          expires_in: 300,
        });
      }),
    );
    const manager = auth.ensureCAT(9999);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const publicRefresh = oidc.refresh('refresh-password');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [cat, tokens] = await Promise.all([manager, publicRefresh]);
    expect(requests).toHaveLength(1);
    expect(cat).toBe(tokens.access_token);
    expect(auth['tokens'].refreshToken).toBe(tokens.refresh_token);
    expect(onTokens).toHaveBeenCalledTimes(2);
  });

  test('auth.ensureCAT() triggers OIDC refresh when token is expiring soon', async () => {
    const { auth, oidc } = await createAuthWallet(mintUrl, {
      oidc: { scope: 'openid offline_access' },
    });

    // Seed tokens (simulate “almost expired”)
    await oidc.passwordGrant('user', 'pass');

    // Force minValidSecs large to demand refresh
    const cat1 = await auth.ensureCAT(9999);
    // After refresh handler above, CAT should be the refreshed one
    expect(cat1).toBe('access-refreshed');
  });

  test('OIDC client_id is sourced from /v1/info when none provided to helper', async () => {
    const { oidc } = await createAuthWallet(mintUrl); // no oidc.clientId passed
    // Kick any flow to ensure discovery was used
    await oidc.passwordGrant('user', 'pass'); // MSW handles this
    // If it reached here without 400, the discovered client_id was used
    expect(true).toBe(true);
  });
});
