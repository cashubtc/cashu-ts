import { PrivKey } from '@noble/curves/abstract/utils';
import { Secret } from '../common/index';
import { P2PKWitness, Proof } from '../../model/types/index';
import { BlindedMessage } from './index';
export declare const createP2PKsecret: (pubkey: string) => string;
export declare const signP2PKSecret: (secret: string, privateKey: PrivKey) => string;
export declare const signBlindedMessage: (B_: string, privateKey: PrivKey) => string;
/**
 * Verifies a Schnorr signature on a P2PK secret.
 *
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The Secret to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export declare const verifyP2PKSecretSignature: (signature: string, secret: string, pubkey: string) => boolean;
/**
 * Verifies a pubkey has signed a P2PK Proof.
 *
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param proof - A Cashu proof.
 * @returns {boolean} True if one of the signatures is theirs, false otherwise.
 */
export declare const hasP2PKSignedProof: (pubkey: string, proof: Proof) => boolean;
/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public keys or empty array.
 */
export declare function getP2PKExpectedKWitnessPubkeys(secretStr: string | Secret): string[];
/**
 * Returns ALL locktime witnesses from a NUT-11 P2PK secret NB: Does not specify if they are
 * expected to sign - see: getP2PKExpectedKWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public key(s or empty array.
 */
export declare function getP2PKWitnessPubkeys(secretStr: string | Secret): string[];
/**
 * Returns ALL refund witnesses from a NUT-11 P2PK secret NB: Does not specify if they are expected
 * to sign - see: getP2PKExpectedKWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public keys or empty array.
 */
export declare function getP2PKWitnessRefundkeys(secretStr: string | Secret): string[];
/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {number} The locktime unix timestamp or Infinity (permanent lock)
 */
export declare function getP2PKLocktime(secretStr: string | Secret): number;
/**
 * Returns the number of signatures required from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {number} The number of signatories (n_sigs / n_sigs_refund) or 0 if secret is unlocked.
 */
export declare function getP2PKNSigs(secretStr: string | Secret): number;
/**
 * Returns the sigflag from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {string} The sigflag or 'SIG_INPUTS' (default)
 */
export declare function getP2PKSigFlag(secretStr: string | Secret): string;
/**
 * Gets witness signatures as an array.
 *
 * @type {array} of Signatures.
 */
export declare const getP2PKWitnessSignatures: (witness: string | P2PKWitness | undefined) => string[];
/**
 * Signs proofs with provided private key(s) if required NB: Will only sign if the proof requires a
 * signature from the key.
 *
 * @param proofs - An array of proofs to sign.
 * @param privateKey - A single private key or array of private keys.
 * @param beStrict - (Default: false) Throws Error if any signing attempt fails.
 */
export declare const signP2PKProofs: (proofs: Proof[], privateKey: string | string[], beStrict?: boolean) => Proof[];
/**
 * Signs a single proof with the provided private key if required NB: Will only sign if the proof
 * requires a signature from the key.
 *
 * @param proof - A proof to sign.
 * @param privateKey - A single private key.
 * @throws Error if signature is not required or proof is already signed.
 */
export declare const signP2PKProof: (proof: Proof, privateKey: string) => Proof;
export declare const getSignedOutput: (output: BlindedMessage, privateKey: PrivKey) => BlindedMessage;
export declare const getSignedOutputs: (outputs: BlindedMessage[], privateKey: string) => BlindedMessage[];
