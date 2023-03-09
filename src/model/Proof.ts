import { encodeJsonToBase64 } from '../base64.js';

class Proof {
	id: string;
	amount: number;
	secret: string;
	C: string;
	constructor(id: string, amount: number, secret: string, C: string) {
		this.id = id;
		this.amount = amount;
		this.secret = secret;
		this.C = C;
	}
	encodeProofToBase64(): string {
		return encodeJsonToBase64([
			{ id: this.id, amount: this.amount, secret: this.secret, string: this.C }
		]);
	}
}

export { Proof };
