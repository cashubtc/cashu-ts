import { Wallet, createP2PKsecret } from '@cashu/cashu-ts';

test('Cashu library inits in RN', () => {
	const wallet = new Wallet('http://localhost:3338');
	expect(wallet).toBeDefined();
});

test('Cashu module works in RN', () => {
	const secret = createP2PKsecret('foo');
	expect(secret).toBeDefined();
	const s = JSON.parse(secret);
	expect(s[1].data).toEqual('foo');
});
