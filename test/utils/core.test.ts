import {
	blindMessage,
	constructProofFromPromise,
	serializeProof,
	createDLEQProof,
	pointFromBytes,
	createBlindSignature,
	getPubKeyFromPrivKey,
} from '../../src/crypto';
import { test, describe, expect } from 'vitest';
import { MintKeys, type Keys, type Proof, type Token } from '../../src';
import * as utils from '../../src/utils';
import { PUBKEYS } from '../consts';
import {
	hasValidDleq,
	hexToNumber,
	invoiceHasAmountInHRP,
	numberToHexPadded64,
} from '../../src/utils';
import { bytesToHex, hexToBytes } from '@noble/curves/utils';

const keys: Keys = {};
for (let i = 1; i <= 2048; i *= 2) {
	keys[i] = 'deadbeef';
}

const keys_base10: Keys = {};
for (let i = 1; i <= 10000; i *= 10) {
	keys_base10[i] = 'deadbeef';
}

const keys_base16: Keys = {};
for (let i = 1; i <= 0x10000; i *= 16) {
	keys_base16[i] = 'deadbeef';
}

describe('test split amounts ', () => {
	test('testing amount 2561', async () => {
		const chunks = utils.splitAmount(2561, keys);
		expect(chunks).toStrictEqual([2048, 512, 1]);
	});
	test('testing amount 0', async () => {
		const chunks = utils.splitAmount(0, keys);
		expect(chunks).toStrictEqual([]);
	});
});

describe('test split custom amounts ', () => {
	const fiveToOne = [1, 1, 1, 1, 1];
	test('testing amount 5', async () => {
		const chunks = utils.splitAmount(5, keys, fiveToOne);
		expect(chunks).toStrictEqual([1, 1, 1, 1, 1]);
	});
	const tenToOneAndTwo = [1, 1, 2, 2, 2, 2];
	test('testing amount 10', async () => {
		const chunks = utils.splitAmount(10, keys, tenToOneAndTwo);
		expect(chunks).toStrictEqual([1, 1, 2, 2, 2, 2]);
	});
	test('testing amount 12', async () => {
		const chunks = utils.splitAmount(12, keys, tenToOneAndTwo);
		expect(chunks).toStrictEqual([1, 1, 2, 2, 2, 2, 2]);
	});
	const fiveTwelve = [512];
	test('testing amount 518', async () => {
		const chunks = utils.splitAmount(518, keys, fiveTwelve, 'desc');
		expect(chunks).toStrictEqual([512, 4, 2]);
	});
	const tooMuch = [512, 512];
	test('testing amount 512 but split too much', async () => {
		expect(() => utils.splitAmount(512, keys, tooMuch)).toThrowError();
	});
	const illegal = [3, 3];
	test('testing non pow2', async () => {
		expect(() => utils.splitAmount(6, keys, illegal)).toThrowError();
	});
	const empty: Array<number> = [];
	test('testing empty', async () => {
		const chunks = utils.splitAmount(5, keys, empty, 'desc');
		expect(chunks).toStrictEqual([4, 1]);
	});
	const undef = undefined;
	test('testing undefined', async () => {
		const chunks = utils.splitAmount(5, keys, undef);
		expect(chunks).toStrictEqual([4, 1]);
	});
});

describe('test split different key amount', () => {
	test('testing amount 68251', async () => {
		const chunks = utils.splitAmount(68251, keys_base10, undefined, 'desc');
		expect(chunks).toStrictEqual([
			10000, 10000, 10000, 10000, 10000, 10000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 100,
			100, 10, 10, 10, 10, 10, 1,
		]);
	});
	test('testing amount 1917', async () => {
		const chunks = utils.splitAmount(1917, keys_base16);
		expect(chunks).toStrictEqual([
			256, 256, 256, 256, 256, 256, 256, 16, 16, 16, 16, 16, 16, 16, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
			1, 1, 1,
		]);
	});
});

describe('test splitAmount zero handling', () => {
	test('value=0 and split of zeros passes through unchanged', () => {
		const chunks = utils.splitAmount(0, keys, [0, 0, 0]);
		expect(chunks).toStrictEqual([0, 0, 0]);
	});

	test('value=0 with nonzero split throws', () => {
		expect(() => utils.splitAmount(0, keys, [2])).toThrowError(
			/Split is greater than total amount/,
		);
	});

	test('positive value ignores zeros in split', () => {
		const chunks = utils.splitAmount(5, keys, [0, 1, 4, 0]);
		// zeros are ignored, result is same as [1,4]
		expect(chunks).toStrictEqual([1, 4]);
	});

	test('all zeros with positive value falls back to normal fill', () => {
		const chunks = utils.splitAmount(5, keys, [0, 0]);
		// should behave same as no custom split: [4,1]
		expect(chunks).toStrictEqual([4, 1]);
	});
});

test('exact custom split preserves order', () => {
	const chunks = utils.splitAmount(32, keys, [8, 4, 8, 2, 8, 2]);
	expect(chunks).toStrictEqual([8, 4, 8, 2, 8, 2]);
});

describe('test token v3 encoding', () => {
	test('encode a v3 token with getEncodedToken', () => {
		const tokenObj = {
			token: [
				{
					mint: 'https://8333.space:3338',
					proofs: [
						{
							amount: 2,
							id: '009a1f293253e41e',
							secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
							C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
						},
						{
							amount: 8,
							id: '009a1f293253e41e',
							secret: 'fe15109314e61d7756b0f8ee0f23a624acaa3f4e042f61433c728c7057b931be',
							C: '029e8e5050b890a7d6c0968db16bc1d5d5fa040ea1de284f6ec69d61299f671059',
						},
					],
				},
			],
			unit: 'sat',
			memo: 'Thank you.',
		};
		const encoded = utils.getEncodedToken(
			{
				mint: tokenObj.token[0].mint,
				memo: tokenObj.memo,
				unit: tokenObj.unit,
				proofs: tokenObj.token[0].proofs,
			},
			{ version: 3 },
		);
		expect(encoded).toBe(
			'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91LiJ9',
		);
	});
	test('encode a v3 token with getEncodedTokenV3', () => {
		const tokenObj = {
			token: [
				{
					mint: 'https://8333.space:3338',
					proofs: [
						{
							amount: 2,
							id: '009a1f293253e41e',
							secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
							C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
						},
						{
							amount: 8,
							id: '009a1f293253e41e',
							secret: 'fe15109314e61d7756b0f8ee0f23a624acaa3f4e042f61433c728c7057b931be',
							C: '029e8e5050b890a7d6c0968db16bc1d5d5fa040ea1de284f6ec69d61299f671059',
						},
					],
				},
			],
			unit: 'sat',
			memo: 'Thank you.',
		};
		const encoded = utils.getEncodedTokenV3({
			mint: tokenObj.token[0].mint,
			memo: tokenObj.memo,
			unit: tokenObj.unit,
			proofs: tokenObj.token[0].proofs,
		});
		expect(encoded).toBe(
			'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91LiJ9',
		);
	});
});

describe('test decode token', () => {
	test('testing v3 Token', async () => {
		const obj = {
			proofs: [
				{
					C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
					amount: 1,
					id: 'I2yN+iRYfkzT',
					secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
				},
			],
			mint: 'http://localhost:3338',
			unit: 'sat',
		};
		const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:'];
		uriPrefixes.forEach((prefix) => {
			const token =
				prefix +
				'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W3siaWQiOiJJMnlOK2lSWWZrelQiLCJhbW91bnQiOjEsInNlY3JldCI6Ijk3emZtbWFHZjVrOE1nMGdhanBuYm1wZXJ2VHRFZUU4d3dLcmk3cldwVXM9IiwiQyI6IjAyMTk1MDgxZTYyMmY5OGJmYzE5YTA1ZWJlMjM0MWQ5NTVjMGQxMjU4OGM1OTQ4Yzg1OGQwN2FkZWMwMDdiYzFlNCJ9XX1dfQ';

			const result = utils.getDecodedToken(token);
			expect(result).toStrictEqual(obj);
		});
	});
	test('testing v3 Token no prefix', async () => {
		const obj = {
			proofs: [
				{
					C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
					amount: 1,
					id: 'I2yN+iRYfkzT',
					secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
				},
			],
			mint: 'http://localhost:3338',
			unit: 'sat',
		};

		const token =
			'AeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W3siaWQiOiJJMnlOK2lSWWZrelQiLCJhbW91bnQiOjEsInNlY3JldCI6Ijk3emZtbWFHZjVrOE1nMGdhanBuYm1wZXJ2VHRFZUU4d3dLcmk3cldwVXM9IiwiQyI6IjAyMTk1MDgxZTYyMmY5OGJmYzE5YTA1ZWJlMjM0MWQ5NTVjMGQxMjU4OGM1OTQ4Yzg1OGQwN2FkZWMwMDdiYzFlNCJ9XX1dfQ';
		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual(obj);
	});
	test('testing v4 Token', () => {
		const v3Token = {
			memo: 'Thank you',
			unit: 'sat',
			mint: 'http://localhost:3338',
			proofs: [
				{
					secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
					C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
					id: '00ad268c4d1f5826',
					amount: 1,
				},
			],
		};

		const token =
			'cashuBpGF0gaJhaUgArSaMTR9YJmFwgaNhYQFhc3hAOWE2ZGJiODQ3YmQyMzJiYTc2ZGIwZGYxOTcyMTZiMjlkM2I4Y2MxNDU1M2NkMjc4MjdmYzFjYzk0MmZlZGI0ZWFjWCEDhhhUP_trhpXfStS6vN6So0qWvc2X3O4NfM-Y1HISZ5JhZGlUaGFuayB5b3VhbXVodHRwOi8vbG9jYWxob3N0OjMzMzhhdWNzYXQ=';

		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual(v3Token);
	});
	test('testing v4 Token with multi keyset', () => {
		const v3Token = {
			unit: 'sat',
			mint: 'http://localhost:3338',
			proofs: [
				{
					secret: 'acc12435e7b8484c3cf1850149218af90f716a52bf4a5ed347e48ecc13f77388',
					C: '0244538319de485d55bed3b29a642bee5879375ab9e7a620e11e48ba482421f3cf',
					id: '00ffd48b8f5ecf80',
					amount: 1,
				},
				{
					secret: '1323d3d4707a58ad2e23ada4e9f1f49f5a5b4ac7b708eb0d61f738f48307e8ee',
					C: '023456aa110d84b4ac747aebd82c3b005aca50bf457ebd5737a4414fac3ae7d94d',
					id: '00ad268c4d1f5826',
					amount: 2,
				},
				{
					secret: '56bcbcbb7cc6406b3fa5d57d2174f4eff8b4402b176926d3a57d3c3dcbb59d57',
					C: '0273129c5719e599379a974a626363c333c56cafc0e6d01abe46d5808280789c63',
					id: '00ad268c4d1f5826',
					amount: 1,
				},
			],
		};

		const token =
			'cashuBo2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA==';

		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual(v3Token);
	});
});

describe('test getTokenMetadata', () => {
	test('testing v3 Token', async () => {
		const token =
			'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vdGVzdG51dC5jYXNodS5zcGFjZSIsInByb29mcyI6W3sic2VjcmV0IjoiNGU1ODVjMTk1OTJhMGExMDAwN2I0NTE4MjJlMjJmODEyOWVjMjc1M2RhMGJlM2YyMmRlYzI2YTkyYjEzMDJkYiIsIkMiOiIwMjdmMzkwZjcxNjBhMDE3MWUwMTEzYTQzMTE1NjQ0NDdiMjk0MjgzM2FlOWRmZjBiZWI0OWNiMzE0Njc3YmE2YTQiLCJhbW91bnQiOjQsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjdiN2U4NjgwMTJmMGQ0NjI0MDZiZTc5MGY3MTNkOGE0Mjc2MmM0YTllZmJiZTIxMzRkZjFjZjlmYzU4MWRmOTgiLCJzIjoiMzI0NzVmZTczYmE5ODM5ZGRhMjczZmIzN2U0ZGVhZTM5ODdhYTA4NmU2ODE1MGE4YjgxODc2MThjZjE0NmIwYiIsImUiOiJiNWU1MDExYmFlYjRjMTNkNWM0NDg3NDVhZTNiNGRjNGJmNTE3YjUxZTRlYjAzZTlmNzQyMDRlMmM2OTNjZWJlIn19LHsic2VjcmV0IjoiMTZhMGNjMjIxNGFkY2Y4MGIxOWY2MGU5NzJiN2FkMWQ5ZWZhN2ExZWVkODRkZTExMWRmNmIwZDk4MmYyMTdmYiIsIkMiOiIwMzk1N2E3ZTlhYjc1ZjIxNTJiYTllYjVmMWI2ZjNjZDEyZGJiMmIzMTAwZDRmYWJjM2ZkNDU3Zjk1YjExZGNiY2UiLCJhbW91bnQiOjIsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjQ2ZDc0NzkxZDU2NzYwYjM5MzE3NTU1ZjEyODNlMmY0YWQxY2ZhNGEzNmE2N2MwNGU2Y2RlNTEwZjIyZWQxZWUiLCJzIjoiODFjYjIzZDA3OTkzNDFiYzk0ZjFmODcyMzViYzYzZjZiM2EyN2M4YjZmMTNhOWRjZjVmOTdhMTg0ODUyMTVjMCIsImUiOiJiZmYyZThhZWUzMmFjMTViMjFiMzhlOTkxMzk0ZjIzZTg0YzU2ODQ1YjFmNzQ3MTBkNjc0MWM2NzExN2M3ZDExIn19LHsic2VjcmV0IjoiYTUzMjc0Yjk0NzYwNjdhN2FlMGM3ZDFmYmE3YzNmNTNhN2I0YjM2MTBmMDNhZjczNmM2ZTFmYzUzNjFlYzZhYyIsIkMiOiIwMjZmNzk4MDQ4OTljNGM4MzA0NzVmYWIyYmIwMzA3MzRmNTY5ZDc4NGNmN2EwMmFkZjc0NGUxZmE2OTVhYjNkMmQiLCJhbW91bnQiOjIsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6ImIxMzQ3YjU4NGI0ODUxNzc2MTQ3NWMzYTU4ZmNhNDdmODBjMzY4ZmNiYmUwNmFiZGZkYzgyNTgyMzViNDFlMjEiLCJzIjoiZWZlNzMwMjk4ZmFlMDc2NDQwM2VmYmZjMDA0ZDVlN2Q4Y2FiYjZkNjI1NzAwNjFhYWJhY2MwYzFlMTc5NmRhZSIsImUiOiIzZDdlMDBmZmFlNmExMTU4NzViNDdmYTRkNWQ0MTMzOGYyMTA1ZTUzYzM1NGM5NmZlOTQ0OWQxZDkyODVkMDA5In19LHsic2VjcmV0IjoiYWI1MmJhNmE3NWI2NjU5ODU5OTI3YTMzNzA4MzI0MWM0YWRjNzllNzZkNGZkYjJmYjNhMDdjYjI1NjRiNjQ2MiIsIkMiOiIwM2QwMWE4MWQ1NzM0MDNlMjgwMzQ5NjM1OGIyYWJlZmMyZjQ1OTJlNTFkM2Y0MWY5MDdlMmQ2YzQ3OTJhNjUxOGYiLCJhbW91bnQiOjEsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjE2ZmEwMTZkNzI3ZmQ3YWM0Y2MzOTBjMThmMzM2MTFkOTQxOGViYThmZTU1N2UxNjhmNjcxZGU5OWFlMzRiOTkiLCJzIjoiNzdmOTE3Mzc4YzViMGVkNGM5OWQ1MmZkYWIyNWY3Y2IyMDFjYjMzZWYzZmI3NjQwODNjNjU1MmNkYWVjZTM5ZSIsImUiOiI1YjBhMjE5YjgzZjBhNTkzNWRiZDQ4MTg3ZDdkZTM4YjA2ZjIyMDkzZTI5Mzk0ZTkxOWFlYjlkNGU2NTc5MTAzIn19LHsic2VjcmV0IjoiZjY0MjU5MzU1YTFmMmQ1ZDg5MmM2NGY1YmVhZmFlODYxZGExNjM5OThhY2IyN2Y3Nzg3NjFhYzdlMjI2ZGNmMyIsIkMiOiIwMzQyZDM0OTlkNDczNTRlOGMyNzBmM2Q5NWIzN2Q4OGNkMmNiYmMyMzhhMTNkM2ZmMDJhZDBmMzQwZDU5ZTRmZGQiLCJhbW91bnQiOjEsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6ImIyY2RlYmUwMmQ1MGZjYjlhODJjZDI5NTYxMjNhNGZmODY4ZjIwNjk2ZmVhN2MzZGY1OTZiMjEwMGQyOTY4YTAiLCJzIjoiOWE2M2Y3ZDA1YThkOWVmMThkM2Q1MmI4MTRlMjI3MTZhZmY0ZTJmNjk2ZjI4NzI3ZTMxZTg2NzIxMDE1ZjFiZSIsImUiOiJjZmQzZWY3ZDI5N2RkMjFhNGQ5YTc2ZDYzOTQ3ZmQ0N2ViNjFjYWUzMzFmOGI4NzY1ZGYzYjZlNDZkNGQzMGExIn19XX1dLCJ1bml0Ijoic2F0In0';
		const metadata = utils.getTokenMetadata(token);
		expect(metadata).toStrictEqual({
			unit: 'sat',
			mint: 'https://testnut.cashu.space',
			amount: 10,
			incompleteProofs: [
				{
					C: '027f390f7160a0171e0113a4311564447b2942833ae9dff0beb49cb314677ba6a4',
					amount: 4,
					dleq: {
						e: 'b5e5011baeb4c13d5c448745ae3b4dc4bf517b51e4eb03e9f74204e2c693cebe',
						r: '7b7e868012f0d462406be790f713d8a42762c4a9efbbe2134df1cf9fc581df98',
						s: '32475fe73ba9839dda273fb37e4deae3987aa086e68150a8b8187618cf146b0b',
					},
					secret: '4e585c19592a0a10007b451822e22f8129ec2753da0be3f22dec26a92b1302db',
				},
				{
					C: '03957a7e9ab75f2152ba9eb5f1b6f3cd12dbb2b3100d4fabc3fd457f95b11dcbce',
					amount: 2,
					dleq: {
						e: 'bff2e8aee32ac15b21b38e991394f23e84c56845b1f74710d6741c67117c7d11',
						r: '46d74791d56760b39317555f1283e2f4ad1cfa4a36a67c04e6cde510f22ed1ee',
						s: '81cb23d0799341bc94f1f87235bc63f6b3a27c8b6f13a9dcf5f97a18485215c0',
					},
					secret: '16a0cc2214adcf80b19f60e972b7ad1d9efa7a1eed84de111df6b0d982f217fb',
				},
				{
					C: '026f79804899c4c830475fab2bb030734f569d784cf7a02adf744e1fa695ab3d2d',
					amount: 2,
					dleq: {
						e: '3d7e00ffae6a115875b47fa4d5d41338f2105e53c354c96fe9449d1d9285d009',
						r: 'b1347b584b48517761475c3a58fca47f80c368fcbbe06abdfdc8258235b41e21',
						s: 'efe730298fae0764403efbfc004d5e7d8cabb6d62570061aabacc0c1e1796dae',
					},
					secret: 'a53274b9476067a7ae0c7d1fba7c3f53a7b4b3610f03af736c6e1fc5361ec6ac',
				},
				{
					C: '03d01a81d573403e2803496358b2abefc2f4592e51d3f41f907e2d6c4792a6518f',
					amount: 1,
					dleq: {
						e: '5b0a219b83f0a5935dbd48187d7de38b06f22093e29394e919aeb9d4e6579103',
						r: '16fa016d727fd7ac4cc390c18f33611d9418eba8fe557e168f671de99ae34b99',
						s: '77f917378c5b0ed4c99d52fdab25f7cb201cb33ef3fb764083c6552cdaece39e',
					},
					secret: 'ab52ba6a75b6659859927a337083241c4adc79e76d4fdb2fb3a07cb2564b6462',
				},
				{
					C: '0342d3499d47354e8c270f3d95b37d88cd2cbbc238a13d3ff02ad0f340d59e4fdd',
					amount: 1,
					dleq: {
						e: 'cfd3ef7d297dd21a4d9a76d63947fd47eb61cae331f8b8765df3b6e46d4d30a1',
						r: 'b2cdebe02d50fcb9a82cd2956123a4ff868f20696fea7c3df596b2100d2968a0',
						s: '9a63f7d05a8d9ef18d3d52b814e22716aff4e2f696f28727e31e86721015f1be',
					},
					secret: 'f64259355a1f2d5d892c64f5beafae861da163998acb27f778761ac7e226dcf3',
				},
			],
		});
	});
	test('testing v4 Token', async () => {
		const token =
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAFD3Y7Nqe4xhcIWkYWEEYXN4QDRlNTg1YzE5NTkyYTBhMTAwMDdiNDUxODIyZTIyZjgxMjllYzI3NTNkYTBiZTNmMjJkZWMyNmE5MmIxMzAyZGJhY1ghAn85D3FgoBceAROkMRVkRHspQoM66d_wvrScsxRne6akYWSjYWVYILXlARuutME9XESHRa47TcS_UXtR5OsD6fdCBOLGk86-YXNYIDJHX-c7qYOd2ic_s35N6uOYeqCG5oFQqLgYdhjPFGsLYXJYIHt-hoAS8NRiQGvnkPcT2KQnYsSp77viE03xz5_Fgd-YpGFhAmFzeEAxNmEwY2MyMjE0YWRjZjgwYjE5ZjYwZTk3MmI3YWQxZDllZmE3YTFlZWQ4NGRlMTExZGY2YjBkOTgyZjIxN2ZiYWNYIQOVen6at18hUrqetfG2880S27KzEA1Pq8P9RX-VsR3LzmFko2FlWCC_8uiu4yrBWyGzjpkTlPI-hMVoRbH3RxDWdBxnEXx9EWFzWCCByyPQeZNBvJTx-HI1vGP2s6J8i28Tqdz1-XoYSFIVwGFyWCBG10eR1Wdgs5MXVV8Sg-L0rRz6SjamfATmzeUQ8i7R7qRhYQJhc3hAYTUzMjc0Yjk0NzYwNjdhN2FlMGM3ZDFmYmE3YzNmNTNhN2I0YjM2MTBmMDNhZjczNmM2ZTFmYzUzNjFlYzZhY2FjWCECb3mASJnEyDBHX6srsDBzT1adeEz3oCrfdE4fppWrPS1hZKNhZVggPX4A_65qEVh1tH-k1dQTOPIQXlPDVMlv6USdHZKF0Alhc1gg7-cwKY-uB2RAPvv8AE1efYyrttYlcAYaq6zAweF5ba5hclggsTR7WEtIUXdhR1w6WPykf4DDaPy74Gq9_cglgjW0HiGkYWEBYXN4QGFiNTJiYTZhNzViNjY1OTg1OTkyN2EzMzcwODMyNDFjNGFkYzc5ZTc2ZDRmZGIyZmIzYTA3Y2IyNTY0YjY0NjJhY1ghA9AagdVzQD4oA0ljWLKr78L0WS5R0_QfkH4tbEeSplGPYWSjYWVYIFsKIZuD8KWTXb1IGH1944sG8iCT4pOU6RmuudTmV5EDYXNYIHf5FzeMWw7UyZ1S_asl98sgHLM-8_t2QIPGVSza7OOeYXJYIBb6AW1yf9esTMOQwY8zYR2UGOuo_lV-Fo9nHema40uZpGFhAWFzeEBmNjQyNTkzNTVhMWYyZDVkODkyYzY0ZjViZWFmYWU4NjFkYTE2Mzk5OGFjYjI3Zjc3ODc2MWFjN2UyMjZkY2YzYWNYIQNC00mdRzVOjCcPPZWzfYjNLLvCOKE9P_Aq0PNA1Z5P3WFko2FlWCDP0-99KX3SGk2adtY5R_1H62HK4zH4uHZd87bkbU0woWFzWCCaY_fQWo2e8Y09UrgU4icWr_Ti9pbyhyfjHoZyEBXxvmFyWCCyzevgLVD8uags0pVhI6T_ho8gaW_qfD31lrIQDSlooA';
		const metadata = utils.getTokenMetadata(token);
		expect(metadata).toStrictEqual({
			unit: 'sat',
			mint: 'https://testnut.cashu.space',
			amount: 10,
			incompleteProofs: [
				{
					C: '027f390f7160a0171e0113a4311564447b2942833ae9dff0beb49cb314677ba6a4',
					amount: 4,
					dleq: {
						e: 'b5e5011baeb4c13d5c448745ae3b4dc4bf517b51e4eb03e9f74204e2c693cebe',
						r: '7b7e868012f0d462406be790f713d8a42762c4a9efbbe2134df1cf9fc581df98',
						s: '32475fe73ba9839dda273fb37e4deae3987aa086e68150a8b8187618cf146b0b',
					},
					secret: '4e585c19592a0a10007b451822e22f8129ec2753da0be3f22dec26a92b1302db',
				},
				{
					C: '03957a7e9ab75f2152ba9eb5f1b6f3cd12dbb2b3100d4fabc3fd457f95b11dcbce',
					amount: 2,
					dleq: {
						e: 'bff2e8aee32ac15b21b38e991394f23e84c56845b1f74710d6741c67117c7d11',
						r: '46d74791d56760b39317555f1283e2f4ad1cfa4a36a67c04e6cde510f22ed1ee',
						s: '81cb23d0799341bc94f1f87235bc63f6b3a27c8b6f13a9dcf5f97a18485215c0',
					},
					secret: '16a0cc2214adcf80b19f60e972b7ad1d9efa7a1eed84de111df6b0d982f217fb',
				},
				{
					C: '026f79804899c4c830475fab2bb030734f569d784cf7a02adf744e1fa695ab3d2d',
					amount: 2,
					dleq: {
						e: '3d7e00ffae6a115875b47fa4d5d41338f2105e53c354c96fe9449d1d9285d009',
						r: 'b1347b584b48517761475c3a58fca47f80c368fcbbe06abdfdc8258235b41e21',
						s: 'efe730298fae0764403efbfc004d5e7d8cabb6d62570061aabacc0c1e1796dae',
					},
					secret: 'a53274b9476067a7ae0c7d1fba7c3f53a7b4b3610f03af736c6e1fc5361ec6ac',
				},
				{
					C: '03d01a81d573403e2803496358b2abefc2f4592e51d3f41f907e2d6c4792a6518f',
					amount: 1,
					dleq: {
						e: '5b0a219b83f0a5935dbd48187d7de38b06f22093e29394e919aeb9d4e6579103',
						r: '16fa016d727fd7ac4cc390c18f33611d9418eba8fe557e168f671de99ae34b99',
						s: '77f917378c5b0ed4c99d52fdab25f7cb201cb33ef3fb764083c6552cdaece39e',
					},
					secret: 'ab52ba6a75b6659859927a337083241c4adc79e76d4fdb2fb3a07cb2564b6462',
				},
				{
					C: '0342d3499d47354e8c270f3d95b37d88cd2cbbc238a13d3ff02ad0f340d59e4fdd',
					amount: 1,
					dleq: {
						e: 'cfd3ef7d297dd21a4d9a76d63947fd47eb61cae331f8b8765df3b6e46d4d30a1',
						r: 'b2cdebe02d50fcb9a82cd2956123a4ff868f20696fea7c3df596b2100d2968a0',
						s: '9a63f7d05a8d9ef18d3d52b814e22716aff4e2f696f28727e31e86721015f1be',
					},
					secret: 'f64259355a1f2d5d892c64f5beafae861da163998acb27f778761ac7e226dcf3',
				},
			],
		});
	});
});

describe('test keyset derivation', () => {
	test('derive', () => {
		const keys = PUBKEYS;
		const keysetId = utils.deriveKeysetId(keys);
		expect(keysetId).toBe('009a1f293253e41e');
	});
});

describe('test v4 encoding', () => {
	test('standard token', async () => {
		const encodedV4 =
			'cashuBpGF0gaJhaUgArSaMTR9YJmFwgaNhYQFhc3hAOWE2ZGJiODQ3YmQyMzJiYTc2ZGIwZGYxOTcyMTZiMjlkM2I4Y2MxNDU1M2NkMjc4MjdmYzFjYzk0MmZlZGI0ZWFjWCEDhhhUP_trhpXfStS6vN6So0qWvc2X3O4NfM-Y1HISZ5JhZGlUaGFuayB5b3VhbXVodHRwOi8vbG9jYWxob3N0OjMzMzhhdWNzYXQ=';
		const v3Token = {
			memo: 'Thank you',
			mint: 'http://localhost:3338',
			proofs: [
				{
					secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
					C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
					id: '00ad268c4d1f5826',
					amount: 1,
				},
			],
			unit: 'sat',
		};
		const encoded = utils.getEncodedTokenV4(v3Token);
		const decodedEncodedToken = utils.getDecodedToken(encoded);
		const decodedExpectedToken = utils.getDecodedToken(encodedV4);
		expect(decodedEncodedToken).toEqual(v3Token);
		expect(decodedExpectedToken).toEqual(decodedEncodedToken);
	});
	test('multi Id token', async () => {
		const encodedV4 =
			'cashuBo2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA';
		const v3Token = {
			mint: 'http://localhost:3338',
			proofs: [
				{
					secret: 'acc12435e7b8484c3cf1850149218af90f716a52bf4a5ed347e48ecc13f77388',
					C: '0244538319de485d55bed3b29a642bee5879375ab9e7a620e11e48ba482421f3cf',
					id: '00ffd48b8f5ecf80',
					amount: 1,
				},
				{
					secret: '1323d3d4707a58ad2e23ada4e9f1f49f5a5b4ac7b708eb0d61f738f48307e8ee',
					C: '023456aa110d84b4ac747aebd82c3b005aca50bf457ebd5737a4414fac3ae7d94d',
					id: '00ad268c4d1f5826',
					amount: 2,
				},
				{
					secret: '56bcbcbb7cc6406b3fa5d57d2174f4eff8b4402b176926d3a57d3c3dcbb59d57',
					C: '0273129c5719e599379a974a626363c333c56cafc0e6d01abe46d5808280789c63',
					id: '00ad268c4d1f5826',
					amount: 1,
				},
			],
			unit: 'sat',
		};

		const encoded = utils.getEncodedTokenV4(v3Token);
		const decodedEncodedToken = utils.getDecodedToken(encoded);
		const decodedExpectedToken = utils.getDecodedToken(encodedV4);
		expect(decodedEncodedToken).toEqual(v3Token);
		expect(decodedExpectedToken).toEqual(decodedEncodedToken);
	});
	test('removing DLEQ', async () => {
		const proofs = [
			{
				amount: 1,
				C: '03ff2e729416437f9ea8d022c501ff5b309d607f98c9ab53d51cd24185b4d3e42b',
				id: '00b4cd27d8861a44',
				secret: '10216467bb33f6f079ae92349ba54fa34df99ba24572645b8b813688c74b582d',
				witness: undefined,
				dleq: {
					s: '26f44e265699d95ae2171db58257aeffe03d325e0f69da4bc95b9749358380fc',
					e: '8269767ac3f6ac368ad9ea8c05b13724ea8a58469677925aa948435685107b0d',
					r: '40ce4dbe14a1f65ae74328b5f81d83cdb3977595d78ddf01665d9aca6d450233',
				},
			},
			{
				amount: 4,
				C: '02b457f8e1e151cd71dd3246b56d0f479ac63786e71916b46d16369cb6f78024b9',
				id: '00b4cd27d8861a44',
				secret: '1b1bc7a099a63c808c17f8ca4ede03f30d3c243ca34ec4d10a1327b7cfb3ead7',
				witness: undefined,
				dleq: {
					s: '2c23b772ce14f2d67415313e343a2a1f282edff8d5dd09f181a383b6cb6c2f7a',
					e: 'c2312f2c61ba392c24434c9c9097f397cc856841bde5786db64a2ee2e1172770',
					r: '08178fda3f9b80a5653dec563a27f79b4e697a2fcaa99d746d2b3a8d2f8d85f2',
				},
			},
			{
				amount: 16,
				C: '03570cdf33bc832a60660b3e7d8ddb74d0dd3158e0fde5b0f607555bb7e8e9fb0f',
				id: '00b4cd27d8861a44',
				secret: '8425354533436ca7c29b34daae3aef85ab08925c810d1db4f005259d79d7f9f6',
				witness: undefined,
				dleq: {
					s: 'bd3b4dd0eddddbb52eb3372a216c13b385561a8a549c66559ece8220959ccde6',
					e: '2f03a5bdcfecfaabdf81875be3d78c14725bc960c780eac7b03c2b3c04eecdc3',
					r: '52056ba2a2410d0aa4164ac618a9ed83e3170f818fbaa140d91a95dcbd2feb2e',
				},
			},
		];
		const encoded = utils.getEncodedToken(
			{
				mint: 'https://nofees.testnut.cashu.space',
				proofs,
				memo: 'Demo',
			},
			{ removeDleq: true },
		);
		expect(encoded).toBe(
			'cashuBpGFteCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNlYXVjc2F0YXSBomFpSAC0zSfYhhpEYXCDo2FhAWFzeEAxMDIxNjQ2N2JiMzNmNmYwNzlhZTkyMzQ5YmE1NGZhMzRkZjk5YmEyNDU3MjY0NWI4YjgxMzY4OGM3NGI1ODJkYWNYIQP_LnKUFkN_nqjQIsUB_1swnWB_mMmrU9Uc0kGFtNPkK6NhYQRhc3hAMWIxYmM3YTA5OWE2M2M4MDhjMTdmOGNhNGVkZTAzZjMwZDNjMjQzY2EzNGVjNGQxMGExMzI3YjdjZmIzZWFkN2FjWCECtFf44eFRzXHdMka1bQ9HmsY3hucZFrRtFjactveAJLmjYWEQYXN4QDg0MjUzNTQ1MzM0MzZjYTdjMjliMzRkYWFlM2FlZjg1YWIwODkyNWM4MTBkMWRiNGYwMDUyNTlkNzlkN2Y5ZjZhY1ghA1cM3zO8gypgZgs-fY3bdNDdMVjg_eWw9gdVW7fo6fsPYWRkRGVtbw',
		);
		expect(utils.getDecodedToken(encoded).proofs[0].dleq).toBeUndefined();
	});
});

describe('test output selection', () => {
	test('keep amounts', () => {
		const amountsWeHave = [1, 2, 4, 4, 4, 8];
		const proofsWeHave = amountsWeHave.map((amount) => {
			return {
				amount: amount,
				id: 'id',
				C: 'C',
			} as Proof;
		});
		const keys = PUBKEYS as Keys;

		// info: getKeepAmounts returns the amounts we need to fill up
		// the wallet to a target number of denominations plus an optimal
		// split of the remaining amount (to reach the total amount)

		let amountsToKeep = utils.getKeepAmounts(proofsWeHave, 22, keys, 3);
		// keeping 22 with a target count of 3, we expect two 1s, two 2s, no 4s, and two 8s, and no extra to reach 22
		expect(amountsToKeep).toEqual([1, 1, 2, 2, 8, 8]);

		// keeping 22 with a target count of 4, we expect three 1s, three 2s, one 4, and one 8 and another 1 to reach 22
		amountsToKeep = utils.getKeepAmounts(proofsWeHave, 22, keys, 4);
		expect(amountsToKeep).toEqual([1, 1, 1, 1, 2, 2, 2, 4, 8]);

		// keeping 22 with a target of 2, we expect one 1, one 2, no 4s, one 8, and another 1, 2, 8 to reach 22
		amountsToKeep = utils.getKeepAmounts(proofsWeHave, 22, keys, 2);
		expect(amountsToKeep).toEqual([1, 1, 2, 2, 8, 8]);
	});
});
describe('test zero-knowledge utilities', () => {
	// create private public key pair
	const privkey = hexToBytes('1'.padStart(64, '0'));
	const pubkey = pointFromBytes(getPubKeyFromPrivKey(privkey));

	// make up a secret
	const fakeSecret = new TextEncoder().encode('fakeSecret');
	// make up blinding factor
	const r = hexToNumber('123456'.padStart(64, '0'));
	// blind secret
	const fakeBlindedMessage = blindMessage(fakeSecret, r);
	// construct DLEQ
	const fakeDleq = createDLEQProof(fakeBlindedMessage.B_, privkey);
	// blind signature
	const fakeBlindSignature = createBlindSignature(fakeBlindedMessage.B_, privkey, 1, '00');
	// unblind
	const proof = constructProofFromPromise(fakeBlindSignature, r, fakeSecret, pubkey);
	// serialize
	const serializedProof = {
		...serializeProof(proof),
		dleq: {
			r: numberToHexPadded64(r),
			e: bytesToHex(fakeDleq.e),
			s: bytesToHex(fakeDleq.s),
		},
	} as Proof;

	test('has valid dleq', () => {
		const keyset = {
			id: '00',
			unit: 'sat',
			keys: { [1]: pubkey.toHex(true) },
		};
		const validDleq = hasValidDleq(serializedProof, keyset);
		expect(validDleq).toBe(true);
	});
	test('has valid dleq with no matching key', () => {
		const keyset = {
			id: '00',
			unit: 'sat',
			keys: { [2]: pubkey.toHex(true) },
		};
		let exc: Error | undefined = undefined;
		try {
			hasValidDleq(serializedProof, keyset);
		} catch (e) {
			exc = e;
		}
		expect(exc).toEqual(new Error('undefined key for amount 1'));
	});
});

describe('test raw tokens', () => {
	const token: Token = {
		mint: 'http://localhost:3338',
		proofs: [
			{
				id: '00ad268c4d1f5826',
				amount: 1,
				secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
				C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
			},
		],
		memo: 'Thank you',
		unit: 'sat',
	};

	test('bytes to token', () => {
		const expectedBytes = hexToBytes(
			'6372617742a4617481a261694800ad268c4d1f5826617081a3616101617378403961366462623834376264323332626137366462306466313937323136623239643362386363313435353363643237383237666331636339343266656462346561635821038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d4721267926164695468616e6b20796f75616d75687474703a2f2f6c6f63616c686f73743a33333338617563736174',
		);

		const decodedToken = utils.getDecodedTokenBinary(expectedBytes);
		expect(decodedToken).toEqual(token);
	});

	test('token to bytes', () => {
		const bytes = utils.getEncodedTokenBinary(token);
		const decodedToken = utils.getDecodedTokenBinary(bytes);
		expect(decodedToken).toEqual(token);
	});
});

describe('test deprecated base64 keyset id derivation', () => {
	test('derives expected MiniBits base64 keyset id from known keys', () => {
		// Reference from https://mint.minibits.cash/Bitcoin/v1/keys/9mlfd5vCzgGl
		const keys = {
			'1': '037de920102afb5f25c26dc48a152a73159c6b7202f08b4c603c29714f4d01b543',
			'2': '026a1d80a1ccbff4b8db701c507b8b47e50039a795f7846de57d45926689a14a0b',
			'4': '03e5700269c327ab1ce7d07a353b245345a6fca05ebe7eee9906f0d2017d5890c8',
			'8': '03294a57af75fdf601369d9bcc1dde4e95f32b9fb03658f2e52d952c374407e31b',
			'16': '02aec3e9ec63ca66d275c399e1d6c92cc65fcccc68e8add9c458dfba97da4c9c04',
			'32': '037f768ec409af30e7c61ac64348582f25007b7965a407aba3b3855a35323a246f',
			'64': '035c8392ed5aa93e46373940f2fbf114904f2bd173376d8b90f786f23e93f2ea84',
			'128': '02036837713ba7be203e70ef344f2487b60e75b9869c652e7c283e80a1d54794df',
			'256': '03d6f059d9e1592b7892b29e2e71aa0a49e959deb00163bccfcc205100fbf32633',
			'512': '02bf1021a830bd4c0ae0a1523464c96e142973661070f1de428da4122aa6f69493',
			'1024': '02381a31b2de8b948d4ff78926c55d8979923f8f9bf2468651034f5c9b7f475821',
			'2048': '03f5b5ee9f4163abf9268fe2c0da03876edde13ac3811c36b615fc991acc0eebbc',
			'4096': '022e578fb6d291c19957861b15891b49657f51a81efddf81084bab738d8a56f14b',
			'8192': '0337a766afcedfc3ef727ec445d43748540b51370f501cfcfccfecc6f238590267',
			'16384': '02828f0d67d469b668496fbd86f26d9f9a844b27a20e447f78470600747aa2b00e',
			'32768': '02ed1a744615151144e59ee14e7ba38406097144e14f6e764ac0f0bb0acf515564',
			'65536': '025b95bf15abb982ed543ab0b6942271fe2d223d2494aceb6bf7377afc4aa27ea6',
			'131072': '03fd2d6012632f5e130b0233205e80a1caeb02ccc41718bc895b8c99a265ea3dbf',
			'262144': '024660de13c4090cfa9d7a17e4d874ae15a29e3bfda53eeadb3e534d7c1a74eafa',
			'524288': '035c291c286bb5f24caa3ff739e619938a5b788d1090824c3b8e6baca8f13e4da1',
			'1048576': '0380ba32670b40f013b2bfacb5a37e7a6bbae2f2efb62dff741f02af311fbdb3ff',
			'2097152': '03dd0bfe20cdeccfa37c1f26ce312d1b1c539bcb1d12ab451d80370d274a3641b6',
			'4194304': '03de35c81c6ca87a49c9bcff121f2509263220686578b1fca47f20c574fa150b39',
			'8388608': '02e0c794288db2d1e9af61503ed830c7e5055b643724815d528d4c3021ea1559bb',
			'16777216': '035125f7a7c72f10ec61fb47f8178ca5e0aec47de7cf75612bd250a56c7ad37ead',
			'33554432': '03c7001d3af9ea3b6e20f36ec48edd91e966abba65ee3bd9a281eddfb53a521a53',
			'67108864': '02a64da5b912a21a7e2c3300c2648325c53ca778bf4d0b9622a1c7780d4dc0cffb',
			'134217728': '03950615088289af7ad9ad4aa426147417f05ab7ce6804227d351b24edae9832b1',
			'268435456': '0354f09d1f4a3606a31646201d6f313f7b531e1cf957b8ce90ca73e32799388204',
			'536870912': '02d2a5f0b70548aeeaf971c4da7bcf208b601a30152ae2450caedcea27bb1d8e21',
			'1073741824': '035f306eea76978d0270168bd6b8497cce8aef13bcc144fc36c2fb48a8aab66b06',
			'2147483648': '037a7f635fc3256de40c5fb8a2f1879ca449df0f4bd95852eea1169a83922c7788',
			'4294967296': '03f0dda240e992ff12b4b3de9e483280d53be0c85d02738e85f9b6b0ef085f8f10',
			'8589934592': '020cfe88a9fa3f40c1cffb951f58b2281e5a7926e2c8aa6341b24ab8fcf331cc3b',
			'17179869184': '02ba136d0643cb72af7120e769b8667870ad759cf5cfe4ca6a1f90ace342492a74',
			'34359738368': '03b73e27456513de3aa6f6eca6db70f1c91cfb5121647780fc6e4a9a8be42b7b87',
			'68719476736': '030ed205b00155ccf5e957761d04d01eb2491020e6dd7e512acb05914aaff8a5d1',
			'137438953472': '0392ba4f30272282bb82bb3ffe4f46b6d509212105eb16da909c10ab6eee960a9c',
			'274877906944': '031f3062051ee54583104bf7655952d8b5996ae0733b82a579fb97be7cd9be60c4',
			'549755813888': '0365aa156544baee813dd6f3cd679e2e64e7789a650d2228d17c2e4040d8824571',
			'1099511627776': '0366482f5a25e7b628131a7f39283e0309dca82658357b5b6ea7c03518710c3e68',
			'2199023255552': '02b59efb3b9431a7e121bee18648885d66100b86f280984182d4da442d2e751da7',
			'4398046511104': '03d23cc53c1f5aca508914725679ccefa34e3a028e6637005937052359e3f39cbe',
			'8796093022208': '03806f5967e95336a60a51199757c503d8423ac9c97600d2c33c284b83e60a8ca3',
			'17592186044416': '02a64c86d630e5eb23dc6af8788afc37685e781542b0e68d2b3681c5f97e26cdae',
			'35184372088832': '0343c8f9757870807de2dc0f1fe811d1d1f5654ce459ca98be4ae9d146aeaedf28',
			'70368744177664': '022d6b80f5fef273eee4fdc2532bf3e7cd7640aba1aeee7f6824a76e94fb1932ad',
			'140737488355328': '028c80cd39e11bdf228d2f8fc27272823eda3ba6934ffdce5b41515891241f035b',
			'281474976710656': '02580b0ab8340815ed61ee0d351e19fe6268253d3742a17338be3ff005daec52e2',
			'562949953421312': '02cc4c2a32983df4cc7d154698bd3dfe1f9813a70c451b6af5ee5a252c57457d1e',
			'1125899906842624': '0236d3f7716e5157ddd419991ef3b7d43926547971214a81896be0c0be34548396',
			'2251799813685248': '02b63068aaf6668958fcb284c9ca5ef852fd55d276a9e89343c72361c5fe513b24',
			'4503599627370496': '0271354593bf8c5590ed51e625d0f009628857ce6bd31522049ee6e6bc8586d9c8',
			'9007199254740992': '03472e10b746819b2c604a8b9f2a7ecc1989b6ee65ef06d2487d8032311bf729e6',
			'18014398509481984': '02832e9ea5c26326d3498635b808329b00fd9985ca6f6332579fd4a1a560633b76',
			'36028797018963968': '03d87a088c7321942c389cfd39aabb008be421dad28cf5d4e009ba438276642e13',
			'72057594037927936': '03f6471bf910ef2b025cbcb36b402df0332255527774def41d5d27c262bffbe1be',
			'144115188075855872': '031de9127b8296c4b9d7e898d6f444953771f0c311880fab50bf02e3230eaed3a0',
			'288230376151711744': '02e4292ddc507bfd918d9c4faac74136f64bcf155ddce12f75b387ff53b848dec9',
			'576460752303423488': '02eb6c1ed989b7e56b5722a312dd2a7e86b9fa2bba1146b2ebc9d12f24076a2d5e',
			'1152921504606846976': '03a5e4c8216c73454444dbfccd6c01ba9708440de00a3f5faf8cfb7e95cc4f4054',
			'2305843009213693952': '033486861c85458521c0fd1ac129e84a174e10118d559ee3185062f8f432eb622e',
			'4611686018427387904': '02217ec885b5d75100a20b4337498afefd4ef76e4082cf361d32ae869c695e34a5',
			'9223372036854775808': '039f14f18f3ceaca7dcf18cd212eaf2656e65c337fc4a98cd4e7c119982338e57a',
		};
		const idB64 = utils.deriveKeysetId(keys as unknown as Keys, undefined, undefined, 0, true);
		expect(idB64).toBe('9mlfd5vCzgGl');
	});
	test('verifies MiniBits base64 keyset id', () => {
		// Reference from https://mint.minibits.cash/Bitcoin/v1/keys/9mlfd5vCzgGl
		const keys = {
			'1': '037de920102afb5f25c26dc48a152a73159c6b7202f08b4c603c29714f4d01b543',
			'2': '026a1d80a1ccbff4b8db701c507b8b47e50039a795f7846de57d45926689a14a0b',
			'4': '03e5700269c327ab1ce7d07a353b245345a6fca05ebe7eee9906f0d2017d5890c8',
			'8': '03294a57af75fdf601369d9bcc1dde4e95f32b9fb03658f2e52d952c374407e31b',
			'16': '02aec3e9ec63ca66d275c399e1d6c92cc65fcccc68e8add9c458dfba97da4c9c04',
			'32': '037f768ec409af30e7c61ac64348582f25007b7965a407aba3b3855a35323a246f',
			'64': '035c8392ed5aa93e46373940f2fbf114904f2bd173376d8b90f786f23e93f2ea84',
			'128': '02036837713ba7be203e70ef344f2487b60e75b9869c652e7c283e80a1d54794df',
			'256': '03d6f059d9e1592b7892b29e2e71aa0a49e959deb00163bccfcc205100fbf32633',
			'512': '02bf1021a830bd4c0ae0a1523464c96e142973661070f1de428da4122aa6f69493',
			'1024': '02381a31b2de8b948d4ff78926c55d8979923f8f9bf2468651034f5c9b7f475821',
			'2048': '03f5b5ee9f4163abf9268fe2c0da03876edde13ac3811c36b615fc991acc0eebbc',
			'4096': '022e578fb6d291c19957861b15891b49657f51a81efddf81084bab738d8a56f14b',
			'8192': '0337a766afcedfc3ef727ec445d43748540b51370f501cfcfccfecc6f238590267',
			'16384': '02828f0d67d469b668496fbd86f26d9f9a844b27a20e447f78470600747aa2b00e',
			'32768': '02ed1a744615151144e59ee14e7ba38406097144e14f6e764ac0f0bb0acf515564',
			'65536': '025b95bf15abb982ed543ab0b6942271fe2d223d2494aceb6bf7377afc4aa27ea6',
			'131072': '03fd2d6012632f5e130b0233205e80a1caeb02ccc41718bc895b8c99a265ea3dbf',
			'262144': '024660de13c4090cfa9d7a17e4d874ae15a29e3bfda53eeadb3e534d7c1a74eafa',
			'524288': '035c291c286bb5f24caa3ff739e619938a5b788d1090824c3b8e6baca8f13e4da1',
			'1048576': '0380ba32670b40f013b2bfacb5a37e7a6bbae2f2efb62dff741f02af311fbdb3ff',
			'2097152': '03dd0bfe20cdeccfa37c1f26ce312d1b1c539bcb1d12ab451d80370d274a3641b6',
			'4194304': '03de35c81c6ca87a49c9bcff121f2509263220686578b1fca47f20c574fa150b39',
			'8388608': '02e0c794288db2d1e9af61503ed830c7e5055b643724815d528d4c3021ea1559bb',
			'16777216': '035125f7a7c72f10ec61fb47f8178ca5e0aec47de7cf75612bd250a56c7ad37ead',
			'33554432': '03c7001d3af9ea3b6e20f36ec48edd91e966abba65ee3bd9a281eddfb53a521a53',
			'67108864': '02a64da5b912a21a7e2c3300c2648325c53ca778bf4d0b9622a1c7780d4dc0cffb',
			'134217728': '03950615088289af7ad9ad4aa426147417f05ab7ce6804227d351b24edae9832b1',
			'268435456': '0354f09d1f4a3606a31646201d6f313f7b531e1cf957b8ce90ca73e32799388204',
			'536870912': '02d2a5f0b70548aeeaf971c4da7bcf208b601a30152ae2450caedcea27bb1d8e21',
			'1073741824': '035f306eea76978d0270168bd6b8497cce8aef13bcc144fc36c2fb48a8aab66b06',
			'2147483648': '037a7f635fc3256de40c5fb8a2f1879ca449df0f4bd95852eea1169a83922c7788',
			'4294967296': '03f0dda240e992ff12b4b3de9e483280d53be0c85d02738e85f9b6b0ef085f8f10',
			'8589934592': '020cfe88a9fa3f40c1cffb951f58b2281e5a7926e2c8aa6341b24ab8fcf331cc3b',
			'17179869184': '02ba136d0643cb72af7120e769b8667870ad759cf5cfe4ca6a1f90ace342492a74',
			'34359738368': '03b73e27456513de3aa6f6eca6db70f1c91cfb5121647780fc6e4a9a8be42b7b87',
			'68719476736': '030ed205b00155ccf5e957761d04d01eb2491020e6dd7e512acb05914aaff8a5d1',
			'137438953472': '0392ba4f30272282bb82bb3ffe4f46b6d509212105eb16da909c10ab6eee960a9c',
			'274877906944': '031f3062051ee54583104bf7655952d8b5996ae0733b82a579fb97be7cd9be60c4',
			'549755813888': '0365aa156544baee813dd6f3cd679e2e64e7789a650d2228d17c2e4040d8824571',
			'1099511627776': '0366482f5a25e7b628131a7f39283e0309dca82658357b5b6ea7c03518710c3e68',
			'2199023255552': '02b59efb3b9431a7e121bee18648885d66100b86f280984182d4da442d2e751da7',
			'4398046511104': '03d23cc53c1f5aca508914725679ccefa34e3a028e6637005937052359e3f39cbe',
			'8796093022208': '03806f5967e95336a60a51199757c503d8423ac9c97600d2c33c284b83e60a8ca3',
			'17592186044416': '02a64c86d630e5eb23dc6af8788afc37685e781542b0e68d2b3681c5f97e26cdae',
			'35184372088832': '0343c8f9757870807de2dc0f1fe811d1d1f5654ce459ca98be4ae9d146aeaedf28',
			'70368744177664': '022d6b80f5fef273eee4fdc2532bf3e7cd7640aba1aeee7f6824a76e94fb1932ad',
			'140737488355328': '028c80cd39e11bdf228d2f8fc27272823eda3ba6934ffdce5b41515891241f035b',
			'281474976710656': '02580b0ab8340815ed61ee0d351e19fe6268253d3742a17338be3ff005daec52e2',
			'562949953421312': '02cc4c2a32983df4cc7d154698bd3dfe1f9813a70c451b6af5ee5a252c57457d1e',
			'1125899906842624': '0236d3f7716e5157ddd419991ef3b7d43926547971214a81896be0c0be34548396',
			'2251799813685248': '02b63068aaf6668958fcb284c9ca5ef852fd55d276a9e89343c72361c5fe513b24',
			'4503599627370496': '0271354593bf8c5590ed51e625d0f009628857ce6bd31522049ee6e6bc8586d9c8',
			'9007199254740992': '03472e10b746819b2c604a8b9f2a7ecc1989b6ee65ef06d2487d8032311bf729e6',
			'18014398509481984': '02832e9ea5c26326d3498635b808329b00fd9985ca6f6332579fd4a1a560633b76',
			'36028797018963968': '03d87a088c7321942c389cfd39aabb008be421dad28cf5d4e009ba438276642e13',
			'72057594037927936': '03f6471bf910ef2b025cbcb36b402df0332255527774def41d5d27c262bffbe1be',
			'144115188075855872': '031de9127b8296c4b9d7e898d6f444953771f0c311880fab50bf02e3230eaed3a0',
			'288230376151711744': '02e4292ddc507bfd918d9c4faac74136f64bcf155ddce12f75b387ff53b848dec9',
			'576460752303423488': '02eb6c1ed989b7e56b5722a312dd2a7e86b9fa2bba1146b2ebc9d12f24076a2d5e',
			'1152921504606846976': '03a5e4c8216c73454444dbfccd6c01ba9708440de00a3f5faf8cfb7e95cc4f4054',
			'2305843009213693952': '033486861c85458521c0fd1ac129e84a174e10118d559ee3185062f8f432eb622e',
			'4611686018427387904': '02217ec885b5d75100a20b4337498afefd4ef76e4082cf361d32ae869c695e34a5',
			'9223372036854775808': '039f14f18f3ceaca7dcf18cd212eaf2656e65c337fc4a98cd4e7c119982338e57a',
		};

		const mintKeys = {
			id: '9mlfd5vCzgGl',
			unit: 'sat',
			keys: keys,
		} as MintKeys;

		const verified = utils.verifyKeysetId(mintKeys);
		expect(verified).toBe(true);
	});
});

describe('invoiceHasAmountInHRP()', () => {
	test('detects amountless invoices correctly', () => {
		const amountless = [
			'lnbc1p53lqw7pp5d8ntp7kfaqcqtxfgks0n32xd4lng2hhx5z3gvfcm9teyn4vee35sdp82pshjgr5dusyymrfde4jq4mpd3kx2apq24ek2uscqzpuxqr8pqsp5wdg4qaq6ktrvfm4z99ry98y4qrmg3krnc4mhf2rwce230hyyeu4s9qxpqysgqgz7lt5hnxcq3wrpd5qe64a37msj0lhqfa0ky6ppagyedd79lz86zrcg20p78csjtqv3sc2m06uu24ykh8q0jzhu30yr820sysh9wv8gpz44nvz',
		];
		amountless.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(false));
	});

	test('detects invoices with amount', () => {
		const withAmount = [
			// 21 sats (210n → valid)
			'lnbc210n1p53lq0wpp5tsmnj3c6znsdyu5v8t2k3y8xw33m9hnd6exzwspxa4pqz3hze8rsdp82pshjgr5dusyymrfde4jq4mpd3kx2apq24ek2uscqzpuxqrwzqsp5jgr8l0yx8zpxfez9hns5t25j9m90yrzjz34gpacssd6lwr7an40q9qxpqysgqws7g2g9hh6awk2n6vhzpqjyf6matulx0cc0ct099nz6kudzv8xmy9clu4kyvurrt99zkr7y03hse85c2jvm7jm8qlqnvzawudn4e3vsq0m6qpa',

			// 1 BTC — no multiplier
			'lnbc11p53lqsgpp5mxs67qwmh34wu3jy7um8u490n2dtgy7dsrhzpdup008g8ygj2eysdp82pshjgr5dusyymrfde4jq4mpd3kx2',
		];

		withAmount.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(true));
	});

	test('rejects malformed or invalid HRP structure', () => {
		const invalid = [
			'lNbc210n1...', // uppercase LN (valid BOLT-11 but won’t match this HRP regex → fine)
			'lnbc0210n1...', // leading zero in amount → invalid per spec
			'lnsomething', // incomplete HRP
		];

		invalid.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(false));
	});
});
