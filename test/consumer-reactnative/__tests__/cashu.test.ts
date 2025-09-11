import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
import { createP2PKsecret } from '@cashu/cashu-ts/crypto/NUT11';

test('Cashu library inits in RN', () => {
	const mint = new CashuMint('http://localhost:3338');
	const wallet = new CashuWallet(mint);
	expect(wallet).toBeDefined();
});

test('Cashu module works in RN', () => {
	const secret = createP2PKsecret('foo');
	expect(secret).toBeDefined();
	const s = JSON.parse(secret);
	expect(s[1].data).toEqual('foo');
});
