import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { test, describe, expect } from 'vitest';

import { Amount, type MintRequest } from '../../src';
import { signMintQuote, verifyMintQuoteSignature } from '../../src/crypto';
import { signMintQuoteLegacy, verifyMintQuoteSignatureLegacy } from '../../src/crypto/NUT20';

/**
 * Amended mint-quote signature message (cashubtc/nuts#375), shared by NUT-20 single and NUT-29
 * batch minting. Test vector from nuts/tests/29-tests.md (sk = 1).
 */
describe('mint quote signatures (amended message)', () => {
  const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
  const keysetId = '010000000000000000000000000000000000000000000000000000000000000000';
  const quote = '019e6d5a-2347-7000-8c81-a1e0dbf3299f';

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
    '43617368755f4d696e7451756f74655369675f76310000002430313965366435612d323334372d373030302d386338312d613165306462663332393966' +
    '000000010100000021036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2' +
    '000000010100000021021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59';
  const expectedMsgHash = 'dad25acc587637206d73398894d337f983a0ca644746e8673727eaa0b29fa9b4';
  const expectedSignature =
    '0c39431338a0202568b9a1d4215c99f179cbb8ee5472ac5ae7133fbb8f99cafbb9e425ad33c60224c96b8f9f984f004379a18e9558468d129b6b03f0da6de162';

  test('canonical msg_to_sign hashes to the test vector', () => {
    expect(bytesToHex(sha256(hexToBytes(expectedMsgToSign)))).toBe(expectedMsgHash);
  });

  test('test vector signature verifies correctly', () => {
    expect(verifyMintQuoteSignature(pubkey, quote, allOutputs, expectedSignature)).toBe(true);
  });

  test('signMintQuote over all outputs produces a valid signature', () => {
    const signature = signMintQuote(privkey, quote, allOutputs);
    expect(verifyMintQuoteSignature(pubkey, quote, allOutputs, signature)).toBe(true);
  });

  test('signature over per-quote subset is invalid against full output set', () => {
    const perQuoteSig = signMintQuote(privkey, quote, [allOutputs[0]]);
    expect(verifyMintQuoteSignature(pubkey, quote, allOutputs, perQuoteSig)).toBe(false);
  });

  test('signature is bound to output amounts', () => {
    const signature = signMintQuote(privkey, quote, allOutputs);
    const reValued = [{ ...allOutputs[0], amount: Amount.from(2) }, allOutputs[1]];
    expect(verifyMintQuoteSignature(pubkey, quote, reValued, signature)).toBe(false);
  });

  test('normalizes a raw JSON number amount (Amount instances pass through)', () => {
    // A server may pass outputs straight from JSON.parse, where amount is a primitive number.
    const numberOutputs = allOutputs.map((o) => ({ ...o, amount: o.amount.toNumber() }));
    const cast = numberOutputs as unknown as typeof allOutputs;
    expect(verifyMintQuoteSignature(pubkey, quote, cast, expectedSignature)).toBe(true);
    const sig = signMintQuote(privkey, quote, cast);
    expect(verifyMintQuoteSignature(pubkey, quote, allOutputs, sig)).toBe(true);
  });

  test('signature is bound to output order', () => {
    const signature = signMintQuote(privkey, quote, allOutputs);
    const reordered = [allOutputs[1], allOutputs[0]];
    expect(verifyMintQuoteSignature(pubkey, quote, reordered, signature)).toBe(false);
  });

  test('encodes amounts canonically (0 -> empty, even-length hex unpadded)', () => {
    const outputs = [
      { ...allOutputs[0], amount: Amount.from(0) },
      { ...allOutputs[1], amount: Amount.from(16) },
    ];
    const signature = signMintQuote(privkey, quote, outputs);
    expect(verifyMintQuoteSignature(pubkey, quote, outputs, signature)).toBe(true);
    expect(verifyMintQuoteSignature(pubkey, quote, allOutputs, signature)).toBe(false);
  });

  test('rejects pubkeys that are not 33-byte compressed', () => {
    const xOnly = pubkey.slice(2);
    expect(verifyMintQuoteSignature(xOnly, quote, allOutputs, expectedSignature)).toBe(false);
    const legacySig = signMintQuoteLegacy(privkey, quote, allOutputs);
    expect(verifyMintQuoteSignatureLegacy(xOnly, quote, allOutputs, legacySig)).toBe(false);
  });

  test('each quote in a batch signs over the same output set, bound to its quote ID', () => {
    const sigQuote1 = signMintQuote(privkey, 'quote-1', allOutputs);
    const sigQuote2 = signMintQuote(privkey, 'quote-2', allOutputs);

    expect(verifyMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote1)).toBe(true);
    expect(verifyMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote2)).toBe(true);

    // Each signature is bound to its quote ID
    expect(verifyMintQuoteSignature(pubkey, 'quote-1', allOutputs, sigQuote2)).toBe(false);
    expect(verifyMintQuoteSignature(pubkey, 'quote-2', allOutputs, sigQuote1)).toBe(false);
  });

  // Canonical NUT-20 single-mint vector from nuts/tests/20-test.md (sk = 1, UUIDv7 quote id).
  describe('NUT-20 single-mint spec vector', () => {
    const quote = '0192d3c0-7e8a-7c3d-8e9f-1a2b3c4d5e6f';
    const outputs = [
      {
        amount: Amount.from(1),
        id: '009a1f293253e41e',
        B_: '036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2',
      },
      {
        amount: Amount.from(1),
        id: '009a1f293253e41e',
        B_: '021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59',
      },
    ];
    const expectedMsgToSign =
      '43617368755f4d696e7451756f74655369675f7631000000243031393264336330' +
      '2d376538612d376333642d386539662d316132623363346435653666' +
      '000000010100000021036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2' +
      '000000010100000021021f8a566c205633d029094747d2e18f44e05993dda7a5f88f496078205f656e59';
    const expectedMsgHash = 'c164fd384879f74ab6ea2e7cf13d90ed42e6df9d5de607eeb5c9cc7d36fb1c21';
    const expectedSignature =
      '4881093a332ff7c79f3e598ce5b249d64978b47165a0b19c18adf0ced0246228e61e702f0abaf1bf27b92be4336bdbabacfbe4c914076386b3c66fdcd0b3480e';

    test('canonical msg_to_sign hashes to the test vector', () => {
      expect(bytesToHex(sha256(hexToBytes(expectedMsgToSign)))).toBe(expectedMsgHash);
    });

    test('test vector signature verifies correctly', () => {
      expect(verifyMintQuoteSignature(pubkey, quote, outputs, expectedSignature)).toBe(true);
    });
  });
});

describe('mint quote signatures (legacy message)', () => {
  test('valid signature verification', () => {
    const mintRequest = {
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
    expect(verifyMintQuoteSignatureLegacy(pubkey, quote, blindedMessages, sig)).toBe(true);
    // The legacy vector does not verify against the amended message.
    expect(verifyMintQuoteSignature(pubkey, quote, blindedMessages, sig)).toBe(false);
  });
  test('invalid signature verification', () => {
    const mintRequest = {
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
    expect(verifyMintQuoteSignatureLegacy(pubkey, quote, blindedMessages, sig)).toBe(false);
  });
  test('signature creation', () => {
    const mintRequest = {
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
    const signature = signMintQuoteLegacy(privkey, quote, blindedMessages);
    expect(verifyMintQuoteSignatureLegacy(pubkey, quote, blindedMessages, signature)).toBe(true);
  });
});

describe('mint quote signature verification rejects malformed input (no throw)', () => {
  const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const keysetId = '010000000000000000000000000000000000000000000000000000000000000000';
  const sig =
    'a913e48177027d87e0e38c6f2021763c46997ff4866a4b63ebca800b0776b28519eab37377cf9bc1869e489d7b25747b7a998eaa1c33c2cac7fa168449d8267a';
  const goodB_ = '036d6caac248af96f6afa7f904f550253a0f3ef3f5aa2fe6838a95b216691468e2';

  // A server may pass outputs straight from JSON.parse; an attacker controls amount and B_.
  const withOutputs = (outputs: unknown) =>
    outputs as Array<{ amount: Amount; id: string; B_: string }>;

  test('amended: negative amount verifies as false', () => {
    const outputs = withOutputs([{ amount: -1, id: keysetId, B_: goodB_ }]);
    expect(verifyMintQuoteSignature(pubkey, 'q', outputs, sig)).toBe(false);
  });

  test('amended: invalid hex B_ verifies as false', () => {
    const outputs = withOutputs([{ amount: 1, id: keysetId, B_: 'invalidhex' }]);
    expect(verifyMintQuoteSignature(pubkey, 'q', outputs, sig)).toBe(false);
  });

  test('legacy: non-string quote with no outputs verifies as false', () => {
    // message stays a non-string and utf8ToBytes would throw without the guard.
    const quote = 256 as unknown as string;
    expect(verifyMintQuoteSignatureLegacy(pubkey, quote, [], sig)).toBe(false);
  });
});
