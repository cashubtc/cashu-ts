import {
	type GetInfoResponse,
	type MPPMethod,
	type SwapMethod,
	type WebSocketSupport,
} from './types';

export class MintInfo {
	private readonly _mintInfo: GetInfoResponse;
	private readonly _clearAuthProtectedEndpoints?: {
		cache: {
			[url: string]: boolean;
		};
		apiReturn: Array<{ method: 'GET' | 'POST'; regex: RegExp; cachedValue?: boolean }>;
	};
	private readonly _blindAuthProtectedEndpoints?: {
		cache: {
			[url: string]: boolean;
		};
		apiReturn: Array<{ method: 'GET' | 'POST'; regex: RegExp; cachedValue?: boolean }>;
	};

	constructor(info: GetInfoResponse) {
		this._mintInfo = info;

		if (info.nuts[21]?.protected_endpoints) {
			this._clearAuthProtectedEndpoints = {
				cache: {},
				apiReturn: info.nuts[21].protected_endpoints.map((o) => ({
					method: o.method,
					regex: new RegExp(o.path),
				})),
			};
		}

		if (info.nuts[22]?.protected_endpoints) {
			this._blindAuthProtectedEndpoints = {
				cache: {},
				apiReturn: info.nuts[22].protected_endpoints.map((o) => ({
					method: o.method,
					regex: new RegExp(o.path),
				})),
			};
		}
	}

	isSupported(num: 4 | 5): { disabled: boolean; params: SwapMethod[] };
	isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20): { supported: boolean };
	isSupported(num: 17): { supported: boolean; params?: WebSocketSupport[] };
	isSupported(num: 15): { supported: boolean; params?: MPPMethod[] };
	isSupported(
		num: 21,
	): { supported: false } | { supported: true; openid_discovery: string; client_id: string };
	isSupported(num: 22): { supported: false } | { supported: true; bat_max_mint: number };
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
			case 21: {
				return this.checkNut21();
			}
			case 22: {
				return this.checkNut22();
			}
			default: {
				throw new Error('nut is not supported by cashu-ts');
			}
		}
	}

	requiresClearAuthToken(path: string) {
		if (!this._clearAuthProtectedEndpoints) {
			return false;
		}
		if (typeof this._clearAuthProtectedEndpoints.cache[path] === 'boolean') {
			return this._clearAuthProtectedEndpoints.cache[path];
		}
		const isProtectedEndpoint = this._clearAuthProtectedEndpoints.apiReturn.some((e) =>
			e.regex.test(path),
		);
		this._clearAuthProtectedEndpoints.cache[path] = isProtectedEndpoint;
		return isProtectedEndpoint;
	}

	requiresBlindAuthToken(path: string) {
		if (!this._blindAuthProtectedEndpoints) {
			return false;
		}
		if (typeof this._blindAuthProtectedEndpoints.cache[path] === 'boolean') {
			return this._blindAuthProtectedEndpoints.cache[path];
		}
		const isProtectedEndpoint = this._blindAuthProtectedEndpoints.apiReturn.some((e) =>
			e.regex.test(path),
		);
		this._blindAuthProtectedEndpoints.cache[path] = isProtectedEndpoint;
		return isProtectedEndpoint;
	}

	private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20) {
		if (this._mintInfo.nuts[num]?.supported) {
			return { supported: true };
		}
		return { supported: false };
	}
	private checkMintMelt(num: 4 | 5) {
		const mintMeltInfo = this._mintInfo.nuts[num];
		if (mintMeltInfo && mintMeltInfo.methods.length > 0 && !mintMeltInfo.disabled) {
			return { disabled: false, params: mintMeltInfo.methods };
		}
		return { disabled: true, params: mintMeltInfo.methods };
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
	private checkNut21() {
		if (this._mintInfo.nuts[21]) {
			return {
				supported: true,
				openid_discovery: this._mintInfo.nuts[21].openid_discovery,
				client_id: this._mintInfo.nuts[21].client_id,
			};
		}
		return { supported: false };
	}
	private checkNut22() {
		if (this._mintInfo.nuts[22]) {
			return {
				supported: true,
				bat_max_mint: this._mintInfo.nuts[22].bat_max_mint,
			};
		}
		return { supported: false };
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
}
