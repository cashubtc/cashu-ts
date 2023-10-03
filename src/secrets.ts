import { HDKey } from '@scure/bip32';
import {
	generateMnemonic,
	validateMnemonic,
	mnemonicToSeedSync
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { encodeBase64toUint8 } from './base64';
import { bytesToNumber } from './utils';
export const generateNewMnemonic = (): string => {
	const mnemonic = generateMnemonic(wordlist, 128);
	if (!validateMnemonic(mnemonic, wordlist)) {
		return generateNewMnemonic();
	}
	return mnemonic;
};

export const deriveSeedFromMnemonic = (mnemonic: string): Uint8Array => {
	const seed = mnemonicToSeedSync(mnemonic);
	return seed;
};

export const deriveSecret = (seed: Uint8Array, keysetId: string, counter: number): Uint8Array => {
	return derive(seed, keysetId, counter, 0);
};

export const deriveBlindingFactor = (
	seed: Uint8Array,
	keysetId: string,
	counter: number
): Uint8Array => {
	return derive(seed, keysetId, counter, 1);
};

const derive = (
	seed: Uint8Array,
	keysetId: string,
	counter: number,
	secretOrBlinding: 0 | 1
): Uint8Array => {
	const hdkey = HDKey.fromMasterSeed(seed);
	const keysetIdInt = bytesToNumber(encodeBase64toUint8(keysetId)) % BigInt(2 ** 31 - 1);
	const derivationPath = `m/129372'/0'/${keysetIdInt}'/${counter}'/${secretOrBlinding}`

	//todo: remove this after tests are fixed
	console.log(derivationPath)
	
	const derived = hdkey.derive(derivationPath);
	if (derived.privateKey === null) {
		throw new Error('Could not derive private key');
	}
	return derived.privateKey;
};
