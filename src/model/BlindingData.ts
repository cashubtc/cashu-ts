import {
	MintKeys,
	Proof,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SerializedDLEQ
} from './types';
import {
	blindMessage,
	constructProofFromPromise,
	serializeProof
} from '@cashu/crypto/modules/client';
import { BlindedMessage } from './BlindedMessage';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { DLEQ, pointFromHex } from '@cashu/crypto/modules/common';
import { verifyDLEQProof_reblind } from '@cashu/crypto/modules/client/NUT12';
import { bytesToNumber, numberToHexPadded64, splitAmount } from '../utils';
import { deriveBlindingFactor, deriveSecret } from '@cashu/crypto/modules/client/NUT09';

export interface BlindingDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	toProof: (signature: SerializedBlindedSignature, keyset: MintKeys) => Proof;
}

export type BlindingDataFactory = (amount: number, keys: MintKeys) => BlindingDataLike;

export function isBlindingDataFactory(
	value: Array<BlindingData> | BlindingDataFactory
): value is BlindingDataFactory {
	return typeof value === 'function';
}

export class BlindingData implements BlindingDataLike {
	blindedMessage: SerializedBlindedMessage;
	blindingFactor: bigint;
	secret: Uint8Array;

	constructor(blindedMessage: SerializedBlindedMessage, blidingFactor: bigint, secret: Uint8Array) {
		this.secret = secret;
		this.blindingFactor = blidingFactor;
		this.blindedMessage = blindedMessage;
	}

	toProof(sig: SerializedBlindedSignature, keyset: MintKeys) {
		const dleq =
			sig.dleq == undefined
				? undefined
				: ({
						s: hexToBytes(sig.dleq.s),
						e: hexToBytes(sig.dleq.e),
						r: this.blindingFactor
				  } as DLEQ);
		const blindSignature = {
			id: sig.id,
			amount: sig.amount,
			C_: pointFromHex(sig.C_),
			dleq: dleq
		};
		const A = pointFromHex(keyset.keys[this.blindedMessage.amount]);
		const proof = constructProofFromPromise(blindSignature, this.blindingFactor, this.secret, A);
		const serializedProof = {
			...serializeProof(proof),
			...(dleq && {
				dleqValid: verifyDLEQProof_reblind(this.secret, dleq, proof.C, A)
			}),
			...(dleq && {
				dleq: {
					s: bytesToHex(dleq.s),
					e: bytesToHex(dleq.e),
					r: numberToHexPadded64(dleq.r ?? BigInt(0))
				} as SerializedDLEQ
			})
		} as Proof;
		return serializedProof;
	}

	static createP2PKData(
		p2pk: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
		amount: number,
		keyset: MintKeys,
		customSplit?: Array<number>
	) {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a) =>
			this._createP2PKData(p2pk.pubkey, a, keyset.id, p2pk.locktime, p2pk.refundKeys)
		);
	}

	private static _createP2PKData(
		pubkey: string,
		amount: number,
		keysetId: string,
		locktime?: number,
		refundKeys?: Array<string>
	) {
		const newSecret: [string, { nonce: string; data: string; tags: Array<any> }] = [
			'P2PK',
			{
				nonce: bytesToHex(randomBytes(32)),
				data: pubkey,
				tags: []
			}
		];
		if (locktime) {
			newSecret[1].tags.push(['locktime', locktime]);
		}
		if (refundKeys) {
			newSecret[1].tags.push(['refund', refundKeys]);
		}
		const parsed = JSON.stringify(newSecret);
		const secretBytes = new TextEncoder().encode(parsed);
		const { r, B_ } = blindMessage(secretBytes);
		return new BlindingData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes
		);
	}

	static createRandomData(amount: number, keyset: MintKeys, customSplit?: Array<number>) {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		return amounts.map((a) => this._createRandomData(a, keyset.id));
	}

	private static _createRandomData(amount: number, keysetId: string) {
		const randomHex = bytesToHex(randomBytes(32));
		const secretBytes = new TextEncoder().encode(randomHex);
		const { r, B_ } = blindMessage(secretBytes);
		return new BlindingData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes
		);
	}

	static createDeterministicData(
		amount: number,
		seed: Uint8Array,
		counter: number,
		keyset: MintKeys,
		customSplit?: Array<number>
	): Array<BlindingData> {
		const amounts = splitAmount(amount, keyset.keys, customSplit);
		const data: Array<BlindingData> = [];
		for (let i = 0; i < amounts.length; i++) {
			data.push(this._createDeterministicData(amount, seed, counter + i, keyset.id));
		}
		return data;
	}

	private static _createDeterministicData(
		amount: number,
		seed: Uint8Array,
		counter: number,
		keysetId: string
	) {
		const secretBytes = deriveSecret(seed, keysetId, counter);
		const deterministicR = bytesToNumber(deriveBlindingFactor(seed, keysetId, counter));
		const { r, B_ } = blindMessage(secretBytes, deterministicR);
		return new BlindingData(
			new BlindedMessage(amount, B_, keysetId).getSerializedBlindedMessage(),
			r,
			secretBytes
		);
	}
}
