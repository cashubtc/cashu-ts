import { CashuMint } from '../src/CashuMint';
import { CashuWallet } from '../src/CashuWallet';
import { MintQuoteState, Proof, OnchainMintQuoteResponse } from '../src/model/types/index';
import { sumProofs } from '../src/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

// Configuration
const MINT_URL = 'http://localhost:8085';
const INITIAL_MINT_AMOUNT = 5000;

const privateKey = randomBytes(32);
const pubkey = secp256k1.getPublicKey(privateKey, true);

const runOnchainWalletExample = async () => {
	try {
		console.log('🚀 Onchain Wallet Example');
		console.log('=========================\n');

		// Initialize mint and wallet
		const mint = new CashuMint(MINT_URL);
		const wallet = new CashuWallet(mint);
		await wallet.loadMint();

		// Mint initial proofs via BOLT11 for demonstration purposes
		let proofs = await mintInitialProofs(wallet);

		// Create onchain mint quote to get a Bitcoin address
		console.log('📋 Creating onchain mint quote (generates Bitcoin address)');
		const onchainMintQuote = await wallet.createMintQuoteOnchain(bytesToHex(pubkey));
		console.log(`✅ Bitcoin address generated: ${onchainMintQuote.request}\n`);

		// Demonstrate onchain melt (sending Bitcoin onchain) using existing proofs
		console.log('🔥 Demonstrating onchain melt (sending Bitcoin onchain)...');
		proofs = await demonstrateOnchainMelt(wallet, proofs, onchainMintQuote.request);

		// Check for onchain payments to the generated address
		console.log('\n💰 Checking for onchain payments to the generated address...');
		console.log('(In real usage, you would send Bitcoin to the address above)');
		const updatedQuote = await checkForOnchainPayments(wallet, onchainMintQuote);

		if (updatedQuote.amount_paid > 0) {
			const newProofs = await mintFromOnchainQuote(wallet, updatedQuote);
			proofs.push(...newProofs);
			console.log(`💰 Updated balance: ${sumProofs(proofs)} sats\n`);
		} else {
			console.log('💭 No onchain payments received\n');
		}

		// Final summary
		console.log('🎯 Summary');
		console.log('==========');
		console.log(`💰 Final balance: ${sumProofs(proofs)} sats`);
		console.log(`✅ Onchain example completed!`);
	} catch (error) {
		console.error('❌ Error:', error);
	}
};

runOnchainWalletExample();

// Helper functions

/**
 * Waits for a BOLT11 mint quote to be paid and then mints proofs.
 */
const waitForMintQuote = async (wallet: CashuWallet, quoteId: string): Promise<Proof[]> => {
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

/**
 * Mints initial proofs via BOLT11 Lightning invoice for demonstration purposes.
 */
const mintInitialProofs = async (wallet: CashuWallet): Promise<Proof[]> => {
	console.log(`💰 Minting ${INITIAL_MINT_AMOUNT} sats via BOLT11 Lightning invoice...`);

	const bolt11Quote = await wallet.createMintQuote(INITIAL_MINT_AMOUNT);
	console.log(`Pay this invoice: ${bolt11Quote.request}`);

	const proofs = await waitForMintQuote(wallet, bolt11Quote.quote);
	console.log(`✅ Minted ${sumProofs(proofs)} sats\n`);

	return proofs;
};

/**
 * Checks for onchain Bitcoin payments to the generated address.
 */
const checkForOnchainPayments = async (
	wallet: CashuWallet,
	quote: OnchainMintQuoteResponse,
): Promise<OnchainMintQuoteResponse> => {
	console.log('🔍 Checking for onchain payments...');

	// In a real scenario, you might poll this multiple times until payment is received
	const updatedQuote = await wallet.checkMintQuoteOnchain(quote.quote);

	console.log(`📊 Payment status:`);
	console.log(`   - Amount paid: ${updatedQuote.amount_paid} sats`);
	console.log(`   - Amount issued: ${updatedQuote.amount_issued} sats`);
	console.log(`   - Amount unconfirmed: ${updatedQuote.amount_unconfirmed} sats`);

	return updatedQuote;
};

/**
 * Mints proofs from received onchain Bitcoin payments.
 */
const mintFromOnchainQuote = async (
	wallet: CashuWallet,
	quote: OnchainMintQuoteResponse,
): Promise<Proof[]> => {
	const availableToMint = quote.amount_paid - quote.amount_issued;

	if (availableToMint <= 0) {
		console.log('💭 No new payments available to mint');
		return [];
	}

	console.log(`💎 Minting ${availableToMint} sats from onchain payment`);
	const proofs = await wallet.mintProofsOnchain(availableToMint, quote, bytesToHex(privateKey));

	console.log(`✅ Minted ${proofs.length} proofs totaling ${sumProofs(proofs)} sats`);
	return proofs;
};

/**
 * Demonstrates onchain melting (sending Bitcoin onchain) using existing proofs.
 */
const demonstrateOnchainMelt = async (
	wallet: CashuWallet,
	proofs: Proof[],
	bitcoinAddress: string,
): Promise<Proof[]> => {
	// Use 80% of balance for melting, keeping some for demonstration
	const meltAmount = Math.floor(sumProofs(proofs) * 0.8);

	try {
		// Create onchain melt quote
		const meltQuote = await wallet.createMeltQuoteOnchain(bitcoinAddress, meltAmount);
		const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

		console.log(`📤 Onchain melt quote created:`);
		console.log(`   - Destination: ${meltQuote.request}`);
		console.log(`   - Amount: ${meltQuote.amount} sats`);
		console.log(`   - Fee reserve: ${meltQuote.fee_reserve} sats`);
		console.log(`   - Total needed: ${totalNeeded} sats`);

		if (sumProofs(proofs) < totalNeeded) {
			console.log(`❌ Insufficient balance: need ${totalNeeded}, have ${sumProofs(proofs)}`);
			return proofs;
		}

		// Send the onchain payment
		const { keep, send } = await wallet.send(totalNeeded, proofs, { includeFees: true });
		const { change } = await wallet.meltProofsOnchain(meltQuote, send);

		console.log(`✅ Bitcoin sent onchain successfully!`);
		console.log(`   - Sent: ${sumProofs(send)} sats`);
		console.log(`   - Change: ${sumProofs(change)} sats`);
		console.log(`   - Remaining: ${sumProofs([...keep, ...change])} sats`);

		// Return the updated proofs (keep + change)
		return [...keep, ...change];
	} catch (error) {
		console.error(`❌ Onchain melt failed:`, error);
		return proofs; // Return original proofs if melt failed
	}
};
