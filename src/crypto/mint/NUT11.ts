import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { parseP2PKSecret } from '../common/NUT11.js';
import {
	getP2PKExpectedKWitnessPubkeys,
	getP2PKWitnessSignatures,
	getP2PKNSigs,
	verifyP2PKSecretSignature
} from '../client/NUT11.js';
import { type Proof } from '../../model/types/index.js';
import { BlindedMessage } from '../client/index.js';

export const verifyP2PKSig = (proof: Proof): boolean => {
	if (!proof.witness) {
		throw new Error('could not verify signature, no witness provided');
	}
	const parsedSecret = parseP2PKSecret(proof.secret);
	const witnesses = getP2PKExpectedKWitnessPubkeys(parsedSecret);
	if (!witnesses.length) {
		throw new Error('no signatures required, proof is unlocked');
	}
	let signatories = 0;
	const requiredSigs = getP2PKNSigs(parsedSecret);
	const signatures = getP2PKWitnessSignatures(proof.witness);
	// Loop through witnesses to see if any of the signatures belong to them.
	// We need to do this as Schnorr signatures are non-deterministic, so we
	// count the number of valid witnesses, not the number of valid signatures
	for (const pubkey of witnesses) {
		const hasSigned = signatures.some((sig) => {
			try {
				return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
			} catch {
				return false; // Invalid signature, treat as not signed
			}
		});
		if (hasSigned) {
			signatories++;
		}
	}
	if (signatories >= requiredSigs) {
		return true;
	}
	return false;
};

export const verifyP2PKSigOutput = (output: BlindedMessage, publicKey: string): boolean => {
	if (!output.witness) {
		throw new Error('could not verify signature, no witness provided');
	}
	return schnorr.verify(
		output.witness.signatures[0],
		sha256(output.B_.toHex(true)),
		publicKey.slice(2)
	);
};
