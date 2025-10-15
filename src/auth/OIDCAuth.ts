import { type Logger, NULL_LOGGER, safeCallback } from '../logger';
import type { GetInfoResponse } from '../mint/types';

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
	clientId?: string; // default: mint’s nut21.client_id or "cashu-client"
	scope?: string; // default: "openid"
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

	setClient(id: string) {
		this.clientId = id;
	}
	setScope(scope?: string) {
		this.scope = scope ?? 'openid';
	}

	// ---- Discovery ----
	async loadConfig(): Promise<OIDCConfig> {
		if (this.config) return this.config;
		const res = await fetch(this.discoveryUrl, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		});
		const text = await res.text();
		let json: unknown = undefined;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch (err) {
			this.logger.warn?.('OIDCAuth: bad discovery JSON', { err });
		}
		if (!res.ok || !json || typeof (json as OIDCConfig).token_endpoint !== 'string') {
			throw new Error('OIDCAuth: invalid discovery document (missing token_endpoint)');
		}
		this.config = json as OIDCConfig;
		return this.config;
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
		while (true) {
			await this.sleep(intervalSec * 1000);
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
				intervalSec = Math.max(intervalSec + 5, intervalSec * 2);
				continue;
			}
			const msg = res.error_description || err || 'device authorization failed';
			throw new Error(`OIDCAuth: ${msg}`);
		}
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
	}

	private toForm(params: Record<string, string>): string {
		const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
		return Object.entries(params)
			.map(([k, v]) => `${enc(k)}=${enc(v)}`)
			.join('&');
	}

	// Strict: throws on non-2xx
	private async postFormStrict<TSuccess extends object>(
		endpoint: string,
		formBody: string,
	): Promise<TSuccess> {
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: formBody,
			});
			const text = await res.text();
			let json: unknown = undefined;
			try {
				json = text ? JSON.parse(text) : undefined;
			} catch (err) {
				this.logger.warn?.('OIDCAuth: bad JSON (strict)', { err });
			}

			if (!res.ok) {
				const err = (json ?? {}) as TokenResponse;
				const msg = err.error_description || err.error || `HTTP ${res.status}`;
				throw new Error(`OIDCAuth: ${msg}`);
			}
			return (json ?? {}) as TSuccess;
		} catch (err) {
			this.logger.error?.('OIDCAuth: postFormStrict failed', { err });
			throw err;
		}
	}

	// Loose: returns JSON (success or error payload) even on non-2xx
	private async postFormLoose<T extends object>(
		endpoint: string,
		formBody: string,
	): Promise<T | TokenResponse> {
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: formBody,
			});
			const text = await res.text();
			let json: unknown = undefined;
			try {
				json = text ? JSON.parse(text) : undefined;
			} catch (err) {
				this.logger.warn?.('OIDCAuth: bad JSON (loose)', { err });
			}
			return (json ?? {}) as T | TokenResponse;
		} catch (err) {
			this.logger.error?.('OIDCAuth: postFormLoose network error', { err });
			return { error: 'network_error', error_description: String(err) };
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise<void>((resolve) => setTimeout(resolve, ms));
	}
}
