import type { AuthProvider } from './AuthProvider';
import request, { type RequestFn } from '../transport';
import { joinUrls, hasValidDleq, encodeJsonToBase64 } from '../utils';
import { MintInfo } from '../model/MintInfo';
import { OutputData } from '../model/OutputData';
import type { MintActiveKeys, MintAllKeysets, MintKeys, MintKeyset, Proof } from '../model/types';
import { type GetInfoResponse, type BlindAuthMintResponse } from '../mint/types';
import { type Logger, NULL_LOGGER } from '../logger';
import { type OIDCAuth, type TokenResponse } from './OIDCAuth';

export type AuthManagerOptions = {
	/**
	 * Hard limit to target when minting BATs in one request. If omitted, we'll read
	 * `nuts['22'].bat_max_mint` from the mint "/v1/info" endpoint.
	 */
	maxPerMint?: number;
	/**
	 * Desired BAT pool size. We’ll top-up to min(desiredPoolSize, bat_max_mint) on demand.
	 */
	desiredPoolSize?: number;
	/**
	 * Custom request fn (e.g. for tests or host env).
	 */
	request?: RequestFn;
	/**
	 * Logger.
	 */
	logger?: Logger;
};

type StoredTokens = {
	accessToken?: string;
	refreshToken?: string;
	/**
	 * Epoch timestamp (ms).
	 */
	expiresAt?: number;
};

/**
 * AuthManager.
 *
 * - Owns CAT lifecycle (stores, optional refresh via attached OIDCAuth)
 * - Mints and serves BATs (NUT-22)
 * - Validates DLEQs for BATs per NUT-12.
 * - Supplies serialized BATs for 'Blind-auth' and CAT for 'Clear-auth'
 */
export class AuthManager implements AuthProvider {
	private readonly mintUrl: string;
	private readonly req: RequestFn;
	private readonly logger: Logger;
	private info?: MintInfo;
	private lockChain?: Promise<void>;

	// Open ID Connect (OIDC)
	private oidc?: OIDCAuth;
	private tokens: StoredTokens = {};

	// Blind Auth Token (BAT) pool
	private pool: Proof[] = [];
	private desiredPoolSize = 10;
	private maxPerMint = 10;

	// Key cache for 'auth' unit
	private keysets: MintKeyset[] = [];
	private keysById: Map<string, MintKeys> = new Map();
	private activeKeysetId?: string;

	constructor(mintUrl: string, opts?: AuthManagerOptions) {
		this.mintUrl = mintUrl;
		this.req = opts?.request ?? request;
		this.logger = opts?.logger ?? NULL_LOGGER;
		this.desiredPoolSize = Math.max(1, opts?.desiredPoolSize ?? this.desiredPoolSize);
		this.maxPerMint = Math.max(1, opts?.maxPerMint ?? this.maxPerMint);
	}

	// ------------------------------
	// Public API
	// ------------------------------

	/**
	 * Attach an OIDCAuth instance so this manager can refresh CATs. Registers a listener to update
	 * internal CAT/refresh state on new tokens.
	 */
	attachOIDC(oidc: OIDCAuth): this {
		this.oidc = oidc;
		this.oidc.addTokenListener((t) => this.updateFromOIDC(t));
		return this;
	}

	get poolSize(): number {
		return this.pool.length;
	}
	get poolTarget(): number {
		return this.desiredPoolSize;
	}
	get activeAuthKeysetId(): string | undefined {
		return this.activeKeysetId;
	}
	get hasCAT(): boolean {
		return !!this.tokens.accessToken;
	}

	// ------------------------------
	// AuthProvider (NUT-21, Clear-auth)
	// ------------------------------

	getCAT(): string | undefined {
		return this.tokens.accessToken;
	}

	setCAT(cat: string | undefined): void {
		this.tokens.accessToken = cat;
		if (!cat) {
			this.tokens.refreshToken = undefined;
			this.tokens.expiresAt = undefined;
		}
	}

	/**
	 * Ensure a valid CAT is available (refresh if expiring soon). Returns a token safe to send right
	 * now, or undefined if unobtainable.
	 */
	async ensureCAT(minValidSecs = 30): Promise<string | undefined> {
		if (this.validForAtLeast(minValidSecs)) {
			return this.tokens.accessToken;
		}
		if (this.oidc && this.tokens.refreshToken) {
			try {
				const tok = await this.oidc.refresh(this.tokens.refreshToken);
				this.updateFromOIDC(tok);
				if (this.validForAtLeast(0)) return this.tokens.accessToken;
			} catch (err) {
				this.logger.warn('AuthManager: CAT refresh failed', { err });
			}
		}
		return this.tokens.accessToken;
	}

	// Returns true if expiry date is >minValidSecs away
	private validForAtLeast(minValidSecs: number): boolean {
		const { accessToken, expiresAt } = this.tokens;
		if (!accessToken) return false;
		if (!expiresAt) return true; // Unknown expiry, allow and rely on server to reject if invalid
		return Date.now() + minValidSecs * 1000 < expiresAt;
	}

	private updateFromOIDC(t: TokenResponse): void {
		if (!t.access_token) return;
		const now = Date.now();
		this.tokens.accessToken = t.access_token;
		// prefer new refresh token if provided, else keep existing
		if (t.refresh_token) this.tokens.refreshToken = t.refresh_token;
		this.tokens.expiresAt = t.expires_in ? now + t.expires_in * 1000 : undefined;
		this.logger.debug('AuthManager: OIDC tokens updated', { expiresAt: this.tokens.expiresAt });
	}

	// ------------------------------
	// AuthProvider (NUT-22, Blind-auth)
	// ------------------------------

	/**
	 * Ensure there are enough BAT tokens (topping up if needed)
	 *
	 * @param minTokens Minimum tokens needed.
	 */
	async ensure(minTokens: number): Promise<void> {
		await this.init();
		if (this.pool.length >= minTokens) return;
		const toTarget = Math.max(this.desiredPoolSize, minTokens);
		const batMax = this.getBatMaxMint();
		const batch = Math.min(toTarget - this.pool.length, batMax);
		if (batch <= 0) return;
		await this.topUp(batch);
	}

	/**
	 * Gets a Blind Authentication Token (BAT)
	 *
	 * @param {method, path} to Call (not used in our implementation)
	 * @returns The serialized BAT ready to insert into request header.
	 */
	async getBlindAuthToken({
		method,
		path,
	}: {
		method: 'GET' | 'POST';
		path: string;
	}): Promise<string> {
		if (this.info && !this.info.requiresBlindAuthToken(method, path)) {
			this.logger.warn('Endpoint is not marked as protected by NUT-22; still issuing BAT', {
				method,
				path,
			});
		}

		return this.withLock(async () => {
			await this.ensure(1);
			if (this.pool.length === 0) {
				throw new Error('AuthManager: no BATs available and minting failed');
			}
			// Pop one BAT and serialize without DLEQ for the header. Per NUT-22, wallets
			// SHOULD delete BAT even on error, so no need to track it in-flight.
			const proof = this.pool.pop()!;
			this.logger.debug('AuthManager: BAT requested', {
				method,
				path,
				remaining: this.pool.length,
			});
			return serializeBAT(proof);
		});
	}

	/**
	 * Replace or merge the current BAT pool with previously persisted BATs.
	 */
	importPool(proofs: Proof[], mode: 'replace' | 'merge' = 'replace'): void {
		if (mode === 'replace') {
			this.pool = [];
		}
		const seen = new Map(this.pool.map((p) => [p.secret, p]));
		for (const p of proofs) {
			if (!p || !p.secret || !p.C || !p.id) continue; // shape check
			if (!seen.has(p.secret)) {
				this.pool.push(p);
				seen.set(p.secret, p);
			}
		}
	}

	/**
	 * Return a deep-copied snapshot of the current BAT pool (full Proofs, including dleq).
	 */
	exportPool(): Proof[] {
		return this.pool.map((p) => ({ ...p, dleq: p.dleq ? { ...p.dleq } : undefined }));
	}

	// ------------------------------
	// Internals
	// ------------------------------

	/**
	 * Simple mutex lock - chains promises in order.
	 */
	private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = this.lockChain ?? Promise.resolve();
		let release!: () => void;
		const lock = new Promise<void>((resolve) => {
			release = resolve;
		});

		this.lockChain = prev.then(() => lock);
		try {
			await prev;
			return await fn();
		} finally {
			release();
			if (this.lockChain === lock) this.lockChain = undefined;
		}
	}

	/**
	 * Initialise mint info and auth keysets/keys as needed.
	 */
	private async init(): Promise<void> {
		if (!this.info) {
			const info = await this.req<GetInfoResponse>({
				endpoint: joinUrls(this.mintUrl, '/v1/info'),
				method: 'GET',
			});
			this.info = new MintInfo(info);
		}
		if (this.keysets.length === 0 || !this.activeKeysetId) {
			await this.refreshKeysets();
		}
	}

	/**
	 * Gets the BAT minting limit: lower of manager limit and Mint’s NUT-22 limit.
	 */
	private getBatMaxMint(): number {
		if (!this.info) throw new Error('AuthManager: mint info not loaded');
		const n22 = this.info.nuts['22'];
		const mintMax = n22?.bat_max_mint ?? this.maxPerMint;
		return Math.max(1, Math.min(this.maxPerMint, mintMax));
	}

	/**
	 * Refreshes AUTH (unit 'auth') keysets from mint, choosing cheapest active keyset.
	 */
	private async refreshKeysets(): Promise<void> {
		const allKeysets = await this.req<MintAllKeysets>({
			endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/keysets'),
			method: 'GET',
		});
		const unitKeysets = allKeysets.keysets.filter((k) => k.unit === 'auth');
		this.keysets = unitKeysets;

		// Choose cheapest active keyset (tie-breaker by id for determinism)
		const active = unitKeysets
			.filter((k) => k.active)
			.sort(
				(a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0) || a.id.localeCompare(b.id),
			)[0];

		if (!active) throw new Error('AuthManager: no active auth keyset found');
		this.activeKeysetId = active.id;

		// Fetch keys for active keyset
		const resp = await this.req<MintActiveKeys>({
			endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/keys', this.activeKeysetId),
			method: 'GET',
		});
		const mintKeys = resp.keysets[0];
		if (!mintKeys || mintKeys.id !== this.activeKeysetId) {
			throw new Error('AuthManager: key fetch mismatch for active keyset');
		}
		this.keysById.set(mintKeys.id, mintKeys);
	}

	private getActiveKeys(): MintKeys {
		if (!this.activeKeysetId) throw new Error('AuthManager: active keyset not set');
		const k = this.keysById.get(this.activeKeysetId);
		if (!k) throw new Error('AuthManager: keys not loaded for active keyset');
		return k;
	}

	/**
	 * Mint a batch of BATs using the current CAT if the endpoint is protected by NUT-21.
	 */
	private async topUp(n: number): Promise<void> {
		if (!this.info) throw new Error('AuthManager: mint info not loaded');

		// Check NUT-21 protection of the BAT mint endpoint
		const needsCAT = this.info.requiresClearAuthToken('POST', '/v1/auth/blind/mint');
		let cat: string | undefined;
		if (needsCAT) {
			cat = await this.ensureCAT(30);
			if (!cat) {
				throw new Error(
					'AuthManager: Clear-auth token required for /v1/auth/blind/mint but not available. Authenticate with the mint to obtain a CAT first.',
				);
			}
		}
		// Create blinded messages for amount n in unit 'auth' (supports only 1s)
		const keys = this.getActiveKeys();
		const outputs = OutputData.createRandomData(n, keys);
		const payload = { outputs: outputs.map((d) => d.blindedMessage) };
		// Set CAT header if needed
		const headers: Record<string, string> = {};
		if (cat) headers['Clear-auth'] = cat;
		// Do the topup
		const res = await this.req<BlindAuthMintResponse>({
			endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/mint'),
			method: 'POST',
			headers,
			requestBody: payload as unknown as Record<string, unknown>,
		});
		if (!Array.isArray(res?.signatures) || res.signatures.length !== outputs.length) {
			throw new Error('AuthManager: bad BAT mint response');
		}
		// Create BAT proofs and check DLEQ
		const proofs = outputs.map((d, i) => d.toProof(res.signatures[i], keys));
		for (const p of proofs) {
			if (!hasValidDleq(p, keys)) {
				throw new Error('AuthManager: mint returned BAT with invalid DLEQ');
			}
		}
		// Add BAT proofs to pool
		this.pool.push(...proofs);
		this.logger.debug('AuthManager: performed topUp', {
			minted: proofs.length,
			pool: this.pool.length,
		});
	}
}

// ------------------------------
// Helpers
// ------------------------------

/**
 * Serialize an Auth Proof as a BAT header value: "authA" + base64(JSON_without_dleq)
 */
function serializeBAT(proof: Proof): string {
	// strip dleq per NUT-22
	const token = { id: proof.id, secret: proof.secret, C: proof.C };
	const base64Data = encodeJsonToBase64(token);
	return `authA${base64Data}`;
}
