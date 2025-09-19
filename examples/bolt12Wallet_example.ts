import { Wallet } from '../src/wallet';
import dns from 'node:dns';
import { MintQuoteState, Bolt12MintQuoteResponse } from '../src/mint/types';
import { Proof } from '../src/model/types';
import { sumProofs } from '../src/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

dns.setDefaultResultOrder('ipv4first');

// Configuration
const MINT_URL = 'http://localhost:8085';
const INITIAL_MINT_AMOUNT = 5000;
const PAYMENT_AMOUNT = 1000;
const PAYMENT_CYCLES = 1;

const privateKey = randomBytes(32);
const pubkey = secp256k1.getPublicKey(privateKey, true);

const runBolt12WalletExample = async () => {
	try {
		console.log('🚀 BOLT12 Wallet Example');
		console.log('========================\n');

		// Initialize wallet
		const wallet = new Wallet(MINT_URL);
		await wallet.loadMint();

		// Create reusable BOLT12 offer
		console.log('📋 Creating BOLT12 mint quote (reusable offer)');
		const bolt12MintQuote = await wallet.createMintQuoteBolt12(bytesToHex(pubkey));
		console.log(`✅ BOLT12 offer created: ${bolt12MintQuote.request}\n`);

		// Mint initial proofs via BOLT11
		let proofs = await mintInitialProofs(wallet);
		let totalSent = 0;

		// Pay BOLT12 offer multiple times
		// NOTE: CDK currently only lets us pay each offer once because there is a unique constraint on the offer.
		console.log(`🔄 Making ${PAYMENT_CYCLES} payments to BOLT12 offer\n`);

		for (let cycle = 1; cycle <= PAYMENT_CYCLES; cycle++) {
			console.log(`--- Payment ${cycle}/${PAYMENT_CYCLES} ---`);

			try {
				// Pay the BOLT12 offer
				const { remainingProofs, sentAmount } = await payBolt12Offer(
					wallet,
					bolt12MintQuote.request,
					PAYMENT_AMOUNT,
					proofs,
				);

				proofs = remainingProofs;
				totalSent += sentAmount;

				// Mint new proofs from accumulated payments
				const newProofs = await mintFromBolt12Quote(wallet, bolt12MintQuote);
				proofs.push(...newProofs);

				console.log(`💰 Balance: ${sumProofs(proofs)} sats\n`);

				if (cycle < PAYMENT_CYCLES) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			} catch (error) {
				console.error(`❌ Payment ${cycle} failed:`, error);
				break;
			}
		}

		// Final summary
		console.log('🎯 Summary');
		console.log('==========');
		console.log(`💰 Final balance: ${sumProofs(proofs)} sats`);
		console.log(`📤 Total sent: ${totalSent} sats`);
		console.log(`✅ BOLT12 example completed!`);
	} catch (error) {
		console.error('❌ Error:', error);
	}
};

runBolt12WalletExample();

// Helper functions
const waitForMintQuote = async (wallet: Wallet, quoteId: string): Promise<Proof[]> => {
	while (true) {
		const quote = await wallet.checkMintQuote(quoteId);

		if (quote.state === MintQuoteState.PAID) {
			return await wallet.mintProofs(INITIAL_MINT_AMOUNT, quoteId);
		} else if (quote.state === MintQuoteState.ISSUED) {
			throw new Error('Quote has already been issued');
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
};

const mintInitialProofs = async (wallet: Wallet): Promise<Proof[]> => {
	console.log(`💰 Minting ${INITIAL_MINT_AMOUNT} sats via BOLT11...`);

	const bolt11Quote = await wallet.createMintQuote(INITIAL_MINT_AMOUNT);
	console.log(`Pay this invoice: ${bolt11Quote.request}`);

	const proofs = await waitForMintQuote(wallet, bolt11Quote.quote);
	console.log(`✅ Minted ${sumProofs(proofs)} sats`);

	return proofs;
};

const payBolt12Offer = async (
	wallet: Wallet,
	offer: string,
	amount: number,
	proofs: Proof[],
): Promise<{ remainingProofs: Proof[]; sentAmount: number }> => {
	// Create melt quote
	const meltQuote = await wallet.createMeltQuoteBolt12(offer, amount * 1000);
	const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

	if (sumProofs(proofs) < totalNeeded) {
		throw new Error(`Insufficient balance: need ${totalNeeded}, have ${sumProofs(proofs)}`);
	}

	// Send payment
	const { keep, send } = await wallet.sendAsDefault(totalNeeded, proofs, { includeFees: true });
	const { change } = await wallet.meltProofsBolt12(meltQuote, send);

	console.log(`💸 Paid ${amount} sats to BOLT12 offer (fee: ${meltQuote.fee_reserve} sats)`);

	return {
		remainingProofs: [...keep, ...change],
		sentAmount: sumProofs(send),
	};
};

const mintFromBolt12Quote = async (
	wallet: Wallet,
	quote: Bolt12MintQuoteResponse,
): Promise<Proof[]> => {
	const updatedQuote = await wallet.checkMintQuoteBolt12(quote.quote);
	const availableToMint = updatedQuote.amount_paid - updatedQuote.amount_issued;

	if (availableToMint <= 0) {
		return [];
	}

	console.log(`💎 Minting ${availableToMint} sats from BOLT12 payments`);
	const newProofs = await wallet.mintProofsBolt12(
		availableToMint,
		updatedQuote,
		bytesToHex(privateKey),
	);

	console.log(`✅ Minted ${newProofs.length} new proofs`);
	return newProofs;
};
