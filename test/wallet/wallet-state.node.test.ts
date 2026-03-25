import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';
import { Wallet, CheckStateEnum } from '../../src';
import { mint, unit, mintUrl, useTestServer } from './_setup';

const server = useTestServer();

describe('checkProofsStates', () => {
	const proofs = [
		{
			id: '00bd033559de27d0',
			amount: 1n,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
	];
	test('test checkProofsStates - get proofs that are NOT spendable', async () => {
		server.use(
			http.post(mintUrl + '/v1/checkstate', () => {
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.checkProofsStates(proofs);
		result.forEach((r) => {
			expect(r.state).toEqual(CheckStateEnum.UNSPENT);
			expect(r.witness).toEqual('witness-asd');
		});
	});
});

describe('groupProofsByState', () => {
	test('test groupProofsByState groups proofs by state', async () => {
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a14',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 128n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a15',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 4n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a16',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a17',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 16n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a18',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		server.use(
			http.post(mintUrl + '/v1/checkstate', () => {
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'SPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02c2c185f0c66b6de36443623fd83d14c6a4725a98f7d9bf6a07f85356574f9068',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02c801497e8c184b0b041fcd2aff4cd2f3ad35d88f6788afe1591a4540b37a0567',
							state: 'SPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02120df194276661363da9a2fc558975c45ffefc06b094b228074886cddff59470',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02e7e7e6b59cb8de7e32a9e43dd4329922ff6c93fd30a0a604f08fd3a0bc820c93',
							state: 'PENDING',
							witness: 'witness-asd',
						},
						{
							Y: '029279de78447f77619b2c6905b9140eb4fff110908359bf9efd06f8e17e354099',
							state: 'SPENT',
							witness: 'witness-asd',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const result = await wallet.groupProofsByState(proofs);
		expect(result.unspent[0].amount).toEqual(8n);
		expect(result.unspent[1].amount).toEqual(4n);
		expect(result.spent[0].amount).toEqual(2n);
		expect(result.spent[1].amount).toEqual(128n);
		expect(result.spent[2].amount).toEqual(16n);
		expect(result.pending[0].amount).toEqual(1n);
	});
});
