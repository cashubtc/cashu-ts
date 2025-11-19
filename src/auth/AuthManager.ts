import type { AuthProvider } from './AuthProvider';
import request, { type RequestFn } from '../transport';
import { joinUrls, hasValidDleq, encodeJsonToBase64, Bytes } from '../utils';
import { MintInfo } from '../model/MintInfo';
import { OutputData } from '../model/OutputData';
import type {
	GetInfoResponse,
	MintActiveKeys,
	MintAllKeysets,
	Proof,
	SerializedBlindedSignature,
} from '../model/types';
import { type Logger, NULL_LOGGER } from '../logger';
import { type OIDCAuth, type TokenResponse } from './OIDCAuth';
import { KeyChain, type Keyset } from '../wallet';

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
 * Response from the mint after blind auth minting.
 */
export type BlindAuthMintResponse = {
	signatures: SerializedBlindedSignature[];
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
	private inflightRefresh?: Promise<void>;
	private static readonly MIN_VALID_SECS = 30;

	// Open ID Connect (OIDC)
	private oidc?: OIDCAuth;
	private tokens: StoredTokens = {};

	// Blind Auth Token (BAT) pool
	private pool: Proof[] = [];
	private desiredPoolSize = 10;
	private maxPerMint = 10;

	// Keychain for 'auth' unit
	private keychain?: KeyChain;

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
		try {
			return this.keychain?.getCheapestKeyset().id;
		} catch {
			return undefined;
		}
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
	async ensureCAT(minValidSecs?: number): Promise<string | undefined> {
		if (this.validForAtLeast(minValidSecs)) {
			return this.tokens.accessToken;
		}

		if (!this.oidc || !this.tokens.refreshToken) {
			return this.tokens.accessToken; // nothing we can do
		}

		// One refresh at a time
		if (!this.inflightRefresh) {
			this.inflightRefresh = (async () => {
				try {
					const tok = await this.oidc!.refresh(this.tokens.refreshToken!);
					this.updateFromOIDC(tok);
				} catch (err) {
					this.logger.warn('AuthManager: CAT refresh failed', { err });
				} finally {
					this.inflightRefresh = undefined;
				}
			})();
		}
		await this.inflightRefresh;
		return this.validForAtLeast(0) ? this.tokens.accessToken : undefined;
	}

	// Returns true if expiry date is >minValidSecs away
	private validForAtLeast(minValidSecs: number = AuthManager.MIN_VALID_SECS): boolean {
		const { accessToken, expiresAt } = this.tokens;
		if (!accessToken) return false;
		if (!expiresAt) return true; // Unknown expiry, allow and rely on server to reject if invalid
		return Date.now() + minValidSecs * 1000 < expiresAt;
	}

	// Updates access and refresh tokens in our store, using either the explicit expires_in key or falling back to the JWT expiry.
	private updateFromOIDC(t: TokenResponse): void {
		if (!t.access_token) return;
		const nowMs = Date.now();
		this.tokens.accessToken = t.access_token;
		if (t.refresh_token) this.tokens.refreshToken = t.refresh_token;
		if (typeof t.expires_in === 'number' && t.expires_in > 0) {
			this.tokens.expiresAt = nowMs + t.expires_in * 1000; // Prefer expires_in
		} else {
			// Fall back to JWT exp, else undefined
			const expSec = this.parseJwtExpSec(t.access_token);
			this.tokens.expiresAt = expSec ? expSec * 1000 : undefined;
		}
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
	 * Extract exp, seconds since epoch, from a JWT access token.
	 */
	private parseJwtExpSec(token?: string): number | undefined {
		if (!token) return;
		const parts = token.split('.');
		if (parts.length !== 3) return;
		try {
			const jsonStr = Bytes.toString(Bytes.fromBase64(parts[1]));
			const obj = JSON.parse(jsonStr) as { exp?: unknown };
			const exp = typeof obj.exp === 'number' ? obj.exp : Number(obj.exp);
			if (Number.isFinite(exp) && exp > 0) return exp;
		} catch {
			this.logger.warn('JWT access token was malformed.', {
				token,
			});
		}
		return;
	}

	/**
	 * Simple mutex lock - chains promises in order.
	 */
	private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = this.lockChain ?? Promise.resolve();
		let release!: () => void;
		const lock = new Promise<void>((resolve) => {
			release = resolve;
		});
		const chain = prev.then(() => lock); // capture the exact Promise we assign
		this.lockChain = chain;
		try {
			await prev;
			return await fn();
		} finally {
			release();
			// Only clear if no newer chain has been installed
			if (this.lockChain === chain) this.lockChain = undefined;
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
		if (!this.keychain) {
			// fetch blind keysets and keys for unit 'auth'
			const [allKeysets, allKeys] = await Promise.all([
				this.req<MintAllKeysets>({
					endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/keysets'),
					method: 'GET',
				}),
				this.req<MintActiveKeys>({
					endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/keys'),
					method: 'GET',
				}),
			]);
			// build a KeyChain preloaded with caches, unit 'auth'
			// Then smoke test to surface errors early - no need to init() with cached keys
			this.keychain = new KeyChain(this.mintUrl, 'auth', allKeysets.keysets, allKeys.keysets);
			this.keychain.getCheapestKeyset();
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

	private getActiveKeys(): Keyset {
		if (!this.keychain) throw new Error('AuthManager: keyset not loaded for active keyset');
		return this.keychain.getCheapestKeyset();
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
			cat = await this.ensureCAT();
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
