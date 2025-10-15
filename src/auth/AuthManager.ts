import type { AuthProvider, HttpMethod } from './AuthProvider';
import request, { type RequestFn } from '../transport';
import { joinUrls, hasValidDleq, encodeJsonToBase64 } from '../utils';
import { MintInfo } from '../model/MintInfo';
import { OutputData } from '../model/OutputData';
import type { MintActiveKeys, MintAllKeysets, MintKeys, MintKeyset, Proof } from '../model/types';
import { type GetInfoResponse, type BlindAuthMintResponse } from '../mint/types';
import type { BlindAuthMintPayload } from '../wallet/types';
import { type Logger, NULL_LOGGER } from '../logger';

export type AuthManagerOptions = {
	/**
	 * Hard limit to target when minting BATs in one request. If omitted, we'll read
	 * `nuts['22'].bat_max_mint` from /v1/info.
	 */
	maxPerMint?: number;
	/**
	 * Desired pool size to maintain. We’ll top-up to min(desiredPoolSize, bat_max_mint) on demand.
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

/**
 * A minimal AuthManager that:
 *
 * - Stores CAT (Clear-auth token) set by the host.
 * - Mints BATs (Auth Proofs) using the mint's NUT-22 endpoints.
 * - Validates DLEQs.
 * - Returns serialized BATs for 'Blind-auth' requests.
 */
export class AuthManager implements AuthProvider {
	private readonly mintUrl: string;
	private readonly req: RequestFn;
	private readonly logger: Logger;
	private info?: MintInfo;
	private lockChain?: Promise<void>;

	// Clear Auth Token (CAT), set by host app
	private cat?: string;

	// Blind Auth Token (BAT) pool
	private pool: Proof[] = [];
	private desiredPoolSize: number = 10;
	private maxPerMint: number = 10;

	// Key cache for 'auth' unit
	private keysets: MintKeyset[] = [];
	private keysById: Map<string, MintKeys> = new Map();
	private activeKeysetId?: string;

	constructor(mintUrl: string, opts?: AuthManagerOptions) {
		this.mintUrl = mintUrl;
		this.req = opts?.request ?? request;
		this.logger = opts?.logger ?? NULL_LOGGER;
		this.desiredPoolSize = Math.max(1, opts?.desiredPoolSize ?? this.desiredPoolSize);
		this.maxPerMint = Math.max(1, opts?.maxPerMint || this.maxPerMint);
	}

	// ------------------------------
	// Public API
	// ------------------------------

	get poolSize() {
		return this.pool.length;
	}
	get poolTarget() {
		return this.desiredPoolSize;
	}
	get activeAuthKeysetId() {
		return this.activeKeysetId;
	}
	get hasCAT() {
		return !!this.cat;
	}

	setCAT(cat: string | undefined) {
		this.cat = cat;
	}

	getCAT(): string | undefined {
		return this.cat;
	}

	/**
	 * Replace or merge the current pool with previously persisted BATs.
	 *
	 * @param proofs BAT proofs to import.
	 * @param mode Replace or Merge (default: replace)
	 */
	importPool(proofs: Proof[], mode: 'replace' | 'merge' = 'replace'): void {
		if (mode === 'replace') {
			this.pool = [];
		}
		const seen = new Map(this.pool.map((p) => [p.secret, p]));
		for (const p of proofs) {
			if (!p || !p.secret || !p.C || !p.id) continue; // shape check
			const existing = seen.get(p.secret);
			if (!existing) {
				this.pool.push(p);
				seen.set(p.secret, p);
			}
		}
	}

	/**
	 * Return a deep-copied snapshot of the current BAT pool (full Proofs, including dleq).
	 */
	exportPool(): Proof[] {
		// defensive copy to avoid external mutation
		return this.pool.map((p) => ({ ...p, dleq: p.dleq ? { ...p.dleq } : undefined }));
	}

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
	async getBlindAuthToken({ method, path }: { method: HttpMethod; path: string }): Promise<string> {
		this.logger.debug('AuthManager: BAT requested', { method, path });
		return this.withLock(async () => {
			await this.ensure(1);
			if (this.pool.length === 0) {
				throw new Error('AuthManager: no BATs available and minting failed');
			}
			// Pop one BAT and serialize without DLEQ for the header. Per NUT-22, wallets
			// SHOULD delete BAT even on error, so no need to track it in-flight.
			const proof = this.pool.pop()!;
			return serializeBAT(proof);
		});
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
		const lock = new Promise<void>((resolve) => (release = resolve));

		// chain our lock so next callers queue behind us
		this.lockChain = prev.then(() => lock);
		try {
			await prev; // wait for the previous lock to release
			return await fn(); // run our action
		} finally {
			release(); // release our lock
			// tidy up if we're the last lock
			if (this.lockChain === lock) this.lockChain = undefined;
		}
	}

	/**
	 * Gets mint info and keysets.
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
		if (!this.cat) {
			throw new Error('AuthManager: Clear-auth token (CAT) not set');
		}
	}

	/**
	 * Gets the BAT minting limit.
	 *
	 * @returns The lower of AuthManager limit and Mint limit.
	 */
	private getBatMaxMint(): number {
		if (!this.info) throw new Error('AuthManager: mint info not loaded');
		const max = this.maxPerMint;
		const n22 = this.info.nuts['22'];
		return n22 && n22.bat_max_mint < max ? n22.bat_max_mint : max;
	}

	/**
	 * Refreshes AUTH keysets from mint, choosing cheapest.
	 *
	 * @returns {Promise<void> | undefined} Description.
	 */
	private async refreshKeysets(): Promise<void> {
		const allKeysets = await this.req<MintAllKeysets>({
			endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/keysets'),
			method: 'GET',
		});
		const unitKeysets = allKeysets.keysets.filter((k) => k.unit === 'auth');
		this.keysets = unitKeysets;

		// Choose cheapest active keyset (with tiebreaker on id for determinism)
		const active = unitKeysets
			.filter((k) => k.active)
			.sort(
				(a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0) || a.id.localeCompare(b.id),
			)[0];

		if (!active) throw new Error('AuthManager: no active auth keyset found');
		this.activeKeysetId = active.id;

		// Get keys for this keyset
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

	private async topUp(n: number): Promise<void> {
		if (!this.cat) throw new Error('AuthManager: cannot mint BATs without CAT');

		const keys = this.getActiveKeys();

		// Create blinded messages for amount n in unit 'auth' (which only supports 1s)
		const outputs = OutputData.createRandomData(n, keys);
		const payload: BlindAuthMintPayload = {
			outputs: outputs.map((d) => d.blindedMessage),
		};

		const res = await this.req<BlindAuthMintResponse>({
			endpoint: joinUrls(this.mintUrl, '/v1/auth/blind/mint'),
			method: 'POST',
			headers: { 'Clear-auth': this.cat },
			requestBody: payload as unknown as Record<string, unknown>,
		});

		if (!Array.isArray(res?.signatures) || res.signatures.length !== outputs.length) {
			throw new Error('AuthManager: bad BAT mint response');
		}

		const proofs = outputs.map((d, i) => d.toProof(res.signatures[i], keys));

		// Validate dleq on receipt (NUT-22)
		for (const p of proofs) {
			if (!hasValidDleq(p, keys)) {
				throw new Error('AuthManager: mint returned BAT with invalid DLEQ');
			}
		}

		// Push into pool
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
