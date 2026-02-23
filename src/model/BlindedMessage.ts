import { type SerializedBlindedMessage } from './types/index';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { Amount, type AmountLike } from './Amount';

// TODO: v4
// Type BlindedMessage.amount as Amount (breaking).
// If NUT spec evolves, switch getSerializedBlindedMessage encoding to string

class BlindedMessage {
	private readonly amountValue: Amount;
	B_: WeierstrassPoint<bigint>;
	id: string;
	constructor(amount: AmountLike, B_: WeierstrassPoint<bigint>, id: string) {
		this.amountValue = Amount.from(amount);
		this.B_ = B_;
		this.id = id;
	}

	get amount(): number {
		return this.amountValue.toNumber();
	}

	getSerializedBlindedMessage(): SerializedBlindedMessage {
		return { amount: this.amountValue.toNumber(), B_: this.B_.toHex(true), id: this.id };
	}
}
export { BlindedMessage };
