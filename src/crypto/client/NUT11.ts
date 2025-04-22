import { PrivKey, bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { randomBytes } from '@noble/hashes/utils';
import { parseSecret } from '../common/NUT11.js';
import { Proof, Secret } from '../common/index.js';
import { BlindedMessage } from './index.js';

export const createP2PKsecret = (pubkey: string): Uint8Array => {
	const newSecret: Secret = [
		'P2PK',
		{
			nonce: bytesToHex(randomBytes(32)),
			data: pubkey
		}
	];
	const parsed = JSON.stringify(newSecret);
	return new TextEncoder().encode(parsed);
};

export const signP2PKsecret = (secret: Uint8Array, privateKey: PrivKey) => {
	const msghash = sha256(new TextDecoder().decode(secret));
	const sig = schnorr.sign(msghash, privateKey);
	return sig;
};

export const signBlindedMessage = (B_: string, privateKey: PrivKey): Uint8Array => {
	const msgHash = sha256(B_);
	const sig = schnorr.sign(msgHash, privateKey);
	return sig;
};

export const getP2PExpectedKWitnessPubkeys = (secret: Secret): Array<string> => {
	try {
		const now = Math.floor(Date.now() / 1000); // unix TS
		const { data, tags } = secret[1];
		const locktimeTag = tags && tags.find((tag) => tag[0] === 'locktime');
		const locktime = locktimeTag ? parseInt(locktimeTag[1], 10) : Infinity; // Permanent lock if not set
		const refundTag = tags && tags.find((tag) => tag[0] === 'refund');
		const refundKeys = refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
		const pubkeysTag = tags && tags.find((tag) => tag[0] === 'pubkeys');
		const pubkeys = pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
		const n_sigsTag = tags && tags.find((tag) => tag[0] === 'n_sigs');
		const n_sigs = n_sigsTag ? parseInt(n_sigsTag[1], 10) : undefined;
		// If locktime is in the future, return 'data'+'pubkeys' if multisig ('n_sigs')
		// otherwise return the main locking key ('data')
		if (locktime > now) {
			if (n_sigs && n_sigs >= 1) {
				return [data, ...pubkeys];
			}
			return [data]; // as array
		}
		// If locktime expired, return 'refund' keys
		if (refundKeys) {
			return refundKeys;
		}
	} catch {}
	return []; // Token is not locked / secret is malformed
};

export const getSignedProofs = (
	proofs: Array<Proof>,
	privateKey: string | Array<string>
): Array<Proof> => {
	// Normalize keypairs
	const keypairs: Array<{ priv: string; pub: string }> = [];
	if (Array.isArray(privateKey)) {
		for (const priv of privateKey) {
			keypairs.push({ priv, pub: bytesToHex(schnorr.getPublicKey(priv)) });
		}
	} else {
		keypairs.push({ priv: privateKey, pub: bytesToHex(schnorr.getPublicKey(privateKey)) });
	}
	return proofs.map((proof) => {
		try {
			const parsed: Secret = parseSecret(proof.secret);
			if (parsed[0] !== 'P2PK') {
				throw new Error('unknown secret type');
			}
			// Sign proof for every required witness we have pk for
			const witnesses = getP2PExpectedKWitnessPubkeys(parsed);
			let signedProof = proof;
			for (const { priv, pub } of keypairs) {
				if (witnesses.includes(pub)) {
					signedProof = getSignedProof(signedProof, hexToBytes(priv));
				}
			}
			return signedProof;
		} catch {
			return proof;
		}
	});
};

export const getSignedOutput = (output: BlindedMessage, privateKey: PrivKey): BlindedMessage => {
	const B_ = output.B_.toHex(true);
	const signature = signBlindedMessage(B_, privateKey);
	output.witness = { signatures: [bytesToHex(signature)] };
	return output;
};

export const getSignedOutputs = (
	outputs: Array<BlindedMessage>,
	privateKey: string
): Array<BlindedMessage> => {
	return outputs.map((o) => getSignedOutput(o, privateKey));
};

export const getSignedProof = (proof: Proof, privateKey: PrivKey): Proof => {
	const signature = bytesToHex(signP2PKsecret(proof.secret, privateKey));
	if (!proof.witness) {
		proof.witness = { signatures: [signature] };
	} else {
		proof.witness.signatures = [...(proof.witness.signatures || []), signature];
	}
	return proof;
};
