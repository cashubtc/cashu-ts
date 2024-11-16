import { GetInfoResponse, MPPMethod, WebSocketSupport } from './types';

type GetInfoResponse2 = {
	name: string;
	pubkey: string;
	version: string;
	description?: string;
	description_long?: string;
	contact: Array<MintContactInfo>;
	nuts: {
		'4': {
			// Minting
			methods: Array<SwapMethod>;
			disabled: boolean;
		};
		'5': {
			// Melting
			methods: Array<SwapMethod>;
			disabled: boolean;
		};
		'7'?: {
			// Token state check
			supported: boolean;
		};
		'8'?: {
			// Overpaid melt fees
			supported: boolean;
		};
		'9'?: {
			// Restore
			supported: boolean;
		};
		'10'?: {
			// Spending conditions
			supported: boolean;
		};
		'11'?: {
			// P2PK
			supported: boolean;
		};
		'12'?: {
			// DLEQ
			supported: boolean;
		};
		'14'?: {
			// HTLCs
			supported: boolean;
		};
		'15'?: {
			// MPP
			methods: Array<MPPMethod>;
		};
		'17'?: {
			// WebSockets
			supported: Array<WebSocketSupport>;
		};
	};
	motd?: string;
};

export class MintInfo {
	private readonly mintInfo: GetInfoResponse;

	constructor(info: GetInfoResponse) {
		this.mintInfo = info;
	}

	isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14): { supported: boolean };
	isSupported(num: 17): { supported: boolean; params?: Array<WebSocketSupport> };
	isSupported(num: 15): { supported: boolean; params?: Array<MPPMethod> };
	isSupported(num: number) {
		switch (num) {
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
		}
	}
	private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14) {
		if (this.mintInfo.nuts[num]?.supported) {
			return { supported: true };
		}
		return { supported: false };
	}
	private checkNut17() {
		if (this.mintInfo.nuts['17'] && this.mintInfo.nuts[17].supported.length > 0) {
			return { supported: true, params: this.mintInfo.nuts[17].supported };
		}
		return { supported: false };
	}
	private checkNut15() {
		if (this.mintInfo.nuts['15'] && this.mintInfo.nuts[15].methods.length > 0) {
			return { supported: true, params: this.mintInfo.nuts[15].methods };
		}
		return { supported: false };
	}
}
