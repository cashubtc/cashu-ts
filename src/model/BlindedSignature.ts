import { ProjPointType } from '@noble/curves/abstract/weierstrass';
import { SerializedBlindedSignature } from './types/index.js';
import { DLEQ } from '@cashu/crypto/modules/common';
import { bytesToHex } from '@noble/hashes/utils.js';

class BlindedSignature {
	id: string;
	amount: number;
	C_: ProjPointType<bigint>;
	dleq?: DLEQ;

	constructor(id: string, amount: number, C_: ProjPointType<bigint>, dleq: DLEQ) {
		this.id = id;
		this.amount = amount;
		this.C_ = C_;
		this.dleq = dleq;
	}

	getSerializedBlindedSignature(): SerializedBlindedSignature {
		return {
			id: this.id,
			amount: this.amount,
			C_: this.C_.toHex(true),
			dleq:
				this.dleq == undefined
					? undefined
					: {
							s: bytesToHex(this.dleq.s),
							e: bytesToHex(this.dleq.e),
							r: this.dleq.r?.toString(16)
					  }
		};
	}
}

export { BlindedSignature };
