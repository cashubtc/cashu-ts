import { randomBytes } from '@noble/curves/abstract/utils';
import { type Logger, NULL_LOGGER, safeCallback } from '../logger';
import type { GetInfoResponse } from '../mint/types';
import { Bytes, encodeUint8toBase64Url } from '../utils';
import { sha256 } from '@noble/hashes/sha2';

export type OIDCConfig = {
	issuer: string;
	token_endpoint: string;
	device_authorization_endpoint?: string;
};

export type TokenResponse = {
	access_token?: string;
	token_type?: string;
	expires_in?: number;
	refresh_token?: string;
	id_token?: string;
	scope?: string;
	error?: string;
	error_description?: string;
};

export type DeviceStartResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	interval?: number;
	expires_in?: number;
};

export type OIDCAuthOptions = {
	clientId?: string;
	scope?: string;
	logger?: Logger;
	onTokens?: (t: TokenResponse) => void | Promise<void>;
};

export class OIDCAuth {
	private readonly discoveryUrl: string;
	private readonly logger: Logger;

	private clientId: string;
	private scope: string;
	private config?: OIDCConfig;
	private onTokens?: (t: TokenResponse) => void | Promise<void>;

	// External listeners, notified after onTokens fires
	private tokenListeners: Array<(t: TokenResponse) => void | Promise<void>> = [];

	static fromMintInfo(info: { nuts: GetInfoResponse['nuts'] }, opts?: OIDCAuthOptions): OIDCAuth {
		const n21 = info?.nuts?.['21'];
		if (!n21?.openid_discovery) {
			throw new Error('OIDCAuth: mint does not advertise NUT-21 openid_discovery');
		}
		const clientId = opts?.clientId ?? n21.client_id ?? 'cashu-client';
		return new OIDCAuth(n21.openid_discovery, { ...opts, clientId });
	}

	constructor(discoveryUrl: string, opts?: OIDCAuthOptions) {
		this.discoveryUrl = discoveryUrl;
		this.logger = opts?.logger ?? NULL_LOGGER;
		this.clientId = opts?.clientId ?? 'cashu-client';
		this.scope = opts?.scope ?? 'openid';
		this.onTokens = opts?.onTokens;
	}

	setClient(id: string): void {
		this.clientId = id;
	}

	setScope(scope?: string): void {
		this.scope = scope ?? 'openid';
	}

	/**
	 * Subscribe to token updates. Listeners are called after the primary onTokens callback.
	 */
	addTokenListener(fn: (t: TokenResponse) => void | Promise<void>): void {
		this.tokenListeners.push(fn);
	}

	// ---- Discovery ----

	async loadConfig(): Promise<OIDCConfig> {
		if (this.config) return this.config;
		const res = await fetch(this.discoveryUrl, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		});
		const text = await res.text();
		let json: unknown;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch (err) {
			this.logger.warn('OIDCAuth: bad discovery JSON', { err });
		}
		if (!res.ok || !json || typeof (json as OIDCConfig).token_endpoint !== 'string') {
			throw new Error('OIDCAuth: invalid discovery document (missing token_endpoint)');
		}
		const cfg = json as OIDCConfig;
		this.config = cfg;
		return cfg;
	}

	// --- Authorization Code with PKCE ---

	/**
	 * Generate a PKCE verifier and S256 challenge.
	 *
	 * - Verifier: base64url of random bytes, length >= 43, RFC 7636 compliant.
	 * - Challenge: base64url(sha256(verifier))
	 */
	generatePKCE(): { verifier: string; challenge: string } {
		// 48 bytes->base64url is typically 64 chars without padding, comfortably >= 43
		const rnd = randomBytes(48);
		const verifier = encodeUint8toBase64Url(rnd);

		// RFC 7636, challenge = BASE64URL-ENCODE( SHA256( ASCII(verifier) ) )
		const vBytes = Bytes.fromString(verifier);
		const chBytes = sha256(vBytes);
		const challenge = encodeUint8toBase64Url(chBytes);

		return { verifier, challenge };
	}

	/**
	 * Build an Authorization Code + PKCE URL.
	 */
	async buildAuthCodeUrl(input: {
		redirectUri: string;
		codeChallenge: string;
		codeChallengeMethod?: 'S256' | 'plain'; // default S256
		state?: string; // optional state to pass back to redirectUrl
		scope?: string; // default this.scope
	}): Promise<string> {
		const cfg = await this.loadConfig();
		const scope = input.scope ?? this.scope;
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: this.clientId,
			redirect_uri: input.redirectUri,
			scope,
			code_challenge_method: input.codeChallengeMethod ?? 'S256',
			code_challenge: input.codeChallenge,
		});
		if (input.state) params.set('state', input.state);

		const anyCfg = cfg as unknown as { authorization_endpoint?: string };
		if (!anyCfg.authorization_endpoint) {
			throw new Error('OIDCAuth: discovery lacks authorization_endpoint');
		}
		return `${anyCfg.authorization_endpoint}?${params.toString()}`;
	}

	/**
	 * Exchange an auth code for tokens, using the PKCE verifier.
	 */
	async exchangeAuthCode(input: { code: string; redirectUri: string; codeVerifier: string }) {
		const cfg = await this.loadConfig();
		const form = this.toForm({
			grant_type: 'authorization_code',
			code: input.code,
			redirect_uri: input.redirectUri,
			client_id: this.clientId,
			code_verifier: input.codeVerifier,
		});
		const tok = await this.postFormStrict<TokenResponse>(cfg.token_endpoint, form);
		this.handleTokens(tok);
		return tok;
	}

	// ---- Device Code (recommended for CLIs) ----

	async deviceStart(): Promise<DeviceStartResponse> {
		const cfg = await this.loadConfig();
		const ep = cfg.device_authorization_endpoint;
		if (!ep) throw new Error('OIDCAuth: provider lacks device_authorization_endpoint');

		const form = this.toForm({ client_id: this.clientId, scope: this.scope });
		return this.postFormStrict<DeviceStartResponse>(ep, form);
	}

	async devicePoll(device_code: string, intervalSec = 5): Promise<TokenResponse> {
		const cfg = await this.loadConfig();
		// Clamp to a sensible minimum to avoid hot loops
		let delay = Math.max(1, intervalSec);
		while (true) {
			await this.sleep(delay * 1000);
			const form = this.toForm({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code,
				client_id: this.clientId,
			});
			const res = await this.postFormLoose<TokenResponse>(cfg.token_endpoint, form);
			if (res.access_token) {
				this.handleTokens(res);
				return res;
			}
			const err = (res.error ?? '').toString();
			if (err === 'authorization_pending') continue;
			if (err === 'slow_down') {
				delay = Math.max(delay + 5, delay * 2);
				continue;
			}
			const msg = res.error_description || err || 'device authorization failed';
			throw new Error(`OIDCAuth: ${msg}`);
		}
	}

	/**
	 * One call convenience for Device Code flow.
	 *
	 * @remarks
	 * Polling interval will be the MAX of intervalSec and Mint interval.
	 * @param intervalSec Desired polling interval in seconds.
	 * @returns The start fields and helpers to poll or cancel.
	 */
	async startDeviceAuth(intervalSec: number = 5): Promise<
		DeviceStartResponse & {
			poll: () => Promise<TokenResponse>;
			cancel: () => void;
		}
	> {
		const start = await this.deviceStart();
		const interval = Math.max(start.interval ?? 1, intervalSec);
		let aborted = false;

		const poll = async (): Promise<TokenResponse> => {
			const cfg = await this.loadConfig();
			let delay = Math.max(1, interval);
			while (true) {
				if (aborted) throw new Error('OIDCAuth: device polling cancelled');
				await this.sleep(delay * 1000);
				const form = this.toForm({
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					device_code: start.device_code,
					client_id: this.clientId,
				});
				const res = await this.postFormLoose<TokenResponse>(cfg.token_endpoint, form);
				if (res.access_token) {
					this.handleTokens(res);
					return res;
				}
				const err = (res.error ?? '').toString();
				if (err === 'authorization_pending') continue;
				if (err === 'slow_down') {
					delay = Math.max(delay + 5, delay * 2);
					continue;
				}
				const msg = res.error_description || err || 'device authorization failed';
				throw new Error(`OIDCAuth: ${msg}`);
			}
		};

		const cancel = (): void => {
			aborted = true;
		};

		return { ...start, poll, cancel };
	}

	// ---- Refresh ----

	async refresh(refresh_token: string): Promise<TokenResponse> {
		const cfg = await this.loadConfig();
		const form = this.toForm({
			grant_type: 'refresh_token',
			refresh_token,
			client_id: this.clientId,
		});
		const tok = await this.postFormStrict<TokenResponse>(cfg.token_endpoint, form);
		this.handleTokens(tok);
		return tok;
	}

	// ---- ROPC (discouraged, but some mints allow it) ----

	async passwordGrant(username: string, password: string): Promise<TokenResponse> {
		const cfg = await this.loadConfig();
		const form = this.toForm({
			grant_type: 'password',
			client_id: this.clientId,
			username,
			password,
			scope: this.scope,
		});
		const tok = await this.postFormStrict<TokenResponse>(cfg.token_endpoint, form);
		this.handleTokens(tok);
		return tok;
	}

	// ---- internals ----

	private handleTokens(t: TokenResponse): void {
		if (!t.access_token) {
			const msg = t.error_description || t.error || 'token response missing access_token';
			throw new Error(`OIDCAuth: ${msg}`);
		}
		safeCallback(this.onTokens, t, this.logger, { where: 'OIDCAuth.handleTokens' });
		for (const listener of this.tokenListeners) {
			safeCallback(listener, t, this.logger, { where: 'OIDCAuth.handleTokens.listener' });
		}
	}

	private toForm(params: Record<string, string>): string {
		const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
		return Object.entries(params)
			.map(([k, v]) => `${enc(k)}=${enc(v)}`)
			.join('&');
	}

	// Strict, throws on non 2xx
	private async postFormStrict<TSuccess extends object>(
		endpoint: string,
		formBody: string,
	): Promise<TSuccess> {
		try {
			this.logger.debug('OIDCAuth Request', { formBody });
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: formBody,
			});
			const text = await res.text();
			let json: unknown;
			try {
				json = text ? JSON.parse(text) : undefined;
			} catch (err) {
				this.logger.warn('OIDCAuth: bad JSON (strict)', { err });
			}
			if (!res.ok) {
				const err = (json ?? {}) as TokenResponse;
				const msg = err.error_description || err.error || `HTTP ${res.status}`;
				throw new Error(`OIDCAuth: ${msg}`);
			}
			this.logger.debug('OIDCAuth Response', { json });
			return (json ?? {}) as TSuccess;
		} catch (err) {
			this.logger.error('OIDCAuth: postFormStrict failed', { err });
			throw err;
		}
	}

	// Loose, returns JSON payload even on non 2xx
	private async postFormLoose<T extends object>(
		endpoint: string,
		formBody: string,
	): Promise<T | TokenResponse> {
		try {
			this.logger.debug('OIDCAuth Request', { formBody });
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: formBody,
			});
			const text = await res.text();
			let json: unknown;
			try {
				json = text ? JSON.parse(text) : undefined;
			} catch (err) {
				this.logger.warn('OIDCAuth: bad JSON (loose)', { err });
			}
			this.logger.debug('OIDCAuth Response', { json });
			return (json ?? {}) as T | TokenResponse;
		} catch (err) {
			this.logger.error('OIDCAuth: postFormLoose network error', { err });
			return { error: 'network_error', error_description: String(err) };
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise<void>((resolve) => setTimeout(resolve, ms));
	}
}
