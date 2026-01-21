import { describe, expect, test, vi } from 'vitest';
import {
	createHTLCHash,
	createHTLCsecret,
	getHTLCWitnessPreimage,
	getPubKeyFromPrivKey,
	isHTLCSpendAuthorised,
	parseHTLCSecret,
	signP2PKProof,
	verifyHTLCHash,
} from '../../src/crypto';
import { Proof } from '../../src';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';

const PRIVKEY = schnorr.utils.randomSecretKey();
const PUBKEY = bytesToHex(getPubKeyFromPrivKey(PRIVKEY));

describe('NUT14 module core functions', () => {
	test('createHTLCsecret creates a valid secret', () => {
		const result = createHTLCsecret('deadbeef');
		expect(result).toContain('HTLC');
	});

	test('parseHTLCSecret throws for non-HTLC type', () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow('HTLC');
	});

	test('createHTLCHash creates consistent hash and preimage', () => {
		const { hash, preimage } = createHTLCHash();
		expect(typeof hash).toBe('string');
		expect(typeof preimage).toBe('string');
		expect(hash.length).toBe(64);
		expect(preimage.length).toBe(64);
	});

	test('createHTLCHash can take explicit preimage and still produce correct hash', () => {
		const pre = '00'.repeat(32);
		const { hash } = createHTLCHash(pre);
		const { hash: again } = createHTLCHash(pre);
		expect(hash).toBe(again);
	});

	test('verifyHTLCHash returns true for matching preimage/hash pair', () => {
		const pre = '00'.repeat(32);
		const { hash } = createHTLCHash(pre);
		expect(verifyHTLCHash(pre, hash)).toBe(true);
	});

	test('verifyHTLCHash returns false for incorrect pair', () => {
		const pre = '00'.repeat(32);
		expect(verifyHTLCHash(pre, 'ff'.repeat(32))).toBe(false);
	});
});

describe('verifyHTLCSpendingConditions and isHTLCSpendAuthorised', () => {
	test('HTLC main spending pathway', async () => {
		const proof: Proof = {
			amount: 2,
			id: '00bfa73302d12ffd',
			secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
			C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
			witness: '{"preimage":"0000000000000000000000000000000000000000000000000000000000000001"}',
		};
		const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
		expect(isHTLCSpendAuthorised(signedProof)).toBe(true);
	});
	test('HTLC main spending pathway, no preimage (fails)', async () => {
		const proof: Proof = {
			amount: 2,
			id: '00bfa73302d12ffd',
			secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
			C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
			witness: undefined,
		};
		const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
		expect(isHTLCSpendAuthorised(signedProof)).toBe(false);
		expect(isHTLCSpendAuthorised(proof)).toBe(false); // no sig or preimage
	});
	test('HTLC main spending pathway, incorrect preimage (fails)', async () => {
		const proof: Proof = {
			amount: 2,
			id: '00bfa73302d12ffd',
			secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
			C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
			witness: '{"preimage":"1000000000000000000000000000000000000000000000000000000000000001"}',
		};
		const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
		expect(isHTLCSpendAuthorised(signedProof)).toBe(false);
	});
});

describe('getHTLCWitnessPreimage', () => {
	test('returns undefined when witness is undefined', () => {
		expect(getHTLCWitnessPreimage(undefined)).toBeUndefined();
	});

	test('returns preimage from object witness', () => {
		const w = { preimage: 'abcd' };
		expect(getHTLCWitnessPreimage(w)).toBe('abcd');
	});

	test('returns preimage from stringified witness', () => {
		const w = JSON.stringify({ preimage: 'zzzz' });
		expect(getHTLCWitnessPreimage(w)).toBe('zzzz');
	});

	test('returns undefined when preimage missing or empty', () => {
		expect(getHTLCWitnessPreimage({})).toBeUndefined();
		expect(getHTLCWitnessPreimage(JSON.stringify({}))).toBeUndefined();
	});

	test('returns undefined and logs error when JSON parse fails', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(getHTLCWitnessPreimage('{invalid')).toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
