import { test, describe, expect } from 'vitest';
import { signMintQuote, verifyMintQuoteSignature } from '../../src/crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Amount, MintRequest } from '../../src';

/**
 * NUT-20 test vectors for batch mint signatures.
 */
describe('mint quote signatures', () => {
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
        '567238205b7f431c7249645715288557617e47f1e347ce598c845588e104a5f23df0fad34f4736668c5da6a8be8346db5f5b84ed071dcf75772ebe02053e9a53',
    } as MintRequest;
    const sig = mintRequest.signature!;
    const quote = mintRequest.quote;
    const pubkey = '03e8c0ef99aa610787b91a5aa522cbc569646630bfdb575718bf2f022e1341615c';
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
        '577238205b7f431c7249645715288557617e47f1e347ce598c845588e104a5f23df0fad34f4736668c5da6a8be8346db5f5b84ed071dcf75772ebe02053e9a53',
    } as MintRequest;
    const sig = mintRequest.signature!;
    const quote = mintRequest.quote;
    const pubkey = '03e8c0ef99aa610787b91a5aa522cbc569646630bfdb575718bf2f022e1341615c';
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
