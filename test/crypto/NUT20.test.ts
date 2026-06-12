import { test, describe, expect } from 'vitest';
import { signMintQuote, verifyMintQuoteSignature } from '../../src/crypto';
import { signMintQuoteAmended, verifyMintQuoteSignatureAmended } from '../../src/crypto/NUT20';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Amount, MintRequest } from '../../src';

describe('mint quote signatures (legacy message)', () => {
  test('valid signature verification', () => {
    let mintRequest = {
      quote: '9d745270-1405-46de-b5c5-e2762b4f5e00',
      outputs: [
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '0342e5bcc77f5b2a3c2afb40bb591a1e27da83cddc968abdc0ec4904201a201834',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '032fd3c4dc49a2844a89998d5e9d5b0f0b00dde9310063acb8a92e2fdafa4126d4',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '033b6fde50b6a0dfe61ad148fff167ad9cf8308ded5f6f6b2fe000a036c464c311',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02be5a55f03e5c0aaea77595d574bce92c6d57a2a0fb2b5955c0b87e4520e06b53',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02209fc2873f28521cbdde7f7b3bb1521002463f5979686fd156f23fe6a8aa2b79',
        },
      ],
      signature:
        'd4b386f21f7aa7172f0994ee6e4dd966539484247ea71c99b81b8e09b1bb2acbc0026a43c221fd773471dc30d6a32b04692e6837ddaccf0830a63128308e4ee0',
    } as MintRequest;
    const sig = mintRequest.signature!;
    const quote = mintRequest.quote;
    const pubkey = '03d56ce4e446a85bbdaa547b4ec2b073d40ff802831352b8272b7dd7a4de5a7cac';
    const blindedMessages = mintRequest.outputs;
    expect(verifyMintQuoteSignature(pubkey, quote, blindedMessages, sig)).toBe(true);
  });
  test('invalid signature verification', () => {
    let mintRequest = {
      quote: '9d745270-1405-46de-b5c5-e2762b4f5e00',
      outputs: [
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '0342e5bcc77f5b2a3c2afb40bb591a1e27da83cddc968abdc0ec4904201a201834',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '032fd3c4dc49a2844a89998d5e9d5b0f0b00dde9310063acb8a92e2fdafa4126d4',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '033b6fde50b6a0dfe61ad148fff167ad9cf8308ded5f6f6b2fe000a036c464c311',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02be5a55f03e5c0aaea77595d574bce92c6d57a2a0fb2b5955c0b87e4520e06b53',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02209fc2873f28521cbdde7f7b3bb1521002463f5979686fd156f23fe6a8aa2b79',
        },
      ],
      signature:
        'cb2b8e7ea69362dfe2a07093f2bbc319226db33db2ef686c940b5ec976bcbfc78df0cd35b3e998adf437b09ee2c950bd66dfe9eb64abd706e43ebc7c669c36c3',
    } as MintRequest;
    const sig = mintRequest.signature!;
    const quote = mintRequest.quote;
    const pubkey = '03d56ce4e446a85bbdaa547b4ec2b073d40ff802831352b8272b7dd7a4de5a7cac';
    const blindedMessages = mintRequest.outputs;
    expect(verifyMintQuoteSignature(pubkey, quote, blindedMessages, sig)).toBe(false);
  });
  test('signature creation', () => {
    let mintRequest = {
      quote: '9d745270-1405-46de-b5c5-e2762b4f5e00',
      outputs: [
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '0342e5bcc77f5b2a3c2afb40bb591a1e27da83cddc968abdc0ec4904201a201834',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '032fd3c4dc49a2844a89998d5e9d5b0f0b00dde9310063acb8a92e2fdafa4126d4',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '033b6fde50b6a0dfe61ad148fff167ad9cf8308ded5f6f6b2fe000a036c464c311',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02be5a55f03e5c0aaea77595d574bce92c6d57a2a0fb2b5955c0b87e4520e06b53',
        },
        {
          amount: Amount.from(1),
          id: '00456a94ab4e1c46',
          B_: '02209fc2873f28521cbdde7f7b3bb1521002463f5979686fd156f23fe6a8aa2b79',
        },
      ],
    } as MintRequest;
    const quote = mintRequest.quote;
    const privkey = 'd56ce4e446a85bbdaa547b4ec2b073d40ff802831352b8272b7dd7a4de5a7cac';
    const pubkey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey)));
    const blindedMessages = mintRequest.outputs;
    const signature = signMintQuote(privkey, quote, blindedMessages);
    expect(verifyMintQuoteSignature(pubkey, quote, blindedMessages, signature)).toBe(true);
  });
});

/**
 * Amended mint-quote signature message (cashubtc/nuts#375), shared by NUT-20 single and NUT-29
 * batch minting. Wallet-internal on v4. Test vector from nuts/tests/29-tests.md (sk = 1).
 */
describe('mint quote signatures (amended message)', () => {
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
      verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', allOutputs, expectedSignature),
    ).toBe(true);
    // The amended vector does not verify against the legacy message.
    expect(verifyMintQuoteSignature(pubkey, 'locked-quote', allOutputs, expectedSignature)).toBe(
      false,
    );
  });

  test('signMintQuoteAmended over all outputs produces a valid signature', () => {
    const signature = signMintQuoteAmended(privkey, 'locked-quote', allOutputs);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', allOutputs, signature)).toBe(
      true,
    );
  });

  test('signature over per-quote subset is invalid against full output set', () => {
    const perQuoteSig = signMintQuoteAmended(privkey, 'locked-quote', [allOutputs[0]]);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', allOutputs, perQuoteSig)).toBe(
      false,
    );
  });

  test('signature is bound to output amounts', () => {
    const signature = signMintQuoteAmended(privkey, 'locked-quote', allOutputs);
    const reValued = [{ ...allOutputs[0], amount: Amount.from(2) }, allOutputs[1]];
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', reValued, signature)).toBe(
      false,
    );
  });

  test('normalizes a raw JSON number amount (Amount instances pass through)', () => {
    // A server may pass outputs straight from JSON.parse, where amount is a primitive number.
    const numberOutputs = allOutputs.map((o) => ({ ...o, amount: o.amount.toNumber() }));
    const cast = numberOutputs as unknown as typeof allOutputs;
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', cast, expectedSignature)).toBe(
      true,
    );
    const sig = signMintQuoteAmended(privkey, 'locked-quote', cast);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', allOutputs, sig)).toBe(true);
  });

  test('signature is bound to output order', () => {
    const signature = signMintQuoteAmended(privkey, 'locked-quote', allOutputs);
    const reordered = [allOutputs[1], allOutputs[0]];
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', reordered, signature)).toBe(
      false,
    );
  });

  test('encodes amounts canonically (0 -> empty, even-length hex unpadded)', () => {
    const outputs = [
      { ...allOutputs[0], amount: Amount.from(0) },
      { ...allOutputs[1], amount: Amount.from(16) },
    ];
    const signature = signMintQuoteAmended(privkey, 'locked-quote', outputs);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', outputs, signature)).toBe(true);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'locked-quote', allOutputs, signature)).toBe(
      false,
    );
  });

  test('rejects pubkeys that are not 33-byte compressed', () => {
    const xOnly = pubkey.slice(2);
    expect(
      verifyMintQuoteSignatureAmended(xOnly, 'locked-quote', allOutputs, expectedSignature),
    ).toBe(false);
    const legacySig = signMintQuote(privkey, 'locked-quote', allOutputs);
    expect(verifyMintQuoteSignature(xOnly, 'locked-quote', allOutputs, legacySig)).toBe(false);
  });

  test('each quote in a batch signs over the same output set, bound to its quote ID', () => {
    const sigQuote1 = signMintQuoteAmended(privkey, 'quote-1', allOutputs);
    const sigQuote2 = signMintQuoteAmended(privkey, 'quote-2', allOutputs);

    expect(verifyMintQuoteSignatureAmended(pubkey, 'quote-1', allOutputs, sigQuote1)).toBe(true);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'quote-2', allOutputs, sigQuote2)).toBe(true);

    // Each signature is bound to its quote ID
    expect(verifyMintQuoteSignatureAmended(pubkey, 'quote-1', allOutputs, sigQuote2)).toBe(false);
    expect(verifyMintQuoteSignatureAmended(pubkey, 'quote-2', allOutputs, sigQuote1)).toBe(false);
  });
});
