import {
	deriveSecret,
	generateNewMnemonic,
	deriveSeedFromMnemonic,
	deriveBlindingFactor
} from '../src/secrets';

const mnemonic =
	'vehicle liberty balcony ensure label shiver garage fish shrimp various slam audit';
const seed = new Uint8Array([
	145, 161, 210, 31, 40, 240, 127, 134, 145, 5, 205, 11, 105, 44, 150, 208, 149, 141, 80, 33, 36,
	57, 83, 205, 173, 128, 123, 107, 64, 199, 63, 176, 167, 239, 255, 243, 189, 64, 189, 51, 56, 24,
	33, 162, 20, 119, 154, 207, 143, 74, 191, 58, 135, 167, 204, 46, 141, 115, 107, 182, 236, 248, 58,
	150
]);
describe('testing deterministic secrets', () => {
	test('generate new mnemonic', async () => {
		const mnem = generateNewMnemonic();
		console.log(mnem);
		expect(mnem.split(' ').length).toBe(12);
	});

	test('derive seed', async () => {
		const seed = deriveSeedFromMnemonic(mnemonic);
		console.log(seed);
		expect(seed.toString()).toBe(
			[
				145, 161, 210, 31, 40, 240, 127, 134, 145, 5, 205, 11, 105, 44, 150, 208, 149, 141, 80, 33,
				36, 57, 83, 205, 173, 128, 123, 107, 64, 199, 63, 176, 167, 239, 255, 243, 189, 64, 189, 51,
				56, 24, 33, 162, 20, 119, 154, 207, 143, 74, 191, 58, 135, 167, 204, 46, 141, 115, 107, 182,
				236, 248, 58, 150
			].toString()
		);
	});

	test('derive Secret', async () => {
		const secret = deriveSecret(seed, 'z32vUtKgNCm1', 0);
	});
	test('derive BF', async () => {
		const secret = deriveBlindingFactor(seed, 'z32vUtKgNCm1', 0);
	});
});
