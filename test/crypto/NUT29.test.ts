import { test, describe, expect } from 'vitest';
import { signBatchMintQuote, verifyBatchMintQuoteSignature } from '../../src/crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Amount } from '../../src';

/**
 * NUT-29 batch mint signatures.
 *
 * Test vector from nuts/tests/29-tests.md (sk = 1)
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

  // Canonical results from the spec test vector.
  const expectedMsgToSign =
    '43617368755f4d696e7451756f74655369675f76310000000c6c6f636b65642d71756f7465' +
    '000000010100000021036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2' +
    '000000010100000021021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59';
  const expectedMsgHash = '03dc68d6617bba502d8648efd0965bf393841082cf04fd03e5de4bcb5777cdfc';
  const expectedSignature =
    'a913e48177027d87e0e38c6f2021763c46997ff4866a4b63ebca800b0776b28519eab37377cf9bc1869e489d7b25747b7a998eaa1c33c2cac7fa168449d8267a';

  test('canonical msg_to_sign hashes to the test vector', () => {
    expect(bytesToHex(sha256(hexToBytes(expectedMsgToSign)))).toBe(expectedMsgHash);
  });

  test('test vector signature verifies correctly', () => {
    expect(
      verifyBatchMintQuoteSignature(pubkey, 'locked-quote', allOutputs, expectedSignature),
    ).toBe(true);
  });

  test('signBatchMintQuote over all outputs produces a valid signature', () => {
    const signature = signBatchMintQuote(privkey, 'locked-quote', allOutputs);
    expect(verifyBatchMintQuoteSignature(pubkey, 'locked-quote', allOutputs, signature)).toBe(true);
  });

  test('signature over per-quote subset is invalid against full output set', () => {
    const perQuoteSig = signBatchMintQuote(privkey, 'locked-quote', [allOutputs[0]]);
    expect(verifyBatchMintQuoteSignature(pubkey, 'locked-quote', allOutputs, perQuoteSig)).toBe(
      false,
    );
  });

  test('signature is bound to output amounts', () => {
    const signature = signBatchMintQuote(privkey, 'locked-quote', allOutputs);
    const reValued = [{ ...allOutputs[0], amount: Amount.from(2) }, allOutputs[1]];
    expect(verifyBatchMintQuoteSignature(pubkey, 'locked-quote', reValued, signature)).toBe(false);
  });

  test('signature is bound to output order', () => {
    const signature = signBatchMintQuote(privkey, 'locked-quote', allOutputs);
    const reordered = [allOutputs[1], allOutputs[0]];
    expect(verifyBatchMintQuoteSignature(pubkey, 'locked-quote', reordered, signature)).toBe(false);
  });

  test('each quote in a batch signs over the same output set, bound to its quote ID', () => {
    const sigQuote1 = signBatchMintQuote(privkey, 'quote-1', allOutputs);
    const sigQuote2 = signBatchMintQuote(privkey, 'quote-2', allOutputs);

    expect(verifyBatchMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote1)).toBe(true);
    expect(verifyBatchMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote2)).toBe(true);

    // Each signature is bound to its quote ID
    expect(verifyBatchMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote2)).toBe(false);
    expect(verifyBatchMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote1)).toBe(false);
  });
});
