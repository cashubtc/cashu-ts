import { test, describe, expect } from 'vitest';
import { signMintQuote, verifyMintQuoteSignature } from '../../src/crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Amount } from '../../src';

/**
 * NUT-29 test vectors for batch mint signatures.
 */
describe('NUT-29 batch mint signatures', () => {
  const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
  const keysetId = '010000000000000000000000000000000000000000000000000000000000000000';

  const allOutputs = [
    {
      amount: Amount.from(1),
      id: keysetId,
      B_: '036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2',
    },
    {
      amount: Amount.from(1),
      id: keysetId,
      B_: '021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59',
    },
  ];

  const expectedMsgHash = '73027f17704341b1595f9aa0ccc02ccfb066ff60fc4d29f328cb2eeda6e34673';
  const expectedSignature =
    '1c7e4d05aab3c9a474b9238a6ed894f9fd19431c6663518da572e4ed4219930b73090b479dc314ad13fc1d386106ed4292bda3af2aba8a7b2912f0b8586d749c';

  test('message hash matches test vector', () => {
    const message = 'locked-quote' + ':' + allOutputs[0].B_ + ':' + allOutputs[1].B_;
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
