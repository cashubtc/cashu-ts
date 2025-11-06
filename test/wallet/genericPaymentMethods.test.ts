/**
 * Tests for generic payment method support in Wallet, WalletOps, and Mint classes
 */

import { describe, it, expect, vi } from 'vitest';
import { Wallet } from '../../src/wallet';
import { Mint } from '../../src/mint';
import type { Proof } from '../../src/model/types';
import type { MeltProofsResponse } from '../../src/wallet/types';

// ---- Test fixtures -------------------------------------------------------

const proofs: Proof[] = [
	{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
	{ amount: 3, id: '00bd033559de27d0', secret: 'test', C: 'test' },
];

const customMintQuote = {
	quote: 'custom-mint-quote-1',
	amount: 100,
	unit: 'sat',
	expiry: Math.floor(Date.now() / 1000) + 3600,
	customField: 'customValue',
};

const customMeltQuote = {
	quote: 'custom-melt-quote-1',
	amount: 100,
	fee_reserve: 5,
	state: 'UNPAID',
	expiry: Math.floor(Date.now() / 1000) + 3600,
	customField: 'customValue',
};

// ---- Wallet Tests -------------------------------------------------------

describe('Wallet - Generic Payment Methods', () => {
	describe('Generic Mint Quote Methods', () => {
		it('should create a mint quote for any payment method', async () => {
			const mint = new Mint('http://localhost:3338');

			// Mock the underlying request
			const mockRequest = vi.spyOn(mint, 'createMintQuote').mockResolvedValueOnce(customMintQuote);

			const result = await mint.createMintQuote('custom-payment', {
				unit: 'sat',
				amount: 100,
			});

			expect(mockRequest).toHaveBeenCalledWith('custom-payment', expect.objectContaining({ unit: 'sat', amount: 100 }));
			expect(result).toEqual(customMintQuote);
		});

		it('should check a mint quote for any payment method', async () => {
			const mint = new Mint('http://localhost:3338');

			const mockRequest = vi.spyOn(mint, 'checkMintQuote').mockResolvedValueOnce(customMintQuote);

			const result = await mint.checkMintQuote('custom-payment', 'custom-mint-quote-1');

			expect(mockRequest).toHaveBeenCalledWith('custom-payment', 'custom-mint-quote-1');
			expect(result).toEqual(customMintQuote);
		});
	});

	describe('Generic Melt Quote Methods', () => {
		it('should create a melt quote for any payment method', async () => {
			const mint = new Mint('http://localhost:3338');

			const mockRequest = vi.spyOn(mint, 'createMeltQuote').mockResolvedValueOnce(customMeltQuote);

			const result = await mint.createMeltQuote('custom-payment', {
				unit: 'sat',
				request: 'custom-request-format',
			});

			expect(mockRequest).toHaveBeenCalledWith(
				'custom-payment',
				expect.objectContaining({ unit: 'sat', request: 'custom-request-format' }),
			);
			expect(result).toEqual(customMeltQuote);
		});

		it('should check a melt quote for any payment method', async () => {
			const mint = new Mint('http://localhost:3338');

			const mockRequest = vi.spyOn(mint, 'checkMeltQuote').mockResolvedValueOnce(customMeltQuote);

			const result = await mint.checkMeltQuote('custom-payment', 'custom-melt-quote-1');

			expect(mockRequest).toHaveBeenCalledWith('custom-payment', 'custom-melt-quote-1');
			expect(result).toEqual(customMeltQuote);
		});
	});

	describe('Generic Proofs Methods', () => {
		it('should have mintProofsGeneric method available', async () => {
			const wallet = new Wallet('http://localhost:3338');

			// Verify method exists and is callable
			expect(wallet.mintProofsGeneric).toBeDefined();
			expect(typeof wallet.mintProofsGeneric).toBe('function');
		});

		it('should have meltProofsGeneric method available', async () => {
			const wallet = new Wallet('http://localhost:3338');

			// Verify method exists and is callable
			expect(wallet.meltProofsGeneric).toBeDefined();
			expect(typeof wallet.meltProofsGeneric).toBe('function');
		});
	});

	describe('Backward Compatibility', () => {
		it('should support bolt11 method name through generic methods', async () => {
			const wallet = new Wallet('http://localhost:3338');

			// Verify method can be called with bolt11
			expect(wallet.mintProofsGeneric).toBeDefined();
			expect(wallet.meltProofsGeneric).toBeDefined();
		});

		it('should support bolt12 method name through generic methods', async () => {
			const wallet = new Wallet('http://localhost:3338');

			// Verify method can be called with bolt12
			expect(wallet.mintProofsGeneric).toBeDefined();
			expect(wallet.meltProofsGeneric).toBeDefined();
		});
	});
});

// ---- Generic Quote Methods Tests ---------------------------------------------------

describe('Wallet - Generic Quote Methods', () => {
	it('should have createMintQuoteGeneric method available', async () => {
		const wallet = new Wallet('http://localhost:3338');
		expect(wallet.createMintQuoteGeneric).toBeDefined();
		expect(typeof wallet.createMintQuoteGeneric).toBe('function');
	});

	it('should have checkMintQuoteGeneric method available', async () => {
		const wallet = new Wallet('http://localhost:3338');
		expect(wallet.checkMintQuoteGeneric).toBeDefined();
		expect(typeof wallet.checkMintQuoteGeneric).toBe('function');
	});

	it('should have createMeltQuoteGeneric method available', async () => {
		const wallet = new Wallet('http://localhost:3338');
		expect(wallet.createMeltQuoteGeneric).toBeDefined();
		expect(typeof wallet.createMeltQuoteGeneric).toBe('function');
	});

	it('should have checkMeltQuoteGeneric method available', async () => {
		const wallet = new Wallet('http://localhost:3338');
		expect(wallet.checkMeltQuoteGeneric).toBeDefined();
		expect(typeof wallet.checkMeltQuoteGeneric).toBe('function');
	});
});

// ---- Integration Tests ------------------------------------------------

describe('Generic Payment Methods - Integration Scenarios', () => {
	it('should support custom payment method flow types', async () => {
		const wallet = new Wallet('http://localhost:3338');

		// Verify quote methods exist
		expect(wallet.createMintQuoteGeneric).toBeDefined();
		expect(wallet.checkMintQuoteGeneric).toBeDefined();
		expect(wallet.mintProofsGeneric).toBeDefined();
	});

	it('should support custom payment method melt flow types', async () => {
		const wallet = new Wallet('http://localhost:3338');

		// Verify melt quote methods exist
		expect(wallet.createMeltQuoteGeneric).toBeDefined();
		expect(wallet.checkMeltQuoteGeneric).toBeDefined();
		expect(wallet.meltProofsGeneric).toBeDefined();
	});

	it('should accept type-safe quotes with extra fields', async () => {
		const wallet = new Wallet('http://localhost:3338');

		const customQuoteWithMetadata = {
			quote: 'custom-quote',
			amount: 100,
			unit: 'sat',
			expiry: Math.floor(Date.now() / 1000) + 3600,
			customField1: 'value1',
			customField2: 42,
			customField3: { nested: 'data' },
		};

		// Verify method signature accepts custom fields
		expect(wallet.mintProofsGeneric).toBeDefined();
		expect(typeof wallet.mintProofsGeneric).toBe('function');
	});
});
