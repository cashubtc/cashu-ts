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
import { OutputData } from '../../src/model/OutputData';
import { Amount } from '../../src/model/Amount';

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
    let dleqProof = createDLEQProof(blindMessage.B_, mintPrivKey);

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

describe('deterministic nonce derivation — spec test vectors', () => {
  test('reproduces exact (e, s) for known (a, B_)', () => {
    const a = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
    const B_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
    const proof = createDLEQProof(B_, a);
    expect(bytesToHex(proof.e)).toBe(
      'be53688e1952a916726cf4f031584404c6a79b32ccf0b58f3db9a46794abc1dc',
    );
    expect(bytesToHex(proof.s)).toBe(
      '1d6ecdf7ca128c90f65bd64e1f894fad985be8af6b350fece5ca4e9e259a54ad',
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
});
