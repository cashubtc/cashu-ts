import { equalBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { computeMessageDigest, schnorrSignDigest, schnorrVerifyDigest } from '../crypto/core';
import { isV3PointSecret } from '../crypto/curve_bls';
import { getPubKeyFromPrivKey, normalizeSecpPubkey } from '../crypto/curve_secp';
import {
  getP2PKExpectedWitnessPubkeys,
  getP2PKSigFlag,
  hasP2PKSignedProof,
  parseWitnessData,
} from '../crypto/NUT11';
import { inputDigest, TRANSCRIPT_DOMAIN_TAG } from '../crypto/transcript';
import { bytesToHex, hexToBytes } from '../utils';
import type { ScriptPathPlan, SpendOption } from '../wallet/types';

import { CTSError } from './Errors';
import type { Proof } from './types';

/**
 * What an extension returns from `nip60.signSecret`, `signString` and `nip60.signTransaction`: the
 * hash it signed, the signature, and its x-only pubkey, all hex.
 */
export type Nip07SignedHash = { hash: string; sig: string; pubkey: string };

/**
 * The slice of a NIP-07 `window.nostr` this adapter reads. Every member is optional: extensions
 * differ, and the adapter degrades to whatever is present.
 */
export type Nip07Like = {
  getPublicKey?: () => Promise<string>;
  /**
   * Sign an arbitrary 32-byte digest, hex in and hex out. Alby ships this; most signers refuse it
   * because it also signs event ids, which is why `nip60.signTransaction` exists.
   */
  signSchnorr?: (digestHex: string) => Promise<string>;
  /**
   * Sign `sha256(secret)` for a NUT-11 proof: the older name of `nip60.signSecret`, as shipped by
   * AKA Profiles.
   */
  signString?: (secret: string) => Promise<Nip07SignedHash>;
  nip44?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> };
  nip60?: {
    /**
     * Sign `sha256(secret)` for a NUT-11 proof (NIP-60), returning the hash it signed and its key.
     */
    signSecret?: (secret: string) => Promise<Nip07SignedHash>;
    /**
     * Sign one input of a nutroot transaction (NUT-10): the signer derives the input digest from
     * the tagged transaction message and the input's own container record, so it can refuse
     * anything not carrying the `Cashu_Transaction_v1` tag. See
     * {@link CashuNip07Api.signTransaction}.
     */
    signTransaction?: (messageHex: string, inputContainerHex: string) => Promise<Nip07SignedHash>;
  };
};

export type CashuNip07Api = {
  /**
   * The extension's key as a 02-prefixed compressed pubkey, the form nutroot leaves list.
   */
  pubkey(nostr: Nip07Like): Promise<string>;
  /**
   * Whether the extension can sign a nutroot transaction at all.
   */
  canSign(nostr: Nip07Like): boolean;
  /**
   * Whether the extension can sign a NUT-11 secret at all.
   */
  canSignP2PK(nostr: Nip07Like): boolean;
  /**
   * Adds the extension's NUT-11 signature to every proof that wants one (pre-v3 keysets).
   *
   * @remarks
   * Prefers `nip60.signSecret` (or its older name `signString`), whose reply is checked against the
   * secret's hash and the extension's key, then `signSchnorr` over the hash. Skips proofs that do
   * not list the key, already carry its signature, or are `SIG_ALL` (that message covers the
   * transaction: use the SigAll package). Blinded (P2BK) keys never match. v3 proofs pass through
   * untouched.
   */
  signP2PK(nostr: Nip07Like, proofs: Proof[]): Promise<Proof[]>;
  /**
   * A {@link ScriptPathPlan.cosign} hook that signs through the extension.
   *
   * @remarks
   * Prefers `nip60.signTransaction` (the signer sees the tagged message and checks it), falling
   * back to `signSchnorr` over the digest. Throws if the extension offers neither.
   */
  cosign(nostr: Nip07Like): NonNullable<ScriptPathPlan['cosign']>;
  /**
   * Whether one signature from `pubkey` turns this leaf satisfiable: the leaf lists the key
   * verbatim (matched by x-coordinate; a blinded slot never matches), it is not already held, and
   * one more signature meets `n`.
   */
  completes(option: SpendOption, pubkey: string): boolean;
  /**
   * The private keys and mints of a NIP-60 wallet event, decrypted by the extension.
   *
   * @param pubkey The wallet owner's x-only pubkey, as `nip44.decrypt` expects.
   * @param content The wallet event's encrypted `content`; fetching the event is the caller's.
   */
  nip60Keys(
    nostr: Nip07Like,
    pubkey: string,
    content: string,
  ): Promise<{ privkeys: string[]; mints: string[] }>;
  /**
   * Reference implementation of `nip60.signTransaction`, for extension authors and tests.
   *
   * @remarks
   * Takes the private key, which a page never has: this is the extension's side of the contract,
   * not a substitute for calling the extension. Refuses any message that does not start with the
   * transaction domain tag, so an event id (or anything else) can never pass through it.
   */
  signTransaction(
    messageHex: string,
    inputContainerHex: string,
    secretKey: string | Uint8Array,
  ): Nip07SignedHash;
};

const DOMAIN_TAG = utf8ToBytes(TRANSCRIPT_DOMAIN_TAG);

// BIP-340 verifies on x alone, and a leaf may list the key with either parity, so matching is
// by x-coordinate; NIP-07 hands out x-only keys, presented with the conventional 02 prefix.
const xOnly = (pubkey: string): string => pubkey.toLowerCase().slice(-64);

/**
 * Adapts a NIP-07 browser signer to nutroot spending: no relays, no events, only `window.nostr`.
 */
export const CashuNip07: CashuNip07Api = {
  async pubkey(nostr) {
    if (!nostr.getPublicKey) throw new CTSError('NIP-07 signer has no getPublicKey');
    const pubkey = await nostr.getPublicKey();
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new CTSError('NIP-07 getPublicKey must return a 32-byte hex public key');
    }
    return normalizeSecpPubkey(`02${pubkey}`);
  },

  canSign(nostr) {
    return Boolean(nostr.nip60?.signTransaction ?? nostr.signSchnorr);
  },

  canSignP2PK(nostr) {
    return Boolean(nostr.nip60?.signSecret ?? nostr.signString ?? nostr.signSchnorr);
  },

  async signP2PK(nostr, proofs) {
    const pubkey = await this.pubkey(nostr);
    const x = xOnly(pubkey);
    const signSecret = nostr.nip60?.signSecret ?? nostr.signString;
    const out: Proof[] = [];
    for (const proof of proofs) {
      if (isV3PointSecret(proof.secret)) {
        out.push(proof);
        continue;
      }
      let expected: string[];
      try {
        expected = getP2PKExpectedWitnessPubkeys(proof.secret);
      } catch {
        out.push(proof); // not a P2PK secret
        continue;
      }
      if (
        getP2PKSigFlag(proof.secret) === 'SIG_ALL' ||
        !expected.some((k) => xOnly(k) === x) ||
        hasP2PKSignedProof(pubkey, proof)
      ) {
        out.push(proof);
        continue;
      }
      const digestHex = computeMessageDigest(proof.secret, true);
      let sig: string;
      if (signSecret) {
        const signed = await signSecret(proof.secret);
        if (signed.hash.toLowerCase() !== digestHex || xOnly(signed.pubkey) !== x) {
          throw new CTSError('NIP-07 signer signed a different secret or key');
        }
        sig = signed.sig;
      } else if (nostr.signSchnorr) {
        sig = await nostr.signSchnorr(digestHex);
      } else {
        throw new CTSError('NIP-07 signer cannot sign a NUT-11 secret');
      }
      if (!schnorrVerifyDigest(sig, digestHex, pubkey)) {
        throw new CTSError('NIP-07 signature does not verify for its key');
      }
      const witness = parseWitnessData(proof.witness);
      const signatures: string[] = witness?.signatures ?? [];
      out.push({
        ...proof,
        witness: { ...witness, signatures: [...signatures, sig] },
      });
    }
    return out;
  },

  cosign(nostr) {
    return async ({ digest, message, container }) => {
      const digestHex = bytesToHex(digest);
      if (nostr.nip60?.signTransaction) {
        const signed = await nostr.nip60.signTransaction(
          bytesToHex(message),
          bytesToHex(container),
        );
        if (signed.hash.toLowerCase() !== digestHex) {
          throw new CTSError('NIP-07 signer signed a different message');
        }
        return [signed.sig];
      }
      if (nostr.signSchnorr) return [await nostr.signSchnorr(digestHex)];
      throw new CTSError('NIP-07 signer cannot sign a nutroot transaction');
    };
  },

  completes(option, pubkey) {
    const x = xOnly(pubkey);
    const keyIndex = option.leaf.keys.findIndex((k) => xOnly(k) === x);
    if (keyIndex < 0 || option.keys.some((k) => k.keyIndex === keyIndex)) return false;
    return (
      !option.satisfiable &&
      option.blockedBy === 'threshold' &&
      option.keys.length + 1 >= option.leaf.n
    );
  },

  async nip60Keys(nostr, pubkey, content) {
    if (!nostr.nip44?.decrypt) throw new CTSError('NIP-07 signer has no nip44.decrypt');
    let tags: unknown;
    try {
      tags = JSON.parse(await nostr.nip44.decrypt(pubkey, content));
    } catch (e) {
      throw new CTSError('NIP-60 wallet content did not decrypt to JSON', { cause: e });
    }
    if (!Array.isArray(tags)) throw new CTSError('NIP-60 wallet content is not a tag list');
    const values = (name: string) =>
      tags
        .filter(
          (t): t is [string, string] =>
            Array.isArray(t) && t[0] === name && typeof t[1] === 'string',
        )
        .map((t) => t[1]);
    return { privkeys: values('privkey'), mints: values('mint') };
  },

  signTransaction(messageHex, inputContainerHex, secretKey) {
    const message = hexToBytes(messageHex);
    const tagged =
      message.length > DOMAIN_TAG.length &&
      equalBytes(message.subarray(0, DOMAIN_TAG.length), DOMAIN_TAG);
    if (!tagged) throw new CTSError('Refusing to sign: not a Cashu transaction message');
    // The signed value is the input digest, derived here rather than trusted: the container must
    // be a record of the transcript this message carries, or the signature covers nothing real.
    const container = hexToBytes(inputContainerHex);
    if (bytesToHex(message).indexOf(inputContainerHex.toLowerCase(), DOMAIN_TAG.length * 2) < 0) {
      throw new CTSError('Refusing to sign: input container is not part of this transaction');
    }
    const hash = inputDigest(sha256(message), container);
    const key = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey;
    return {
      hash: bytesToHex(hash),
      sig: schnorrSignDigest(hash, key),
      pubkey: bytesToHex(getPubKeyFromPrivKey(key).subarray(1)),
    };
  },
};
