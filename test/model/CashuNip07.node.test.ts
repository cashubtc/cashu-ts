import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, test } from 'vitest';

import {
  computeMessageDigest,
  schnorrSignDigest,
  schnorrVerifyMessage,
} from '../../src/crypto/core';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { createP2PKsecret } from '../../src/crypto/NUT11';
import type { NutrootLeaf } from '../../src/crypto/nutroot';
import { inputsForPayload, proofInputContextKey } from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import { CashuNip07, type Nip07Like } from '../../src/model/CashuNip07';
import type { Proof } from '../../src/model/types';
import { bytesToHex, hexToBytes } from '../../src/utils';
import type { SpendOption } from '../../src/wallet/types';
import vectors from '../vectors/nutroot-v3.json';

const KEYSET = vectors.nut13_v3.keyset_id;
const PRIV = '11'.repeat(32);
const PUB = bytesToHex(getPubKeyFromPrivKey(hexToBytes(PRIV)));
const XONLY = PUB.slice(2);
const OTHER = bytesToHex(getPubKeyFromPrivKey(hexToBytes('22'.repeat(32))));

const LEAF: NutrootLeaf = { type: 'threshold', n: 1, keys: [PUB] };
const SECRET = `02${'33'.repeat(32)}`;
const inputs = inputsForPayload({
  inputs: [{ amount: 1, id: KEYSET, secret: SECRET, C: 'aa'.repeat(48) }],
  outputs: [{ amount: 1, id: KEYSET, B_: 'bb'.repeat(48) }],
});
const MESSAGE = inputs.message;
const { container: CONTAINER, digest: DIGEST } = inputs.proofs.get(
  proofInputContextKey({ keysetId: KEYSET, secret: SECRET }),
)!;

// An extension that implements the safe method through the reference signer.
const safeSigner: Nip07Like = {
  getPublicKey: async () => XONLY,
  nip60: { signTransaction: async (m, c) => CashuNip07.signTransaction(m, c, PRIV) },
};
// Alby-style: raw digest signing only.
const rawSigner: Nip07Like = {
  getPublicKey: async () => XONLY,
  signSchnorr: async (h) => schnorrSignDigest(h, PRIV),
};
// nos2x-style: nip60.signSecret only.
const signSecret = async (secret: string) => {
  const hash = computeMessageDigest(secret, true);
  return { hash, sig: schnorrSignDigest(hash, PRIV), pubkey: XONLY };
};
const secretSigner: Nip07Like = { getPublicKey: async () => XONLY, nip60: { signSecret } };

const p2pkProof = (secret: string, witness?: Proof['witness']): Proof => ({
  id: `00${'11'.repeat(3)}`,
  amount: Amount.from(1),
  secret,
  C: `02${'44'.repeat(32)}`,
  ...(witness && { witness }),
});
const signaturesOf = (proof: Proof) =>
  (proof.witness as { signatures?: string[] } | undefined)?.signatures ?? [];

const option = (over: Partial<SpendOption>): SpendOption => ({
  leafIndex: 0,
  leaf: LEAF,
  keys: [],
  satisfiable: false,
  blockedBy: 'threshold',
  ...over,
});

describe('CashuNip07', () => {
  test('pubkey is the 02-prefixed form leaves list', async () => {
    expect(await CashuNip07.pubkey(safeSigner)).toBe(`02${XONLY}`);
    await expect(CashuNip07.pubkey({})).rejects.toThrow('getPublicKey');
    await expect(CashuNip07.pubkey({ getPublicKey: async () => 'not-hex' })).rejects.toThrow(
      /32-byte hex/,
    );
    await expect(CashuNip07.pubkey({ getPublicKey: async () => 'ff'.repeat(32) })).rejects.toThrow(
      /not a valid secp256k1 point/,
    );
  });

  test('canSign needs signTransaction or signSchnorr', () => {
    expect(CashuNip07.canSign(safeSigner)).toBe(true);
    expect(CashuNip07.canSign(rawSigner)).toBe(true);
    expect(CashuNip07.canSign({ getPublicKey: async () => XONLY })).toBe(false);
  });

  test('cosign prefers signTransaction and verifies over the digest', async () => {
    const [sig] = await CashuNip07.cosign(safeSigner)({
      digest: DIGEST,
      leaf: LEAF,
      message: MESSAGE,
      container: CONTAINER,
    });
    expect(schnorr.verify(hexToBytes(sig), DIGEST, hexToBytes(XONLY))).toBe(true);
  });

  test('cosign falls back to signSchnorr, and refuses with neither', async () => {
    const [sig] = await CashuNip07.cosign(rawSigner)({
      digest: DIGEST,
      leaf: LEAF,
      message: MESSAGE,
      container: CONTAINER,
    });
    expect(schnorr.verify(hexToBytes(sig), DIGEST, hexToBytes(XONLY))).toBe(true);
    await expect(
      CashuNip07.cosign({})({ digest: DIGEST, leaf: LEAF, message: MESSAGE, container: CONTAINER }),
    ).rejects.toThrow('cannot sign');
  });

  test('cosign rejects a signer that hashed something else', async () => {
    const liar: Nip07Like = {
      nip60: { signTransaction: async () => ({ hash: '00'.repeat(32), sig: '', pubkey: XONLY }) },
    };
    await expect(
      CashuNip07.cosign(liar)({
        digest: DIGEST,
        leaf: LEAF,
        message: MESSAGE,
        container: CONTAINER,
      }),
    ).rejects.toThrow('different message');
  });

  test('signTransaction refuses anything without the domain tag or a foreign container', () => {
    const inputContainerHex = bytesToHex(CONTAINER);
    // An event id, or any other 32 bytes, must never come out signed.
    expect(() => CashuNip07.signTransaction('00'.repeat(32), inputContainerHex, PRIV)).toThrow(
      'not a Cashu transaction',
    );
    expect(() =>
      CashuNip07.signTransaction(bytesToHex(MESSAGE.subarray(1)), inputContainerHex, PRIV),
    ).toThrow();
    // A container the message does not carry signs nothing: the derived digest would cover an
    // input of some other transaction.
    expect(() => CashuNip07.signTransaction(bytesToHex(MESSAGE), '01000411223344', PRIV)).toThrow(
      'not part of this transaction',
    );
    const signed = CashuNip07.signTransaction(bytesToHex(MESSAGE), inputContainerHex, PRIV);
    expect(signed.hash).toBe(bytesToHex(DIGEST));
    expect(signed.pubkey).toBe(XONLY);
    // A byte key signs the same as its hex form.
    const bytesKey = CashuNip07.signTransaction(
      bytesToHex(MESSAGE),
      inputContainerHex,
      hexToBytes(PRIV),
    );
    expect(schnorr.verify(hexToBytes(bytesKey.sig), DIGEST, hexToBytes(XONLY))).toBe(true);
  });

  test('completes: listed, not held, one short of n, and only then', () => {
    expect(CashuNip07.completes(option({}), PUB)).toBe(true);
    expect(CashuNip07.completes(option({}), XONLY)).toBe(true); // x-only accepted
    expect(CashuNip07.completes(option({}), `02${XONLY}`)).toBe(true); // either parity prefix
    expect(CashuNip07.completes(option({}), OTHER)).toBe(false); // not listed
    expect(CashuNip07.completes(option({ satisfiable: true, blockedBy: undefined }), PUB)).toBe(
      false,
    );
    expect(CashuNip07.completes(option({ blockedBy: 'locktime' }), PUB)).toBe(false);
    expect(
      CashuNip07.completes(option({ keys: [{ keyIndex: 0, pubkey: PUB, blinded: false }] }), PUB),
    ).toBe(false); // already held
    const twoOfThree: NutrootLeaf = {
      type: 'threshold',
      n: 2,
      keys: [PUB, OTHER, `02${'44'.repeat(32)}`],
    };
    expect(CashuNip07.completes(option({ leaf: twoOfThree }), PUB)).toBe(false); // two short
    expect(
      CashuNip07.completes(
        option({ leaf: twoOfThree, keys: [{ keyIndex: 1, pubkey: OTHER, blinded: false }] }),
        PUB,
      ),
    ).toBe(true);
  });

  test('signP2PK signs a NUT-11 secret through signSecret, signString or signSchnorr', async () => {
    const proof = p2pkProof(createP2PKsecret(PUB));
    for (const nostr of [
      secretSigner,
      { getPublicKey: async () => XONLY, signString: signSecret },
      rawSigner,
    ]) {
      const [signed] = await CashuNip07.signP2PK(nostr, [proof]);
      expect(signaturesOf(signed)).toHaveLength(1);
      expect(schnorrVerifyMessage(signaturesOf(signed)[0], proof.secret, PUB)).toBe(true);
    }
    expect(CashuNip07.canSignP2PK(secretSigner)).toBe(true);
    expect(CashuNip07.canSignP2PK({ getPublicKey: async () => XONLY })).toBe(false);
  });

  test('signP2PK leaves alone what it should not touch', async () => {
    const mine = p2pkProof(createP2PKsecret(PUB));
    const [once] = await CashuNip07.signP2PK(secretSigner, [mine]);
    const [twice] = await CashuNip07.signP2PK(secretSigner, [once]); // already signed
    expect(signaturesOf(twice)).toHaveLength(1);
    const untouched = [
      p2pkProof(createP2PKsecret(OTHER)), // not my key
      p2pkProof(createP2PKsecret(PUB, [['sigflag', 'SIG_ALL']])), // transaction message
      p2pkProof('plain-secret'), // no conditions
      p2pkProof(`02${'33'.repeat(32)}`), // v3 point secret
    ];
    const out = await CashuNip07.signP2PK(secretSigner, untouched);
    expect(out).toEqual(untouched);
    await expect(CashuNip07.signP2PK({ getPublicKey: async () => XONLY }, [mine])).rejects.toThrow(
      'cannot sign',
    );
  });

  test('signP2PK rejects a signer that hashed something else or signed with another key', async () => {
    const proof = p2pkProof(createP2PKsecret(PUB));
    const wrongHash: Nip07Like = {
      getPublicKey: async () => XONLY,
      nip60: { signSecret: async (s) => ({ ...(await signSecret(s)), hash: '00'.repeat(32) }) },
    };
    await expect(CashuNip07.signP2PK(wrongHash, [proof])).rejects.toThrow('different secret');
    const badSig: Nip07Like = {
      getPublicKey: async () => XONLY,
      signSchnorr: async () => '00'.repeat(64),
    };
    await expect(CashuNip07.signP2PK(badSig, [proof])).rejects.toThrow('does not verify');
  });

  test('nip60Keys reads privkey and mint tags from the decrypted content', async () => {
    const nostr: Nip07Like = {
      nip44: {
        decrypt: async (pubkey, content) =>
          pubkey === XONLY && content === 'ct'
            ? JSON.stringify([['privkey', PRIV], ['mint', 'https://m'], ['other', 'x'], 'junk'])
            : 'nope',
      },
    };
    expect(await CashuNip07.nip60Keys(nostr, XONLY, 'ct')).toEqual({
      privkeys: [PRIV],
      mints: ['https://m'],
    });
    await expect(CashuNip07.nip60Keys(nostr, XONLY, 'bad')).rejects.toThrow('JSON');
    const object: Nip07Like = { nip44: { decrypt: async () => '{"privkey":"x"}' } };
    await expect(CashuNip07.nip60Keys(object, XONLY, 'ct')).rejects.toThrow('tag list');
    await expect(CashuNip07.nip60Keys({}, XONLY, 'ct')).rejects.toThrow('nip44');
  });
});
