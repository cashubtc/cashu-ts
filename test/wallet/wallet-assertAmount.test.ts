import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import {
	ConsoleLogger,
	Mint,
	MintKeys,
	MintKeyset,
	Wallet,
} from '../../src';

const mintUrl = 'http://localhost:3338';
const unit = 'sat';

const mintInfoResp = JSON.parse(
	'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","options":{"description":true}},{"method":"bolt11","unit":"usd","options":{"description":true}},{"method":"bolt11","unit":"eur","options":{"description":true}},{"method":"bolt12","unit":"sat","options":{"description":true}},{"method":"bolt12","unit":"usd","options":{"description":true}},{"method":"bolt12","unit":"eur","options":{"description":true}}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"},{"method":"bolt12","unit":"sat"},{"method":"bolt12","unit":"usd"},{"method":"bolt12","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt12","unit":"sat","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]},{"method":"bolt12","unit":"usd","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]},{"method":"bolt12","unit":"eur","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]}]}}}',
);

const mintCache = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		},
	] as MintKeyset[],
	keys: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				'1': '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				'2': '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		},
	] as MintKeys[],
	unit: unit,
	mintInfo: mintInfoResp,
};

const wallet = new Wallet(mintUrl, mintCache) as any;
const expMsg = 'Amount must be a non-negative integer';

describe('assertInteger', () => {
	test('allows valid integers', () => {
		expect(() => wallet.assertAmount(2561)).not.toThrow();
		expect(() => wallet.assertAmount(0)).not.toThrow();
	});

	test('rejects non integer numbers', () => {
		expect(() => wallet.assertAmount(512.0019)).toThrow(expMsg);
		expect(() => wallet.assertAmount(NaN)).toThrow(expMsg);
		expect(() => wallet.assertAmount(Infinity)).toThrow(expMsg);
		expect(() => wallet.assertAmount(-Infinity)).toThrow(expMsg);
	});

	test('rejects non number types', () => {
		expect(() => wallet.assertAmount('2561' as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount('0' as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(true as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(false as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount({} as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(null as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(undefined as unknown)).toThrow(expMsg);
	});
});

