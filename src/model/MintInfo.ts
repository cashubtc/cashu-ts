import { GetInfoResponse, MPPMethod, SwapMethod, WebSocketSupport } from './types';

export class MintInfo {
	private readonly _mintInfo: GetInfoResponse;

	constructor(info: GetInfoResponse) {
		this._mintInfo = info;
	}

	isSupported(num: 4 | 5): { disabled: boolean; params: Array<SwapMethod> };
	isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14): { supported: boolean };
	isSupported(num: 17): { supported: boolean; params?: Array<WebSocketSupport> };
	isSupported(num: 15): { supported: boolean; params?: Array<MPPMethod> };
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
			case 14: {
				return this.checkGenericNut(num);
			}
			case 17: {
				return this.checkNut17();
			}
			case 15: {
				return this.checkNut15();
			}
			default: {
				throw new Error('nut is not supported by cashu-ts');
			}
		}
	}
	private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14) {
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
	get amountless() {
		return this._mintInfo.amountless;
	}
}
