import { test, describe, expect } from 'vitest';

import { Wallet, OutputData } from '../../src';

import { mint, useTestServer } from './_setup';

const server = useTestServer();

describe('P2PK BlindingData', () => {
	test('Create BlindingData locked to single pk with locktime and single refund key', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund']);
		});
	});
	test('Create BlindingData locked to single pk with locktime and multiple refund keys', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund', 'asecondrefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
		});
	});
	test('Create BlindingData locked to single pk without locktime and no refund keys', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData({ pubkey: 'thisisatest' }, 21, keys);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toEqual([]);
		});
	});
	test('Create BlindingData locked to single pk with unexpected requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', requiredSignatures: 5 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toEqual([]);
		});
	});
	test('Create BlindingData locked to multiple pks with no requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).not.toContainEqual(['n_sigs', '1']);
		});
	});
	test('Create BlindingData locked to multiple pks with 2-of-3 requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'], requiredSignatures: 2 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['n_sigs', '2']);
		});
	});
	test('Create BlindingData locked to multiple pks with out of range requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'], requiredSignatures: 5 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['n_sigs', '3']);
		});
	});
	test('Create BlindingData locked to single refund key with default requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund'],
				requiredRefundSignatures: 1,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
	test('Create BlindingData locked to multiple refund keys with no requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund', 'asecondrefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
	test('Create BlindingData locked to multiple refund keys with 2-of-3 requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund', 'athirdrefund'],
				requiredRefundSignatures: 2,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund', 'athirdrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs_refund', '2']);
		});
	});
	test('Create BlindingData locked to multiple refund keys with out of range requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund', 'athirdrefund'],
				requiredRefundSignatures: 5,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund', 'athirdrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs_refund', '3']);
		});
	});
	test('Create BlindingData locked to multiple refund keys with expired multisig', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: ['thisisatest', 'asecondpk', 'athirdpk'],
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund'],
				requiredSignatures: 2,
				requiredRefundSignatures: 1,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs', '2']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
});
