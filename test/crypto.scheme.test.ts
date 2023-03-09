import { utils, Point } from '@noble/secp256k1';
import { hashToCurve } from '../src/DHKE.js';
import { bytesToNumber } from '../src/utils.js';

describe('test crypto bdhke', () => {
	test('bdhke', async () => {
		//Mint(Alice)
		const mint: Mint = new Mint();

		//Wallet(Bob)
		const wallet: Wallet = new Wallet();
		const B_ = await wallet.createBlindedMessage('secret');

		//Mint
		const C_ = mint.createBlindSignature(B_);

		//Wallet
		const { C, secret } = wallet.unblindSignature(C_, mint.publicKey);

		//Mint
		const aY = await mint.calculateCVerify(secret);
		expect(aY).toStrictEqual(C);
	});
});

class Mint {
	private privateKey: Uint8Array;
	publicKey: Point;
	constructor() {
		this.privateKey = utils.randomPrivateKey();
		this.publicKey = Point.BASE.multiply(bytesToNumber(this.privateKey));
	}

	createBlindSignature(B_: Point): Point {
		const C_: Point = B_.multiply(bytesToNumber(this.privateKey));
		return C_;
	}

	async calculateCVerify(secret: Uint8Array): Promise<Point> {
		const Y: Point = await hashToCurve(secret);
		const aY: Point = Y.multiply(bytesToNumber(this.privateKey));
		return aY;
	}
}

class Wallet {
	private Y: Point | undefined;
	private r = BigInt(0);
	private rG: Point | undefined;
	private B_: Point | undefined;
	private secret = new Uint8Array();
	constructor() {}

	async createBlindedMessage(message: string): Promise<Point> {
		const enc = new TextEncoder();
		this.secret = enc.encode(message);
		this.Y = await hashToCurve(this.secret);
		this.r = bytesToNumber(utils.randomPrivateKey());
		this.rG = Point.BASE.multiply(this.r);
		this.B_ = this.Y.add(this.rG);
		return this.B_;
	}

	unblindSignature(C_: Point, mintPubK: Point): { C: Point; secret: Uint8Array } {
		const C = C_.subtract(mintPubK.multiply(this.r));
		return { C, secret: this.secret };
	}
}
