import { describe, expect, test } from 'vitest';
import { getTagInt, hasTag, parseHTLCSecret, parseSecret } from '../../src/crypto';
import { Proof } from '../../src';

const proof: Proof = {
	amount: 2,
	id: '00bfa73302d12ffd',
	secret:
		'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]',
	C: '0344b6f1471cf18a8cbae0e624018c816be5e3a9b04dcb7689f64173c1ae90a3a5',
	witness:
		'{"preimage":"0000000000000000000000000000000000000000000000000000000000000001","signatures":["98e21672d409cc782c720f203d8284f0af0c8713f18167499f9f101b7050c3e657fb0e57478ebd8bd561c31aa6c30f4cd20ec38c73f5755b7b4ddee693bca5a5","693f40129dbf905ed9c8008081c694f72a36de354f9f4fa7a61b389cf781f62a0ae0586612fb2eb504faaf897fefb6742309186117f4743bcebcb8e350e975e2"]}',
};

describe('NUT10 module core functions', () => {
	test('parseSecret parses a valid secret', () => {
		const result = parseSecret(proof.secret);
		expect(result).toContain('HTLC');
	});

	test('parseSecret throws for invalid NUT-10 secret (bad JSON)', () => {
		const secretStr = `["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","bad"data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow("Can't parse secret");
	});

	test('parseSecret throws for invalid NUT-10 secret (bad kind)', () => {
		const secretStr = `[123,{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 secret/);
	});

	test('parseSecret throws for invalid NUT-10 secret (bad nonce)', () => {
		const secretStr = `["P2PK",{"nonce":123,"data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 secret/);
	});

	test('parseSecret throws for invalid NUT-10 secret (bad data)', () => {
		const secretStr =
			'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":123,"tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]';
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 secret/);
	});

	test('parseSecret throws for invalid NUT-10 secret (tags not array)', () => {
		const secretStr =
			'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":{"pubkeys":"039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100","locktime":"1"}}]';
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 secret/);
	});

	test('parseSecret throws for invalid NUT-10 secret (n_sigs_refund tag is not a string)', () => {
		const secretStr =
			'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund",2],["sigflag","SIG_ALL"]]}]';
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 tag/);
	});

	test('parseSecret throws for invalid NUT-10 secret (n_sigs_refund tag has empty value)', () => {
		const secretStr =
			'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2",""],["sigflag","SIG_ALL"]]}]';
		expect(() => {
			parseHTLCSecret(secretStr);
		}).toThrow(/Invalid NUT-10 tag/);
	});

	test('hasTag finds tags', () => {
		expect(hasTag(proof.secret, 'locktime')).toBeTruthy();
		expect(hasTag(proof.secret, 'n_sigs_refund')).toBeTruthy();
		expect(hasTag(proof.secret, 'not_exists')).toBeFalsy();
	});

	test('getTagInt finds tags', () => {
		expect(getTagInt(proof.secret, 'locktime')).toEqual(1);
		expect(getTagInt(proof.secret, 'not_exists')).toBeFalsy();
		expect(getTagInt(proof.secret, 'sigflag')).toBeFalsy();
	});
});
