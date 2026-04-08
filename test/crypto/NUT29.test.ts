import { test, describe, expect } from 'vitest';
import { signMintQuote, verifyMintQuoteSignature } from '../../src/crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * NUT-29 test vectors for batch mint signatures.
 *
 * Signatures follow the NUT-20 message aggregation pattern: the message is constructed by
 * concatenating the quote ID and all B_ hex strings as UTF-8, then SHA-256 hashing the result. The
 * signature covers ALL outputs in the batch, not just outputs belonging to a single quote.
 *
 * Test vector parameters (from nuts/tests/29-tests.md, corrected for NUT-20 message format): sk = 1
 * pubkey = 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 quote =
 * "locked-quote" B_0 = 036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2 B_1 =
 * 021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59.
 */
describe('NUT-29 batch mint signatures', () => {
	const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
	const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
	const keysetId = '010000000000000000000000000000000000000000000000000000000000000000';

	const allOutputs = [
		{
			amount: 1n,
			id: keysetId,
			B_: '036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2',
		},
		{
			amount: 1n,
			id: keysetId,
			B_: '021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59',
		},
	];

	const expectedMsgHash = 'a62f12934711693d6045ed2843ae4c5b33fd156df029fb9337dea3175c438263';
	const expectedSignature =
		'bd4d55f3fda33109fe3694c041aa9358c8e6e581236245ee310e7e225dfb075d9a2799b9672e646cb7e9fad9887f5b42a04d307a238d219783a4790b323194c0';

	test('message hash matches test vector', () => {
		const message = 'locked-quote' + allOutputs[0].B_ + allOutputs[1].B_;
		const hash = bytesToHex(sha256(new TextEncoder().encode(message)));
		expect(hash).toBe(expectedMsgHash);
	});

	test('test vector signature verifies correctly', () => {
		expect(verifyMintQuoteSignature(pubkey, 'locked-quote', allOutputs, expectedSignature)).toBe(
			true,
		);
	});

	test('signMintQuote over all outputs produces a valid signature', () => {
		const signature = signMintQuote(privkey, 'locked-quote', allOutputs);
		expect(verifyMintQuoteSignature(pubkey, 'locked-quote', allOutputs, signature)).toBe(true);
	});

	test('signature over per-quote subset is invalid against full output set', () => {
		const perQuoteSig = signMintQuote(privkey, 'locked-quote', [allOutputs[0]]);
		expect(verifyMintQuoteSignature(pubkey, 'locked-quote', allOutputs, perQuoteSig)).toBe(false);
	});

	test('each quote in a batch must sign over the same complete output set', () => {
		const sigQuote1 = signMintQuote(privkey, 'quote-1', allOutputs);
		const sigQuote2 = signMintQuote(privkey, 'quote-2', allOutputs);

		expect(verifyMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote1)).toBe(true);
		expect(verifyMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote2)).toBe(true);

		// Each signature is bound to its quote ID
		expect(verifyMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote2)).toBe(false);
		expect(verifyMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote1)).toBe(false);
	});
});
