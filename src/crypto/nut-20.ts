import { schnorr } from '@noble/curves/secp256k1';
import { SerializedBlindedMessage } from '../model/types';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

function constructMessage(quote: string, blindedMessages: Array<SerializedBlindedMessage>): Uint8Array {
	let message = quote;
	for (const blindedMessage of blindedMessages) {
		message += blindedMessage.B_;
	}
	const msgbytes = new TextEncoder().encode(message);
	return sha256(msgbytes);
}

export function signMintQuote(
	privkey: string,
	quote: string,
	blindedMessages: Array<SerializedBlindedMessage>
): string {
	const message = constructMessage(quote, blindedMessages);
	const privkeyBytes = hexToBytes(privkey);
	const signature = schnorr.sign(message, privkeyBytes);
	return bytesToHex(signature);
}

export function verifyMintQuoteSignature(
	pubkey: string,
	quote: string,
	blindedMessages: Array<SerializedBlindedMessage>,
	signature: string
): boolean {
	const sigbytes = hexToBytes(signature);
	const pubkeyBytes = hexToBytes(pubkey);
	const message = constructMessage(quote, blindedMessages);
	return schnorr.verify(sigbytes, message, pubkeyBytes);
}
