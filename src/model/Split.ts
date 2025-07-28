import { type BlindedMessage } from './BlindedMessage.js';
import { type Proof } from './types/index.js';

class Split {
	proofs: Proof[];
	amount: number;
	outputs: BlindedMessage[];
	constructor(proofs: Proof[], amount: number, outputs: BlindedMessage[]) {
		this.proofs = proofs;
		this.amount = amount;
		this.outputs = outputs;
	}
	getSerializedSplit() {
		return {
			proofs: this.proofs,
			amount: this.amount,
			outputs: this.outputs.map((blindedMessage: BlindedMessage) => {
				return { amount: blindedMessage.amount, B_: blindedMessage.B_.toHex(true) };
			}),
		};
	}
}

export { Split };
