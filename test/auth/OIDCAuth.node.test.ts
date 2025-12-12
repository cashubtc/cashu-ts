import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect, vi } from 'vitest';

import { OIDCAuth, type OIDCConfig, type TokenResponse } from '../../src/auth/OIDCAuth';
import { Bytes, encodeUint8toBase64Url } from '../../src/utils';
import { sha256 } from '@noble/hashes/sha2.js';

const ISSUER = 'http://idp.local/realms/cashu';
const OIDC_BASE = 'http://oidc.local';
const DISCOVERY = `${OIDC_BASE}/.well-known/openid-configuration`;
const DEVICE_EP = `${OIDC_BASE}/protocol/openid-connect/device`;
const TOKEN_EP = `${OIDC_BASE}/protocol/openid-connect/token`;
const AUTH_EP = `${OIDC_BASE}/protocol/openid-connect/auth`;

const goodDiscovery: OIDCConfig & { authorization_endpoint: string } = {
	issuer: ISSUER,
	token_endpoint: TOKEN_EP,
	device_authorization_endpoint: DEVICE_EP,
	authorization_endpoint: AUTH_EP,
};

const accessOk: TokenResponse = {
	access_token: 'access.ok',
	refresh_token: 'refresh.ok',
	expires_in: 300,
	token_type: 'Bearer',
	scope: 'openid',
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------- discovery & caching ----------
describe('OIDCAuth: discovery & caching', () => {
	test('loadConfig fetches and caches discovery', async () => {
		let calls = 0;
		server.use(
			http.get(DISCOVERY, () => {
				calls++;
				return HttpResponse.json(goodDiscovery);
			}),
		);

		const oidc = new OIDCAuth(DISCOVERY);
		const cfg1 = await oidc.loadConfig();
		const cfg2 = await oidc.loadConfig();
		expect(cfg1.token_endpoint).toBe(TOKEN_EP);
		expect(cfg2).toBe(cfg1);
		expect(calls).toBe(1);
	});

	test('loadConfig throws on invalid discovery (no token_endpoint)', async () => {
		server.use(http.get(DISCOVERY, () => HttpResponse.json({ issuer: ISSUER })));
		const oidc = new OIDCAuth(DISCOVERY);
		await expect(oidc.loadConfig()).rejects.toThrow(
			'OIDCAuth: invalid discovery document, missing token_endpoint',
		);
	});

	test('loadConfig throws on non-JSON', async () => {
		server.use(http.get(DISCOVERY, () => HttpResponse.text('not-json', { status: 200 })));
		const oidc = new OIDCAuth(DISCOVERY);
		await expect(oidc.loadConfig()).rejects.toThrow('OIDCAuth: invalid discovery document');
	});
});

// ---------- PKCE + auth code ----------
describe('OIDCAuth: PKCE + auth code', () => {
	beforeEach(() => {
		server.use(http.get(DISCOVERY, () => HttpResponse.json(goodDiscovery)));
	});

	test('generatePKCE returns RFC7636-compatible values', () => {
		const oidc = new OIDCAuth(DISCOVERY);
		const { verifier, challenge } = oidc.generatePKCE();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		const expectedChallenge = encodeUint8toBase64Url(sha256(Bytes.fromString(verifier)));
		expect(challenge).toBe(expectedChallenge);
	});

	test('buildAuthCodeUrl constructs a correct URL', async () => {
		const oidc = new OIDCAuth(DISCOVERY, {
			clientId: 'cashu-client',
			scope: 'openid offline_access',
		});
		const { challenge } = oidc.generatePKCE();
		const url = await oidc.buildAuthCodeUrl({
			redirectUri: 'http://localhost:3388/callback',
			codeChallenge: challenge,
			state: 'abc123',
		});
		const u = new URL(url);
		const sp = u.searchParams;
		expect(u.origin + u.pathname).toBe(AUTH_EP);
		expect(sp.get('response_type')).toBe('code');
		expect(sp.get('client_id')).toBe('cashu-client');
		expect(sp.get('redirect_uri')).toBe('http://localhost:3388/callback');
		expect(sp.get('scope')).toBe('openid offline_access');
		expect(sp.get('code_challenge_method')).toBe('S256');
		expect(sp.get('code_challenge')).toBe(challenge);
		expect(sp.get('state')).toBe('abc123');
	});

	test('exchangeAuthCode posts correct form and fires callbacks', async () => {
		const bodies: string[] = [];
		server.use(
			http.post(TOKEN_EP, async ({ request }) => {
				bodies.push(await request.text());
				return HttpResponse.json(accessOk);
			}),
		);

		const onTokens = vi.fn();
		const listener = vi.fn();
		const oidc = new OIDCAuth(DISCOVERY, { clientId: 'cashu-client', onTokens });
		oidc.addTokenListener(listener);

		const tok = await oidc.exchangeAuthCode({
			code: 'auth_code_123',
			redirectUri: 'http://localhost:3388/callback',
			codeVerifier: 'verifier_123',
		});

		expect(tok.access_token).toBe('access.ok');
		expect(onTokens).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledTimes(1);

		expect(bodies[0]).toBe(
			'grant_type=authorization_code' +
				'&code=auth_code_123' +
				'&redirect_uri=http%3A%2F%2Flocalhost%3A3388%2Fcallback' +
				'&client_id=cashu-client' +
				'&code_verifier=verifier_123',
		);
	});

	test('exchangeAuthCode throws if provider returns 400 (strict)', async () => {
		server.use(
			http.post(TOKEN_EP, () =>
				HttpResponse.json(
					{ error: 'invalid_grant', error_description: 'code expired' },
					{ status: 400 },
				),
			),
		);
		const oidc = new OIDCAuth(DISCOVERY);
		await expect(
			oidc.exchangeAuthCode({ code: 'bad', redirectUri: 'http://cb', codeVerifier: 'v' }),
		).rejects.toThrow('OIDCAuth: code expired');
	});

	test('handleTokens throws if access_token missing', async () => {
		server.use(
			http.post(TOKEN_EP, () => HttpResponse.json({ token_type: 'Bearer' } as TokenResponse)),
		);
		const oidc = new OIDCAuth(DISCOVERY);
		await expect(
			oidc.exchangeAuthCode({ code: 'ok', redirectUri: 'http://cb', codeVerifier: 'v' }),
		).rejects.toThrow('token response missing access_token');
	});
});

// ---------- device flow ----------
describe('OIDCAuth: device flow', () => {
	beforeEach(() => {
		server.use(
			http.get(DISCOVERY, () => HttpResponse.json(goodDiscovery)),
			http.post(DEVICE_EP, () =>
				HttpResponse.json({
					device_code: 'dev-123',
					user_code: 'UCODE-123',
					verification_uri: `${ISSUER}/device`,
					verification_uri_complete: `${ISSUER}/device?user_code=UCODE-123`,
					interval: 2,
					expires_in: 600,
				}),
			),
		);
	});

	test('deviceStart returns device metadata', async () => {
		const oidc = new OIDCAuth(DISCOVERY, { clientId: 'cashu-client' });
		const start = await oidc.deviceStart();
		expect(start.device_code).toBe('dev-123');
		expect(start.user_code).toBe('UCODE-123');
	});

	test('devicePoll loops until access_token (authorization_pending → success)', async () => {
		vi.useFakeTimers();
		try {
			let polls = 0;
			server.use(
				http.post(TOKEN_EP, () => {
					polls++;
					if (polls < 3) {
						return HttpResponse.json({
							error: 'authorization_pending',
							error_description: 'pending',
						});
					}
					return HttpResponse.json(accessOk);
				}),
			);
			const oidc = new OIDCAuth(DISCOVERY, { clientId: 'cashu-client' });
			const p = oidc.devicePoll('dev-123', 1);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(1000);
			const tok = await p;
			expect(tok.access_token).toBe('access.ok');
			expect(polls).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});

	test('startDeviceAuth: cancel() aborts polling', async () => {
		const oidc = new OIDCAuth(DISCOVERY, {
			clientId: 'cashu-client',
			scope: 'openid offline_access',
		});
		// (DEVICE_EP already stubbed in beforeEach)
		const start = await oidc.startDeviceAuth(5);
		const promise = start.poll();
		start.cancel();
		// loop checks "aborted" before sleeping, no timers needed
		await expect(promise).rejects.toThrow('device polling cancelled');
	});

	test('deviceStart throws if provider lacks device_authorization_endpoint', async () => {
		server.use(
			http.get(DISCOVERY, () =>
				HttpResponse.json({
					issuer: ISSUER,
					token_endpoint: TOKEN_EP,
					authorization_endpoint: AUTH_EP,
				}),
			),
		);
		const oidc = new OIDCAuth(DISCOVERY);
		await expect(oidc.deviceStart()).rejects.toThrow(
			'provider lacks device_authorization_endpoint',
		);
	});
});

// ---------- misc ----------
describe('OIDCAuth: misc coverage', () => {
	test('toForm encodes spaces as +', async () => {
		const oidc = new OIDCAuth('http://fake/.well-known/openid-configuration');
		const out: string = oidc['toForm']({ a: 'has space', b: 'has+plus' });
		expect(out).toBe('a=has+space&b=has%2Bplus');
	});

	test('postFormLoose returns network_error on fetch failure', async () => {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
		const TOKEN = 'http://oidc/token';

		// Reuse the suite-level server. Do NOT call setupServer/listen here.
		server.use(
			// Discovery needed for loadConfig()
			http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: TOKEN })),
			// Simulate a network error at the token endpoint
			http.post(TOKEN, () => HttpResponse.error()),
		);

		const oidc = new OIDCAuth(DISCOVERY);
		await oidc.loadConfig();

		// Call the private method to hit the "loose" path
		const res = await oidc['postFormLoose'](TOKEN, 'grant_type=password');
		expect(res).toEqual({
			error: 'network_error',
			error_description: expect.any(String),
		});
	});

	test('loadConfig warns on bad JSON and throws for missing token_endpoint', async () => {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';

		// Reuse global server; just override this route for this test
		server.use(http.get(DISCOVERY, () => new HttpResponse('{not-json', { status: 200 })));

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const oidc = new OIDCAuth(DISCOVERY, { logger: console as any });

		await expect(oidc.loadConfig()).rejects.toThrow('OIDCAuth: invalid discovery document');
		expect(warn).toHaveBeenCalled(); // "OIDCAuth: bad discovery JSON"
		warn.mockRestore();
	});

	test('buildAuthCodeUrl throws if discovery lacks authorization_endpoint', async () => {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';

		// Discovery without authorization_endpoint
		server.use(
			http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: 'http://oidc/token' })),
		);

		const oidc = new OIDCAuth(DISCOVERY);
		await expect(
			oidc.buildAuthCodeUrl({
				redirectUri: 'http://cb',
				codeChallenge: 'x',
			}),
		).rejects.toThrow('discovery lacks authorization_endpoint');
	});
});

// --- setClient / setScope trivial branches
test('setClient + setScope update internals', async () => {
	const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	server.use(http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: TOKEN })));
	const oidc = new OIDCAuth(DISCOVERY, { clientId: 'orig', scope: 'openid' });
	oidc.setClient('new-client');
	oidc.setScope('openid offline_access');
	const bodies: string[] = [];
	server.use(
		http.post(TOKEN, async ({ request }) => {
			bodies.push(await request.text());
			return HttpResponse.json({ access_token: 'ok' });
		}),
	);
	// trigger a call that uses client_id/scope
	await oidc.passwordGrant('u', 'p');
	expect(bodies[0]).toContain('client_id=new-client');
	expect(bodies[0]).toContain('scope=openid+offline_access');
});

// --- devicePoll: slow_down branch expands interval
test('devicePoll handles slow_down by increasing delay', async () => {
	vi.useFakeTimers();
	try {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
		const TOKEN = 'http://oidc/token';
		server.use(http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: TOKEN })));
		let polls = 0;
		server.use(
			http.post(TOKEN, () => {
				polls++;
				if (polls === 1) {
					return HttpResponse.json({ error: 'slow_down', error_description: 'too fast' });
				}
				if (polls === 2) {
					return HttpResponse.json({ error: 'authorization_pending', error_description: 'wait' });
				}
				return HttpResponse.json({ access_token: 'ok' });
			}),
		);
		const oidc = new OIDCAuth(DISCOVERY);
		const p = oidc.devicePoll('dev-code', 1);
		// initial delay = 1s
		await vi.advanceTimersByTimeAsync(1000); // -> slow_down
		// delay bumps to 6s, next loop waits 6s
		await vi.advanceTimersByTimeAsync(6000); // -> authorization_pending
		// still 6s
		await vi.advanceTimersByTimeAsync(6000); // -> success
		const tok = await p;
		expect(tok.access_token).toBe('ok');
		expect(polls).toBe(3);
	} finally {
		vi.useRealTimers();
	}
}, 20000);

// --- devicePoll: unexpected error bubble
test('devicePoll throws on provider error (not pending/slow_down)', async () => {
	vi.useFakeTimers();
	try {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
		const TOKEN = 'http://oidc/token';
		server.use(
			http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: TOKEN })),
			http.post(TOKEN, () =>
				HttpResponse.json({ error: 'access_denied', error_description: 'nope' }),
			),
		);
		const oidc = new OIDCAuth(DISCOVERY);
		const promise = oidc.devicePoll('dev', 1);
		// attach a guard catch so Node/Vitest never sees this as "unhandled"
		// while we advance timers and only await the expect below
		// (the expect still observes the rejection)
		promise.catch(() => {});
		// first sleep(1s) then immediate provider error
		await vi.advanceTimersByTimeAsync(1000);
		// settle microtasks on this tick
		await Promise.resolve();
		await expect(promise).rejects.toThrow('nope');
	} finally {
		vi.useRealTimers();
	}
}, 10000);

// --- postFormStrict: 200 but bad JSON (warn path) returns {}
test('postFormStrict returns {} on 200 with bad JSON and logs warn', async () => {
	const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	server.use(http.get(DISCOVERY, () => HttpResponse.json({ token_endpoint: TOKEN })));

	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const oidc = new OIDCAuth(DISCOVERY, { logger: console as any });
	await oidc.loadConfig();

	server.use(http.post(TOKEN, () => new HttpResponse('{bad', { status: 200 })));
	const res = await oidc['postFormStrict'](TOKEN, 'grant_type=refresh_token');
	expect(res).toEqual({});
	expect(warn).toHaveBeenCalled(); // "bad JSON (strict)"

	warn.mockRestore();
});

test('postFormLoose logs warn on bad JSON and returns {}', async () => {
	const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
	server.use(
		http.get(DISCOVERY, () =>
			HttpResponse.json({ token_endpoint: TOKEN, authorization_endpoint: 'http://oidc/auth' }),
		),
		// Return invalid JSON body to trigger warn path
		http.post(TOKEN, () => new HttpResponse('{not-json', { status: 200 })),
	);
	const o = new OIDCAuth(DISCOVERY, { logger });
	await o.loadConfig();
	const res = await o['postFormLoose'](TOKEN, 'grant_type=device_code');
	expect(logger.warn).toHaveBeenCalledWith('OIDCAuth: bad JSON (loose)', expect.any(Object));
	expect(res).toEqual({}); // parse failed → json is undefined → returns {}
});

test('startDeviceAuth.poll handles slow_down by increasing delay', async () => {
	vi.useFakeTimers();
	try {
		const DISCOVERY = 'http://oidc/.well-known/openid-configuration';
		const TOKEN = 'http://oidc/token';
		const DEVICE = 'http://oidc/device';
		let polls = 0;
		server.use(
			http.get(DISCOVERY, () =>
				HttpResponse.json({
					token_endpoint: TOKEN,
					device_authorization_endpoint: DEVICE,
					authorization_endpoint: 'http://oidc/auth',
				}),
			),
			http.post(DEVICE, () =>
				HttpResponse.json({
					device_code: 'dev-xyz',
					user_code: 'UCODE-1',
					verification_uri: 'http://oidc/device',
					interval: 2, // start interval
					expires_in: 600,
				}),
			),
			http.post(TOKEN, () => {
				polls++;
				if (polls === 1) {
					// first POST -> slow_down
					return HttpResponse.json({ error: 'slow_down', error_description: 'too fast' });
				}
				// second POST -> success
				return HttpResponse.json({ access_token: 'ok', token_type: 'Bearer', expires_in: 300 });
			}),
		);
		const o = new OIDCAuth(DISCOVERY);
		const start = await o.startDeviceAuth(1); // max(2,1)=2 initial delay
		const p = start.poll();
		// 1st sleep: 2s → POST → slow_down
		await vi.advanceTimersByTimeAsync(2000);
		// slow_down bumps delay to max(2+5, 2*2) = 7s
		// 2nd sleep: 7s → POST → success
		await vi.advanceTimersByTimeAsync(7000);
		const tok = await p;
		expect(tok.access_token).toBe('ok');
		expect(polls).toBe(2);
	} finally {
		vi.useRealTimers();
	}
});

describe('OIDCAuth: startDeviceAuth.poll compact mix', () => {
	test('slow_down then pending then success with correct delay bump', async () => {
		vi.useFakeTimers();
		try {
			const DISC = 'http://oidc/.well-known/openid-configuration';
			const TOKEN = 'http://oidc/token';
			const DEVICE = 'http://oidc/device';
			let polls = 0;

			server.use(
				http.get(DISC, () =>
					HttpResponse.json({
						token_endpoint: TOKEN,
						device_authorization_endpoint: DEVICE,
						authorization_endpoint: 'http://oidc/auth',
					}),
				),
				http.post(DEVICE, () =>
					HttpResponse.json({
						device_code: 'dev',
						user_code: 'UCODE',
						verification_uri: 'http://oidc/device',
						interval: 1, // initial delay
						expires_in: 600,
					}),
				),
				http.post(TOKEN, () => {
					polls++;
					if (polls === 1)
						return HttpResponse.json({ error: 'slow_down', error_description: 'too fast' });
					if (polls === 2)
						return HttpResponse.json({ error: 'authorization_pending', error_description: 'wait' });
					return HttpResponse.json({ access_token: 'ok' });
				}),
			);

			const o = new OIDCAuth(DISC);
			const start = await o.startDeviceAuth(1);
			const p = start.poll();

			await vi.advanceTimersByTimeAsync(1000); // slow_down → delay becomes max(1+5, 2)=6
			await vi.advanceTimersByTimeAsync(6000); // authorization_pending, keep 6
			await vi.advanceTimersByTimeAsync(6000); // success

			const tok = await p;
			expect(tok.access_token).toBe('ok');
			expect(polls).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('OIDCAuth: startDeviceAuth uses caller interval when provider omits it', () => {
	test('initial delay = caller interval if start.interval is undefined', async () => {
		vi.useFakeTimers();
		try {
			const DISC = 'http://oidc/.well-known/openid-configuration';
			const TOKEN = 'http://oidc/token';
			const DEVICE = 'http://oidc/device';

			server.use(
				http.get(DISC, () =>
					HttpResponse.json({
						token_endpoint: TOKEN,
						device_authorization_endpoint: DEVICE,
						authorization_endpoint: 'http://oidc/auth',
					}),
				),
				http.post(DEVICE, () =>
					HttpResponse.json({
						device_code: 'dev-x',
						user_code: 'UCODE-X',
						verification_uri: 'http://oidc/device',
						// no interval here
						expires_in: 600,
					}),
				),
				http.post(TOKEN, () => HttpResponse.json({ access_token: 'ok' })),
			);

			const o = new OIDCAuth(DISC);
			const start = await o.startDeviceAuth(2); // expect initial wait to be 2s
			const p = start.poll();

			await vi.advanceTimersByTimeAsync(2000);
			const tok = await p;
			expect(tok.access_token).toBe('ok');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('OIDCAuth: postFormLoose minimal success', () => {
	test('returns parsed JSON on 200 and logs debug', async () => {
		const DISC = 'http://oidc/.well-known/openid-configuration';
		const TOKEN = 'http://oidc/token';
		const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

		server.use(
			http.get(DISC, () => HttpResponse.json({ token_endpoint: TOKEN })),
			http.post(TOKEN, () => HttpResponse.json({ ok: true })),
		);

		const o = new OIDCAuth(DISC, { logger });
		await o.loadConfig();
		const res = await o['postFormLoose'](TOKEN, 'grant_type=x');
		expect(res).toEqual({ ok: true });
		expect(logger.debug).toHaveBeenCalledWith('OIDCAuth Response', { json: { ok: true } });
	});
});

// 1) setScope(undefined) resets to 'openid'  ,  covers the nullish-coalesce branch in setScope
test('setScope(undefined) resets scope to openid', async () => {
	const DISC = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	server.use(http.get(DISC, () => HttpResponse.json({ token_endpoint: TOKEN })));
	const bodies: string[] = [];
	server.use(
		http.post(TOKEN, async ({ request }) => {
			bodies.push(await request.text());
			return HttpResponse.json({ access_token: 'ok' });
		}),
	);

	const o = new OIDCAuth(DISC, { scope: 'email profile' });
	o.setScope(undefined);
	await o.passwordGrant('u', 'p');

	expect(bodies[0]).toContain('scope=openid');
});

// 2) loadConfig, 200 with empty body  ,  covers the "text ? ... : undefined" parse branch
test('loadConfig throws on 200 with empty body', async () => {
	const DISC = 'http://oidc/.well-known/openid-configuration';
	server.use(http.get(DISC, () => new HttpResponse('', { status: 200 })));
	const o = new OIDCAuth(DISC);
	await expect(o.loadConfig()).rejects.toThrow('OIDCAuth: invalid discovery document');
});

// 3) devicePoll, empty JSON object → default message, no timers
test('devicePoll throws default message when provider returns empty object', async () => {
	const DISC = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	server.use(
		http.get(DISC, () => HttpResponse.json({ token_endpoint: TOKEN })),
		http.post(TOKEN, () => HttpResponse.json({})),
	);
	const o = new OIDCAuth(DISC);
	// Interval = 0 → no polling timers to leak
	await expect(o.devicePoll('dev', 0)).rejects.toThrow('OIDCAuth: device authorization failed');
});

// 4) postFormStrict, non 2xx with no JSON  ,  forces the "HTTP <status>" fallback message
test('postFormStrict throws HTTP <status> when non 2xx and no JSON', async () => {
	const DISC = 'http://oidc/.well-known/openid-configuration';
	const TOKEN = 'http://oidc/token';
	server.use(
		http.get(DISC, () => HttpResponse.json({ token_endpoint: TOKEN })),
		http.post(TOKEN, () => new HttpResponse('', { status: 502 })),
	);
	const o = new OIDCAuth(DISC);
	await o.loadConfig();
	await expect(o['postFormStrict'](TOKEN, 'grant_type=x')).rejects.toThrow('OIDCAuth: HTTP 502');
});
