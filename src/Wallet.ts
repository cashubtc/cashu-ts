import { CashuMint } from './CashuMint';
import { Keyset, WalletKeyChain } from './Keys';
import { OutputData, OutputDataLike } from './model/OutputData';
import { MintKeys, Proof, SendResponse, SwapTransaction, Token } from './model/types';
import { hasValidDleq, reorderProofsAfterSwap, splitAmount, stripDleq, sumProofs } from './utils';
import { getTotalInputFee } from './utils/fees';

type OutputType =
	| { type: 'random'; params?: never }
	| { type: 'p2pk'; params: { publicKey: string } };

export class Wallet {
	private _keychain: WalletKeyChain;
	private _mint: CashuMint;

	constructor(mint: string | CashuMint, unit: string) {
		if (mint instanceof CashuMint) {
			this._mint = mint;
		} else {
			this._mint = new CashuMint(mint);
		}
		this._keychain = new WalletKeyChain(unit, {
			keysetEntriesGetter: async () => {
				return this._mint.getKeySets();
			},
			keysetGetter: async (id: string) => {
				const res = await this._mint.getKeys(id);
				return res.keysets[0];
			}
		});
	}

	/**
	 * Receive a Token. This method will swap all proofs included in the passed Token
	 * and return new proofs that match the specified output type.
	 * @param {Token} token - Cashu token, either as string or decoded
	 * @param {OutputType} type - Specifies the type of proofs that will be generated
	 * @param {ReceiveOptions} [options] - Optional configuration for token processing
	 * @returns {Array<Proof>} Newly created proofs
	 */
	async receive(
		token: Token,
		type: OutputType,
		options: { keysetId: string; requireDleq: boolean }
	): Promise<Array<Proof>> {
		const keyset = await this._keychain.getFullKeyset(options.keysetId);
		if (options.requireDleq) {
			if (
				token.proofs.some(
					(p: Proof) =>
						!hasValidDleq(p, { keys: keyset.keyPairs, id: keyset.id, unit: keyset.unit })
				)
			) {
				throw new Error('Token contains proofs with invalid DLEQ');
			}
		}
		const amount = sumProofs(token.proofs) - this.getFeesForProofs(token.proofs);
		const { send: proofs } = await this.swap(amount, token.proofs, { send: type });
		return proofs;
	}

	/**
	 * Swaps a list of proofs for new ones, creating a send and a keep list.
	 *  @param {SwapOptions} [options] - Optional parameters for configuring the swap operation
	 * @returns promise of the change- and send-proofs
	 */
	async swap(
		amount: number,
		inputProofs: Array<Proof>,
		outputTypes?: { send?: OutputType; keep?: OutputType },
		options?: { keysetId: string; includeFees: boolean }
	): Promise<SendResponse> {
		const keyset = await this._keychain.getFullKeyset(options?.keysetId);

		const inputAmount = sumProofs(inputProofs);
		const outputAmounts = { keep: 0, send: 0 };
		outputAmounts.send = amount;
		outputAmounts.keep = inputAmount - outputAmounts.send - this.getFeesForProofs(inputProofs);

		let sendDenominations = splitAmount(outputAmounts.send, keyset.keyPairs);

		if (options?.includeFees) {
			let outputFee = getTotalInputFee(sendDenominations.length, keyset.fee);
			let outputFeeDenominations = splitAmount(outputFee, keyset.keyPairs);
			while (
				getTotalInputFee([...sendDenominations, ...outputFeeDenominations].length, keyset.fee) >
				outputFee
			) {
				outputFee++;
				outputFeeDenominations = splitAmount(outputFee, keyset.keyPairs);
			}
			sendDenominations = [...sendDenominations, ...outputFeeDenominations];
			outputAmounts.send += outputFee;
			outputAmounts.keep -= outputFee;
		}

		if (outputAmounts.send + this.getFeesForProofs(inputProofs) > inputAmount) {
			throw new Error(`Not enough funds available for swap`);
		}

		if (
			outputAmounts.send + this.getFeesForProofs(inputProofs) + outputAmounts.keep !=
			inputAmount
		) {
			throw new Error('Amounts do not match for swap');
		}

		const keepOutputData = this.createOutputData(amount, keyset, outputTypes?.keep);
		const sendOutputData = this.createOutputData(amount, keyset, outputTypes?.send);

		const swapTransaction = this.createSwapTransaction(inputProofs, {
			keep: keepOutputData,
			send: sendOutputData
		});
		const { signatures } = await this._mint.swap(swapTransaction.payload);
		const swapProofs = swapTransaction.outputData.map((d, i) =>
			d.toProof(signatures[i], this.castBackwardsCompatibleKeyset(keyset))
		);
		const reorderedProofs = reorderProofsAfterSwap(swapTransaction, swapProofs);
		return reorderedProofs;
	}

	/**
	 * calculates the fees based on inputs (proofs)
	 * @param proofs input proofs to calculate fees for
	 * @returns fee amount
	 * @throws throws an error if the proofs keyset is unknown
	 */
	getFeesForProofs(proofs: Array<Proof>): number {
		const sumPPK = proofs.reduce((a, c) => a + this.getProofFeePPK(c), 0);
		return Math.ceil(sumPPK / 1000);
	}

	/**
	 * Returns the current fee PPK for a proof according to the cached keyset
	 * @param proof {Proof} A single proof
	 * @returns feePPK {number} The feePPK for the selected proof
	 * @throws throws an error if the proofs keyset is unknown
	 */
	private getProofFeePPK(proof: Proof) {
		const keyset = this._keychain.getLocalKeyset(proof.id);
		if (!keyset) {
			throw new Error(`Could not get fee. No keyset found for keyset id: ${proof.id}`);
		}
		return keyset.fee;
	}

	/**
	 * Constructs a SwapTransaction payload from a lsit of proofs and OutputData
	 * @param proofsToSend proofs to split*
	 * @param outputAmounts? optionally specify the output's amounts to keep and to send.
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns
	 */
	private createSwapTransaction(
		proofsToSend: Array<Proof>,
		outputData: {
			keep: Array<OutputDataLike>;
			send: Array<OutputDataLike>;
		}
	): SwapTransaction {
		let keepOutputData: Array<OutputDataLike> = [];
		let sendOutputData: Array<OutputDataLike> = [];

		keepOutputData = outputData.keep;
		sendOutputData = outputData.send;

		proofsToSend = stripDleq(proofsToSend);

		const mergedBlindingData = [...keepOutputData, ...sendOutputData];
		const indices = mergedBlindingData
			.map((_, i) => i)
			.sort(
				(a, b) =>
					mergedBlindingData[a].blindedMessage.amount - mergedBlindingData[b].blindedMessage.amount
			);
		const keepVector = [
			...Array(keepOutputData.length).fill(true),
			...Array(sendOutputData.length).fill(false)
		];

		const sortedOutputData = indices.map((i) => mergedBlindingData[i]);
		const sortedKeepVector = indices.map((i) => keepVector[i]);

		return {
			payload: {
				inputs: proofsToSend,
				outputs: sortedOutputData.map((d) => d.blindedMessage)
			},
			outputData: sortedOutputData,
			keepVector: sortedKeepVector,
			sortedIndices: indices
		};
	}
	private createOutputData(amount: number, keyset: Keyset, type: OutputType = { type: 'random' }) {
		const backwardsCompatibleKeyset = this.castBackwardsCompatibleKeyset(keyset);
		switch (type?.type) {
			case 'random':
				return OutputData.createRandomData(amount, backwardsCompatibleKeyset);
			case 'p2pk':
				return OutputData.createP2PKData(
					{ pubkey: type.params.publicKey },
					amount,
					backwardsCompatibleKeyset
				);
		}
	}
	private castBackwardsCompatibleKeyset(keyset: Keyset): MintKeys {
		return {
			id: keyset.id,
			keys: keyset.keyPairs,
			unit: keyset.unit
		};
	}
}
