import { Proof } from '../src/model/Proof';

describe('Proofs', () => {
	const proof = new Proof(
		'0NI3TUAs1Sfy',
		1,
		'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
		'034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
	);
	test('test Proof toJSON', async () => {
		expect(proof.toJSON()).toStrictEqual({
			id: '0NI3TUAs1Sfy',
			amount: 1,
			secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		});
		expect(JSON.stringify(proof)).toBe(
			'{"id":"0NI3TUAs1Sfy","amount":1,"secret":"H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=","C":"034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be"}'
		);
	});
	test('test Proof newProof', async () => {
		expect(
			Proof.newProof({
				id: '0NI3TUAs1Sfy',
				amount: 1,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			})
		).toMatchObject(proof);
	});

	test('test Proof encodeProofToBase64', async () => {
		expect(proof.encodeProofToBase64()).toBe('');
	});
});
