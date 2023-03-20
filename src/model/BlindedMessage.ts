import { Point } from '@noble/secp256k1';
import { SerializedBlindedMessage } from './types/index.js';

class BlindedMessage {
	amount?: number;
	B_: Point;
	constructor(amount: number | undefined, B_: Point) {
		this.amount = amount;
		this.B_ = B_;
	}
	getSerializedBlindedMessage(): SerializedBlindedMessage {
		const result: SerializedBlindedMessage = { B_: this.B_.toHex(true) };
		if (typeof this.amount === 'number') {
			result.amount = this.amount;
		}
		return result;
	}
}
export { BlindedMessage };
