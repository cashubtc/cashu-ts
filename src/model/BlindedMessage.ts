import { type SerializedBlindedMessage } from './types/index';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { Amount, type AmountLike } from './Amount';

class BlindedMessage {
	private readonly amountValue: Amount;
	B_: WeierstrassPoint<bigint>;
	id: string;
	constructor(amount: AmountLike, B_: WeierstrassPoint<bigint>, id: string) {
		this.amountValue = Amount.from(amount);
		this.B_ = B_;
		this.id = id;
	}

	get amount(): Amount {
		return this.amountValue;
	}

	getSerializedBlindedMessage(): SerializedBlindedMessage {
		return { amount: this.amountValue.toBigInt(), B_: this.B_.toHex(true), id: this.id };
	}
}
export { BlindedMessage };
