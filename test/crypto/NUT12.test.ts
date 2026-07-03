import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import {
  createBlindSignature,
  hash_e,
  pointFromBytes,
  pointFromHex,
  createDLEQProof,
  verifyDLEQProof,
  verifyDLEQProof_reblind,
  constructUnblindedSignature,
  createRandomRawBlindedMessage,
} from '../../src/crypto';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';

describe('test hash_e', () => {
  test('test hash_e function', async () => {
    const C_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
    const K = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
    const R1 = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
    const R2 = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
    const e = hash_e([R1, R2, K, C_]);
    console.log('e = ' + bytesToHex(e));
    expect(bytesToHex(e)).toEqual(
      'a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e',
    );
  });
});

describe('test DLEQ scheme', () => {
  test('test DLEQ scheme: Alice verifies', async () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));

    // Wallet(Alice)
    const blindMessage = createRandomRawBlindedMessage();

    // Mint
    const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');
    const dleqProof = createDLEQProof(blindMessage.B_, mintPrivKey);

    // Wallet(Alice)
    const isValid = verifyDLEQProof(dleqProof, blindMessage.B_, blindSignature.C_, mintPubKey);
    expect(isValid).toBe(true);
  });
  test('test DLEQ scheme: Carol verifies', async () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));

    // Wallet(Alice)
    const blindMessage = createRandomRawBlindedMessage();

    // Mint
    const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');
    const dleqProof = createDLEQProof(blindMessage.B_, mintPrivKey);

    // Wallet(Alice)
    const proof = constructUnblindedSignature(
      blindSignature,
      blindMessage.r,
      blindMessage.secret,
      mintPubKey,
    );
    dleqProof.r = blindMessage.r;

    // Wallet(Carol)
    const isValid = verifyDLEQProof_reblind(blindMessage.secret, dleqProof, proof.C, mintPubKey);
    expect(isValid).toBe(true);
  });
});

describe('verifyDLEQProof rejects tampered proofs', () => {
  // Fixed vector: A = aG for a = 2, matching the (B_, C_) pair used elsewhere.
  const a = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
  const B_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
  const A = pointFromHex('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
  const C_ = pointFromHex('0244eccfc7a348274458bb38044c7f3c389b3c2086c7ec18b5812d2877ab937787');

  // Flip the low byte so the scalar stays well below the curve order n.
  const flipLow = (b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(b);
    out[out.length - 1] ^= 0x01;
    return out;
  };

  test('valid proof verifies true (baseline)', () => {
    const proof = createDLEQProof(B_, a);
    expect(verifyDLEQProof(proof, B_, C_, A)).toBe(true);
  });

  test('tampered e verifies false', () => {
    const proof = createDLEQProof(B_, a);
    const bad = { s: proof.s, e: flipLow(proof.e) };
    expect(verifyDLEQProof(bad, B_, C_, A)).toBe(false);
  });

  test('tampered s verifies false', () => {
    const proof = createDLEQProof(B_, a);
    const bad = { s: flipLow(proof.s), e: proof.e };
    expect(verifyDLEQProof(bad, B_, C_, A)).toBe(false);
  });

  test('wrong mint key A verifies false', () => {
    const proof = createDLEQProof(B_, a);
    const wrongA = pointFromBytes(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true));
    expect(verifyDLEQProof(proof, B_, C_, wrongA)).toBe(false);
  });

  test('wrong blinded message B_ verifies false', () => {
    const proof = createDLEQProof(B_, a);
    const wrongB_ = createRandomRawBlindedMessage().B_;
    expect(verifyDLEQProof(proof, wrongB_, C_, A)).toBe(false);
  });

  test('wrong blind signature C_ verifies false', () => {
    const proof = createDLEQProof(B_, a);
    const wrongC_ = createRandomRawBlindedMessage().B_;
    expect(verifyDLEQProof(proof, B_, wrongC_, A)).toBe(false);
  });
});

describe('verifyDLEQProof_reblind blinding factor guard', () => {
  test('throws when blinding factor r is undefined', () => {
    // createDLEQProof returns { s, e } with no r; the reblind path requires it.
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));
    const blindMsg = createRandomRawBlindedMessage();
    const blindSig = createBlindSignature(blindMsg.B_, mintPrivKey, '');
    const proof = constructUnblindedSignature(blindSig, blindMsg.r, blindMsg.secret, mintPubKey);
    const dleq = createDLEQProof(blindMsg.B_, mintPrivKey);
    expect(dleq.r).toBeUndefined();
    expect(() => verifyDLEQProof_reblind(blindMsg.secret, dleq, proof.C, mintPubKey)).toThrow(
      'verifyDLEQProof_reblind: Undefined blinding factor',
    );
  });

  test('wrong blinding factor r verifies false', () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));
    const blindMsg = createRandomRawBlindedMessage();
    const blindSig = createBlindSignature(blindMsg.B_, mintPrivKey, '');
    const proof = constructUnblindedSignature(blindSig, blindMsg.r, blindMsg.secret, mintPubKey);
    const dleq = createDLEQProof(blindMsg.B_, mintPrivKey);
    dleq.r = createRandomRawBlindedMessage().r; // a blinding factor from an unrelated message
    expect(verifyDLEQProof_reblind(blindMsg.secret, dleq, proof.C, mintPubKey)).toBe(false);
  });
});

describe('deterministic nonce derivation — spec test vectors', () => {
  test('reproduces exact (e, s) for known (a, B_)', () => {
    const a = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
    const B_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
    const proof = createDLEQProof(B_, a);
    expect(bytesToHex(proof.e)).toBe(
      '2a16ffee280aff3c429045607f9b8e0bf8b35910c44c1b20b9dfaf01b263d7b3',
    );
    expect(bytesToHex(proof.s)).toBe(
      '9df27731238334718d120d4f74611a7c668233f988e687ac3fb188f0a34a2dab',
    );
  });

  test('proof verifies for known vector', () => {
    const a = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
    const B_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
    const A = pointFromHex('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
    const C_ = pointFromHex('0244eccfc7a348274458bb38044c7f3c389b3c2086c7ec18b5812d2877ab937787');
    const proof = createDLEQProof(B_, a);
    expect(verifyDLEQProof(proof, B_, C_, A)).toBe(true);
  });
});

describe('deterministic nonce derivation', () => {
  test('same key + same B_ always produces identical (e, s)', () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const blindMsg = createRandomRawBlindedMessage();

    const proof1 = createDLEQProof(blindMsg.B_, mintPrivKey);
    const proof2 = createDLEQProof(blindMsg.B_, mintPrivKey);

    expect(bytesToHex(proof1.e)).toBe(bytesToHex(proof2.e));
    expect(bytesToHex(proof1.s)).toBe(bytesToHex(proof2.s));
  });

  test('different B_ produces different (e, s)', () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const blindMsg1 = createRandomRawBlindedMessage();
    const blindMsg2 = createRandomRawBlindedMessage();

    const proof1 = createDLEQProof(blindMsg1.B_, mintPrivKey);
    const proof2 = createDLEQProof(blindMsg2.B_, mintPrivKey);

    expect(bytesToHex(proof1.e)).not.toBe(bytesToHex(proof2.e));
  });

  test('different key produces different (e, s) for same B_', () => {
    const key1 = secp256k1.utils.randomSecretKey();
    const key2 = secp256k1.utils.randomSecretKey();
    const blindMsg = createRandomRawBlindedMessage();

    const proof1 = createDLEQProof(blindMsg.B_, key1);
    const proof2 = createDLEQProof(blindMsg.B_, key2);

    expect(bytesToHex(proof1.e)).not.toBe(bytesToHex(proof2.e));
  });
});

describe('OutputData.toProof DLEQ verification', () => {
  function mintSetup() {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));
    const blindMsg = createRandomRawBlindedMessage();
    const blindSig = createBlindSignature(blindMsg.B_, mintPrivKey, 'test-keyset');
    const dleq = createDLEQProof(blindMsg.B_, mintPrivKey);
    const keyset = {
      id: 'test-keyset',
      keys: { '1': mintPubKey.toHex(true) },
    };
    const od = new OutputData(
      { amount: Amount.from(1), B_: blindMsg.B_.toHex(true), id: 'test-keyset' },
      blindMsg.r,
      blindMsg.secret,
    );
    return { mintPrivKey, mintPubKey, blindMsg, blindSig, dleq, keyset, od };
  }

  test('toProof succeeds with valid DLEQ', () => {
    const { blindSig, dleq, keyset, od } = mintSetup();
    const sig = {
      id: 'test-keyset',
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
    };
    const proof = od.toProof(sig, keyset);
    expect(proof.amount.equals(Amount.from(1))).toBe(true);
    expect(proof.dleq).toBeDefined();
  });

  test('toProof throws on invalid DLEQ', () => {
    const { blindSig, dleq, keyset, od } = mintSetup();
    // Corrupt the DLEQ 'e' value
    const badE = new Uint8Array(dleq.e);
    badE[0] ^= 0xff;
    const sig = {
      id: 'test-keyset',
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(badE) },
    };
    expect(() => od.toProof(sig, keyset)).toThrow('DLEQ verification failed');
  });

  test('toProof throws on undefined signature', () => {
    const { keyset, od } = mintSetup();
    expect(() => od.toProof(undefined as never, keyset)).toThrow(
      'Mint response is missing a signature for one of the outputs',
    );
  });

  test('toProof preserves p2pk_e from OutputData instance', () => {
    const { blindSig, keyset, od } = mintSetup();
    const p2pkE = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
    const p2pkOutput = new OutputData(
      od.blindedMessage,
      od.blindingFactor,
      od.secret,
      bytesToHex(p2pkE),
    );
    const sig = {
      id: 'test-keyset',
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
    };

    const proof = p2pkOutput.toProof(sig, keyset);
    const proofAgain = p2pkOutput.toProof(sig, keyset);

    expect(proof.p2pk_e).toBe(bytesToHex(p2pkE));
    expect(proofAgain.p2pk_e).toBe(bytesToHex(p2pkE));
  });

  test('toProof rejects amount downgrade on secp (malicious mint)', () => {
    // Wallet requested amount=8 but the mint returns sig.amount=1. Even with a valid C_
    // and DLEQ for amount=1, the request/response mismatch alone must cause toProof to
    // throw — funds-loss prevention upstream of key lookup.
    const { blindSig, dleq, keyset, od } = mintSetup();
    const downgradedOd = new OutputData(
      { amount: Amount.from(8), B_: od.blindedMessage.B_, id: od.blindedMessage.id },
      od.blindingFactor,
      od.secret,
    );
    const sig = {
      id: 'test-keyset',
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
    };
    expect(() => downgradedOd.toProof(sig, keyset)).toThrow(/does not match requested amount/);
  });

  test('toProof accepts amount=0 blank on secp (NUT-08 / NUT-09)', () => {
    // Blank outputs (melt change, restore) declare amount=0; the mint fills in the
    // actual denomination. toProof must succeed and carry sig.amount onto the Proof.
    const { blindSig, dleq, keyset, od } = mintSetup();
    const blank = new OutputData(
      { amount: Amount.from(0), B_: od.blindedMessage.B_, id: od.blindedMessage.id },
      od.blindingFactor,
      od.secret,
    );
    const sig = {
      id: 'test-keyset',
      amount: Amount.from(1),
      C_: blindSig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
    };
    const proof = blank.toProof(sig, keyset);
    expect(proof.amount.equals(Amount.from(1))).toBe(true);
  });
});
