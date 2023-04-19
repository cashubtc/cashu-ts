import { encodeJsonToBase64 } from '../base64.js';
import { SerializedProof } from './types/index.js';

class Proof {
	id: string;
	amount: number;
	secret: string;
	C: string;
	public static newProof({ id, amount, secret, C }: SerializedProof): Proof {
		return new Proof(id, amount, secret, C);
	}
	constructor(id: string, amount: number, secret: string, C: string) {
		this.id = id;
		this.amount = amount;
		this.secret = secret;
		this.C = C;
	}
	encodeProofToBase64(): string {
		return encodeJsonToBase64([this.toJSON()]);
	}
	toJSON(): SerializedProof {
		return { id: this.id, amount: this.amount, secret: this.secret, C: this.C };
	}
}

export { Proof };
