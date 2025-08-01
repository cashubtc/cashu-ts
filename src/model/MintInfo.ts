import {
	type GetInfoResponse,
	type MPPMethod,
	type SwapMethod,
	type WebSocketSupport,
} from './types';

type Method = 'GET' | 'POST';
type Endpoint = { method: Method; path: string };

type ProtectedIndex = {
	cache: Record<string, boolean>; // "METHOD /v1/foo"
	exact: Array<{ method: Method; path: string }>;
	prefix: Array<{ method: Method; path: string }>;
};

export class MintInfo {
	// Full mint info response
	private readonly _mintInfo: GetInfoResponse;
	// NUT-22, Blind-auth protected endpoints
	private readonly _protected22?: ProtectedIndex;
	// NUT-21, Clear-auth protected endpoints
	private readonly _protected21?: ProtectedIndex;

	constructor(info: GetInfoResponse) {
		this._mintInfo = info;

		const pe22 = this.toEndpoints(info?.nuts?.[22]?.protected_endpoints);
		this._protected22 = this.buildIndex(pe22);

		const pe21 = this.toEndpoints(info?.nuts?.[21]?.protected_endpoints);
		this._protected21 = this.buildIndex(pe21);
	}

	isSupported(num: 4 | 5): { disabled: boolean; params: SwapMethod[] };
	isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20): { supported: boolean };
	isSupported(num: 17): { supported: boolean; params?: WebSocketSupport[] };
	isSupported(num: 15): { supported: boolean; params?: MPPMethod[] };
	isSupported(num: 19): { supported: boolean; params?: Nut19Policy };
	isSupported(num: number) {
		switch (num) {
			case 4:
			case 5: {
				return this.checkMintMelt(num);
			}
			case 7:
			case 8:
			case 9:
			case 10:
			case 11:
			case 12:
			case 14:
			case 20: {
				return this.checkGenericNut(num);
			}
			case 17: {
				return this.checkNut17();
			}
			case 15: {
				return this.checkNut15();
			}
			case 19: {
				return this.checkNut19();
			}
			default: {
				throw new Error('nut is not supported by cashu-ts');
			}
		}
	}

	requiresBlindAuthToken(method: 'GET' | 'POST', path: string): boolean {
		return this.matchesProtected(this._protected22, method, path);
	}

	requiresClearAuthToken(method: 'GET' | 'POST', path: string): boolean {
		return this.matchesProtected(this._protected21, method, path);
	}

	private matchesProtected(idx: ProtectedIndex | undefined, method: Method, path: string): boolean {
		if (!idx) return false;

		const cacheKey = `${method} ${path}`;
		const cached = idx.cache[cacheKey];
		if (typeof cached === 'boolean') return cached;

		const exactHit = idx.exact.some((e) => e.method === method && e.path === path);
		const prefixHit = exactHit
			? false
			: idx.prefix.some((e) => e.method === method && path.startsWith(e.path));

		const res = exactHit || prefixHit;
		idx.cache[cacheKey] = res;
		return res;
	}

	private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20) {
		return this._mintInfo.nuts[num]?.supported ? { supported: true } : { supported: false };
	}

	private checkMintMelt(num: 4 | 5) {
		const mintMeltInfo = this._mintInfo.nuts[num];
		if (mintMeltInfo && mintMeltInfo.methods.length > 0 && !mintMeltInfo.disabled) {
			return { disabled: false, params: mintMeltInfo.methods };
		}
		return { disabled: true, params: mintMeltInfo?.methods ?? [] };
	}

	private checkNut17() {
		if (this._mintInfo.nuts[17] && this._mintInfo.nuts[17].supported.length > 0) {
			return { supported: true, params: this._mintInfo.nuts[17].supported };
		}
		return { supported: false };
	}

	private checkNut15() {
		if (this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0) {
			return { supported: true, params: this._mintInfo.nuts[15].methods };
		}
		return { supported: false };
	}

	private checkNut19() {
		const rawPolicy = this._mintInfo.nuts[19];
		if (rawPolicy && rawPolicy.cached_endpoints.length > 0) {
			return {
				supported: true,
				params: {
					// map null to infinity, if not null map seconds to milliseconds
					ttl: typeof rawPolicy.ttl === 'number' && !isNaN(rawPolicy.ttl) ? Math.max(rawPolicy.ttl, 0) * 1000 : Infinity,
					cached_endpoints: rawPolicy.cached_endpoints
				} as Nut19Policy
			};
		}
		return { supported: false };
	}

	// ---------- private helpers ----------

	private toEndpoints(maybe: unknown): Endpoint[] {
		if (!Array.isArray(maybe)) return [];
		const out: Endpoint[] = [];
		for (const e of maybe) {
			if (e && typeof e === 'object') {
				const rec = e as Record<string, unknown>;
				const mm = rec.method;
				const pp = rec.path;
				if (typeof mm === 'string' && typeof pp === 'string') {
					const method = mm.toUpperCase();
					if (method === 'GET' || method === 'POST') {
						out.push({ method, path: pp });
					}
				}
			}
		}
		return out;
	}

	private buildIndex(endpoints?: Endpoint[]): ProtectedIndex | undefined {
		if (!endpoints || endpoints.length === 0) return undefined;

		const exact: ProtectedIndex['exact'] = [];
		const prefix: ProtectedIndex['prefix'] = [];

		for (const e of endpoints) {
			let p = e.path;
			if (p.startsWith('^')) p = p.slice(1);
			if (p.endsWith('$')) p = p.slice(0, -1);
			if (p.endsWith('.*')) {
				prefix.push({ method: e.method, path: p.slice(0, -2) });
			} else {
				exact.push({ method: e.method, path: p });
			}
		}

		const cache: Record<string, boolean> = {};
		return { cache, exact, prefix };
	}

	// ---------- getters ----------

	get cache(): GetInfoResponse {
		return this._mintInfo;
	}
	get contact() {
		return this._mintInfo.contact;
	}
	get description() {
		return this._mintInfo.description;
	}
	get description_long() {
		return this._mintInfo.description_long;
	}
	get name() {
		return this._mintInfo.name;
	}
	get pubkey() {
		return this._mintInfo.pubkey;
	}
	get nuts() {
		return this._mintInfo.nuts;
	}
	get version() {
		return this._mintInfo.version;
	}
	get motd() {
		return this._mintInfo.motd;
	}

	/**
	 * @deprecated Use supportsNut04Description(method, unit)
	 */
	get supportsBolt12Description(): boolean {
		return this.supportsNut04Description('bolt12');
	}

	/**
	 * Checks if the mint supports creating invoices/offers with a description for the specified
	 * payment method.
	 *
	 * @param method - The payment method to check ('bolt11' or 'bolt12')
	 * @returns True if the mint supports description for the method, false otherwise.
	 */
	supportsNut04Description(method: 'bolt11' | 'bolt12', unit?: string): boolean {
		return this._mintInfo.nuts[4]?.methods.some(
			(met) =>
				met.method === method &&
				(unit ? met.unit === unit : true) &&
				(met.options?.description === true || met.description === true),
		);
	}

	supportsAmountless(method: string = 'bolt11', unit: string = 'sat'): boolean {
		const meltMethods = this._mintInfo?.nuts?.[5]?.methods ?? [];

		if (!Array.isArray(meltMethods)) return false;

		return meltMethods.some(
			(met) => met.method === method && met.unit === unit && met.options?.amountless === true,
		);
	}
}
