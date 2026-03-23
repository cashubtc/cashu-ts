import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { WalletOps } from '../../src/wallet/WalletOps';
import { Amount, type AmountLike } from '../../src/model/Amount';

import type {
	Proof,
	MintQuoteBolt11Response,
	MintQuoteBolt12Response,
	MeltQuoteBaseResponse,
	MeltQuoteBolt11Response,
	MeltQuoteBolt12Response,
} from '../../src/model/types';
import type { OutputData, OutputDataLike } from '../../src/model/OutputData';
import type {
	OutputType,
	OutputConfig,
	SendConfig,
	SendOfflineConfig,
	ReceiveConfig,
	MintProofsConfig,
	SendResponse,
	MeltProofsConfig,
	SwapPreview,
	MeltPreview,
	MintPreview,
} from '../../src/wallet/types';

// ---- Function signatures for typed mocks ------------------------------------

type SendFn = (
	amount: AmountLike,
	proofs: Proof[],
	config?: SendConfig,
	outputConfig?: OutputConfig,
) => Promise<SendResponse>;

type SignP2PKFn = (
	proofs: Proof[],
	privkey: string | string[],
	outputData?: OutputDataLike[],
	quoteId?: string,
) => Proof[];

type PrepareSendFn = (
	amount: AmountLike,
	proofs: Proof[],
	config?: SendConfig,
	outputConfig?: OutputConfig,
) => Promise<SwapPreview>;

type ReceiveFn = (
	token: string,
	config?: ReceiveConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type PrepareReceiveFn = (
	token: string,
	config?: ReceiveConfig,
	outputType?: OutputType,
) => Promise<SwapPreview>;

type MintBolt11Fn = (
	amount: AmountLike,
	quote: string,
	config?: MintProofsConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type MintBolt12Fn = (
	amount: AmountLike,
	quote: MintQuoteBolt12Response,
	privkey: string,
	config?: MintProofsConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type CheckMintQuoteBolt11Fn = (quote: string) => Promise<MintQuoteBolt11Response>;
type ValidateMintQuoteFn = (quote: MintQuoteBolt11Response) => void;

type PrepareMintFn = (
	method: string,
	amount: AmountLike,
	quote: MintQuoteBolt11Response | MintQuoteBolt12Response,
	config?: MintProofsConfig,
	outputType?: OutputType,
) => Promise<MintPreview>;

type CompleteMintFn = (mintPreview: MintPreview) => Promise<Proof[]>;

type SendOfflineFn = (
	amount: AmountLike,
	proofs: Proof[],
	config?: SendOfflineConfig,
) => SendResponse;

type PrepareMeltFn = (
	method: string,
	quote: MeltQuoteBaseResponse,
	proofs: Proof[],
	config?: MeltProofsConfig,
	outputType?: OutputType,
) => Promise<MeltPreview<MeltQuoteBaseResponse>>;

type CompleteMeltFn = (
	meltPreview: MeltPreview,
	privkey?: string | string[],
	preferAsync?: boolean,
) => Promise<{ change: Proof[] }>;

// ---- Mock wallet ------------------------------------------------------------

class MockWallet {
	defaultOutputType: () => OutputType = vi.fn(() => ({ type: 'random' as const }));

	signP2PKProofs: Mock<SignP2PKFn> = vi.fn<SignP2PKFn>((ps) => ps); // passthrough
	send: Mock<SendFn> = vi.fn<SendFn>(async () => ({ keep: [], send: [] }));
	prepareSwapToSend: Mock<PrepareSendFn> = vi.fn<PrepareSendFn>(async () => ({
		amount: Amount.from(16),
		fees: Amount.one(),
		keysetId: '123',
		inputs: [],
		keepOutputs: [],
		sendOutputs: [],
		unselectedProofs: [],
	}));
	receive: Mock<ReceiveFn> = vi.fn<ReceiveFn>(async () => ({ proofs: [] }));
	prepareSwapToReceive: Mock<PrepareReceiveFn> = vi.fn<PrepareReceiveFn>(async () => ({
		amount: Amount.from(16),
		fees: Amount.one(),
		keysetId: '123',
		inputs: [],
		keepOutputs: [],
	}));
	mintProofsBolt11: Mock<MintBolt11Fn> = vi.fn<MintBolt11Fn>(async () => ({ proofs: [] }));
	mintProofsBolt12: Mock<MintBolt12Fn> = vi.fn<MintBolt12Fn>(async () => ({ proofs: [] }));
	checkMintQuoteBolt11: Mock<CheckMintQuoteBolt11Fn> = vi.fn<CheckMintQuoteBolt11Fn>(
		async (id) => ({
			quote: id,
			state: 'UNPAID' as any,
			expiry: 0,
			request: '',
			amount: Amount.from(0),
			unit: '',
		}),
	);
	validateMintQuote: Mock<ValidateMintQuoteFn> = vi.fn<ValidateMintQuoteFn>();
	prepareMint: Mock<PrepareMintFn> = vi.fn<PrepareMintFn>(async (m, _a, q, _c, _o) => {
		return {
			method: m,
			payload: { quote: q.quote, outputs: [] },
			outputData: [],
			keysetId: '123',
			quote: q,
		};
	});
	completeMint: Mock<CompleteMintFn> = vi.fn<CompleteMintFn>(async () => []);
	sendOffline: Mock<SendOfflineFn> = vi.fn<SendOfflineFn>(() => ({ keep: [], send: [] }));
	prepareMelt: Mock<PrepareMeltFn> = vi.fn<PrepareMeltFn>(async (m, q, p, _c, _o) => ({
		method: m,
		inputs: p,
		outputData: [],
		keysetId: '123',
		quote: q,
	}));
	completeMelt: Mock<CompleteMeltFn> = vi.fn<CompleteMeltFn>(async () => ({ change: [] }));
}

// ---- Fixtures ---------------------------------------------------------------

const proofs: Proof[] = [
	{ amount: 2n, id: '00bd033559de27d0', secret: 'test', C: 'test' },
	{ amount: 3n, id: '00bd033559de27d0', secret: 'test', C: 'test' },
];

const token =
	'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';

const quote = 'q123';

const melt11: MeltQuoteBolt11Response = {
	quote: 'mq11',
	amount: Amount.from(5),
	fee_reserve: Amount.from(1),
	state: 'UNPAID' as any,
	expiry: 0,
	payment_preimage: null,
	request: 'lnbc1...',
	unit: 'sat',
};

const melt12: MeltQuoteBolt12Response = {
	quote: 'mq12',
	amount: Amount.from(7),
	fee_reserve: Amount.from(2),
	state: 'UNPAID' as any,
	expiry: 0,
	payment_preimage: null,
	request: 'lno1...',
	unit: 'sat',
};

const mint12: MintQuoteBolt12Response = {
	quote: 'mq12',
	request: 'lno1...',
	amount: Amount.from(7),
	unit: 'sat',
	expiry: 0,
	pubkey: '0200000',
	amount_paid: Amount.from(0),
	amount_issued: Amount.from(0),
};

describe('WalletOps builders', () => {
	let wallet: MockWallet;
	let ops: WalletOps;

	beforeEach(() => {
		wallet = new MockWallet();
		ops = new WalletOps(wallet as unknown as any);
		vi.clearAllMocks();
	});

	// --------------------------- SendBuilder -----------------------------------

	describe('SendBuilder', () => {
		it('calls wallet.send with defaults when no OutputType was set', async () => {
			await ops.send(5, proofs).includeFees(true).keyset('kid').run();

			expect(wallet.send).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, config, maybeOutputConfig] = wallet.send.mock.calls[0];

			expect(Amount.from(amount).toNumber()).toBe(5);
			expect(sentProofs).toBe(proofs);
			expect(config).toEqual({ includeFees: true, keysetId: 'kid' });
			expect(maybeOutputConfig).toEqual({
				send: { type: 'random' },
			});
		});

		it('accepts AmountLike for send amount', async () => {
			await ops.send(Amount.from(5), proofs).run();
			expect(wallet.send).toHaveBeenCalledTimes(1);
			expect(Amount.from(wallet.send.mock.calls[0][0]).toNumber()).toBe(5);
		});

		it('calls wallet.prepareSwapToSend with defaults when no OutputType was set', async () => {
			await ops.send(5, proofs).includeFees(true).keyset('kid').prepare();

			expect(wallet.prepareSwapToSend).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, config, maybeOutputConfig] =
				wallet.prepareSwapToSend.mock.calls[0];

			expect(Amount.from(amount).toNumber()).toBe(5);
			expect(sentProofs).toBe(proofs);
			expect(config).toEqual({ includeFees: true, keysetId: 'kid' });
			expect(maybeOutputConfig).toEqual({
				send: { type: 'random' },
			});
		});

		it('builds OutputConfig with send only and omits keep when keep not set', async () => {
			await ops.send(5, proofs).asDeterministic(0, [5]).run();

			const [, , config, outputConfig] = wallet.send.mock.calls[0];
			expect(config).toEqual({});
			expect(outputConfig).toEqual({
				send: { type: 'deterministic', counter: 0, denominations: [5] },
			});
		});

		it('includes keep when keep OutputType is provided', async () => {
			await ops
				.send(5, proofs)
				.asRandom([5])
				.keepAsDeterministic(0, [])
				.includeFees(true)
				.privkey('12345')
				.onCountersReserved(() => {})
				.proofsWeHave(proofs)
				.run();

			const [, , config, outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'random', denominations: [5] },
				keep: { type: 'deterministic', counter: 0, denominations: [] },
			});

			expect(config).toBeDefined();
			const cfg = config!;
			expect(typeof cfg.onCountersReserved).toBe('function');
			expect(cfg).toMatchObject({ includeFees: true });
			expect(cfg.proofsWeHave).toBe(proofs);
		});

		it('offlineExactOnly calls sendOffline with exactMatch true and requireDleq false by default', async () => {
			await ops.send(5, proofs).offlineExactOnly().includeFees(true).privkey('12345').run();

			expect(wallet.sendOffline).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, config] = wallet.sendOffline.mock.calls[0];

			expect(Amount.from(amount).toNumber()).toBe(5);
			expect(sentProofs).toBe(proofs);
			expect(config).toEqual({ includeFees: true, exactMatch: true, requireDleq: false });
			expect(wallet.send).not.toHaveBeenCalled();
		});

		it('offlineCloseMatch calls sendOffline with exactMatch false and requireDleq true when set', async () => {
			await ops.send(5, proofs).offlineCloseMatch(true).privkey('12345').run();

			const [, , config] = wallet.sendOffline.mock.calls[0];
			expect(config).toEqual({ includeFees: undefined, exactMatch: false, requireDleq: true });
		});

		it('throws if offline mode is combined with any OutputType', async () => {
			await expect(ops.send(5, proofs).asRandom().offlineExactOnly().run()).rejects.toThrow(
				/Offline selection cannot be combined/i,
			);

			await expect(ops.send(5, proofs).keepAsRandom().offlineCloseMatch().run()).rejects.toThrow(
				/Offline selection cannot be combined/i,
			);
		});

		it('supports sendP2PK and keepP2PK OutputTypes', async () => {
			await ops
				.send(7, proofs)
				.asP2PK({ pubkey: 'pub', locktime: 123 }, [7])
				.keepAsP2PK({ pubkey: ['a', 'b'], requiredSignatures: 2 }, [])
				.run();

			const [, , , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'p2pk', options: { pubkey: 'pub', locktime: 123 }, denominations: [7] },
				keep: {
					type: 'p2pk',
					options: { pubkey: ['a', 'b'], requiredSignatures: 2 },
					denominations: [],
				},
			});
		});

		it('accepts AmountLike denominations in builder output config', async () => {
			await ops.send(7, proofs).asRandom(['2', 3n, 2]).run();
			const [, , , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'random', denominations: ['2', 3n, 2] },
			});
		});

		it('supports prepareSwapToSend', async () => {
			await ops
				.send(7, proofs)
				.asP2PK({ pubkey: 'pub', locktime: 123 }, [7])
				.keepAsP2PK({ pubkey: ['a', 'b'], requiredSignatures: 2 }, [])
				.prepare();

			const [, , , outputConfig] = wallet.prepareSwapToSend.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'p2pk', options: { pubkey: 'pub', locktime: 123 }, denominations: [7] },
				keep: {
					type: 'p2pk',
					options: { pubkey: ['a', 'b'], requiredSignatures: 2 },
					denominations: [],
				},
			});
		});

		it('supports sendFactory and keepFactory OutputTypes', async () => {
			const factory = vi.fn();
			await ops.send(9, proofs).asFactory(factory, [9]).keepAsFactory(factory, []).run();

			const [, , , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'factory', factory, denominations: [9] },
				keep: { type: 'factory', factory, denominations: [] },
			});
		});

		it('supports sendCustom and keepCustom OutputTypes', async () => {
			const mockData = [{ blindedMessage: { amount: Amount.from(4) } }] as unknown as OutputData[];
			const mockKeep = [{ blindedMessage: { amount: Amount.one() } }] as unknown as OutputData[];

			await ops.send(4, proofs).asCustom(mockData).keepAsCustom(mockKeep).run();

			const [, , , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'custom', data: mockData },
				keep: { type: 'custom', data: mockKeep },
			});
		});

		it('when only keep is set, send defaults via wallet.defaultOutputType()', async () => {
			const defaultSpy = vi.spyOn(wallet, 'defaultOutputType');
			await ops.send(5, proofs).keepAsDeterministic(0, []).run();

			expect(defaultSpy).toHaveBeenCalled(); // send side filled by policy
			const [, , , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig!.keep).toEqual({ type: 'deterministic', counter: 0, denominations: [] });
			expect(outputConfig!.send).toEqual({ type: 'random' });
		});

		it('offlineExactOnly respects requireDleq=true', async () => {
			await ops.send(5, proofs).offlineExactOnly(true).run();

			const [, , cfg] = wallet.sendOffline.mock.calls[0];
			expect(cfg).toEqual({ includeFees: undefined, exactMatch: true, requireDleq: true });
		});

		it('includeFees() with no arg sets includeFees: true', async () => {
			await ops.send(5, proofs).includeFees().run();
			const [, , cfg] = wallet.send.mock.calls[0];
			expect(cfg).toEqual({ includeFees: true });
		});

		it('offlineCloseMatch honours includeFees: true', async () => {
			await ops.send(5, proofs).includeFees(true).offlineCloseMatch().run();

			const [, , cfg] = wallet.sendOffline.mock.calls[0];
			expect(cfg).toEqual({ includeFees: true, exactMatch: false, requireDleq: false });
		});
	});

	// --------------------------- ReceiveBuilder --------------------------------

	describe('ReceiveBuilder', () => {
		it('calls wallet.receive with config only when no OutputType was set', async () => {
			await ops.receive(token).requireDleq(true).keyset('kid').run();

			expect(wallet.receive).toHaveBeenCalledTimes(1);
			const [tok, config, maybeOT] = wallet.receive.mock.calls[0];
			expect(tok).toBe(token);
			expect(config).toEqual({ requireDleq: true, keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('calls wallet.prepareSwapToReceive with config only when no OutputType was set', async () => {
			await ops.receive(token).requireDleq(true).keyset('kid').prepare();

			expect(wallet.prepareSwapToReceive).toHaveBeenCalledTimes(1);
			const [tok, config, maybeOT] = wallet.prepareSwapToReceive.mock.calls[0];
			expect(tok).toBe(token);
			expect(config).toEqual({ requireDleq: true, keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('calls wallet.receive with custom OutputType and config', async () => {
			const cb = vi.fn();
			await ops
				.receive(token)
				.asDeterministic(0, [5])
				.privkey(['k1', 'k2'])
				.onCountersReserved(cb)
				.run();

			expect(wallet.receive).toHaveBeenCalledTimes(1);
			const [tok, config, outputType] = wallet.receive.mock.calls[0];

			expect(tok).toBe(token);
			expect(outputType).toEqual({ type: 'deterministic', counter: 0, denominations: [5] });

			expect(config).toBeDefined();
			const cfg = config!;
			expect(cfg).toMatchObject({ privkey: ['k1', 'k2'] });
			expect(typeof cfg.onCountersReserved).toBe('function');
		});

		it('supports factory() OutputType for receive', async () => {
			const factory = vi.fn();
			await ops.receive(token).asFactory(factory, [3, 2]).run();

			const [, , outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'factory', factory, denominations: [3, 2] });
		});

		it('supports custom() OutputType for receive', async () => {
			const data = [{ blindedMessage: { amount: Amount.from(5) } }] as unknown as OutputData[];
			await ops.receive(token).asCustom(data).run();

			const [, , outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'custom', data });
		});

		it('privkey accepts string as well as string[]', async () => {
			await ops.receive(token).asDeterministic(0).privkey('single-key').run();

			const [, config] = wallet.receive.mock.calls[0];
			expect(config).toMatchObject({ privkey: 'single-key' });
		});

		it('random() OutputType for receive with denominations', async () => {
			await ops.receive(token).asRandom([1, 2, 3]).run();

			const [, , outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'random', denominations: [1, 2, 3] });
		});

		it('p2pk() OutputType for receive', async () => {
			await ops.receive(token).asP2PK({ pubkey: 'PUB', locktime: 42 }, [7]).run();

			const [, , outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({
				type: 'p2pk',
				options: { pubkey: 'PUB', locktime: 42 },
				denominations: [7],
			});
		});

		it('proofsWeHave() is forwarded in receive config', async () => {
			const some = [{ amount: 1 } as unknown as Proof, { amount: 2 } as unknown as Proof];
			await ops.receive(token).asDeterministic(0).proofsWeHave(some).run();

			const [, config] = wallet.receive.mock.calls[0];
			expect(config).toMatchObject({ proofsWeHave: some });
		});

		it('requireDleq() with no arg sets requireDleq: true', async () => {
			await ops.receive(token).requireDleq().run();

			const [, cfg] = wallet.receive.mock.calls[0];
			expect(cfg).toMatchObject({ requireDleq: true });
		});
	});

	// --------------------------- MintBuilder -----------------------------------

	describe('MintBuilder', () => {
		it('calls wallet.prepareMint with config only when no OutputType was set', async () => {
			await ops.mintBolt11(10, quote).keyset('kid').prepare();

			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			const [method, amount, q, config, maybeOT] = wallet.prepareMint.mock.calls[0];

			expect(method).toBe('bolt11');
			expect(Amount.from(amount).toNumber()).toBe(10);
			// MintBuilder resolves string quote IDs via checkMintQuoteBolt11 before calling prepareMint
			expect(q.quote).toBe(quote);
			expect(config).toEqual({ keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('accepts AmountLike for mint amount', async () => {
			await ops.mintBolt11('10', quote).prepare();
			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			expect(Amount.from(wallet.prepareMint.mock.calls[0][1]).toNumber()).toBe(10);
		});

		it('calls wallet.prepareMint with custom OutputType and config', async () => {
			await ops
				.mintBolt11(10, quote)
				.asP2PK({ pubkey: 'P' }, [10])
				.privkey('sk')
				.onCountersReserved(() => {})
				.prepare();

			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			const [method, amount, q, config, outputType] = wallet.prepareMint.mock.calls[0];

			expect(method).toBe('bolt11');
			expect(Amount.from(amount).toNumber()).toBe(10);
			// MintBuilder resolves string quote IDs via checkMintQuoteBolt11 before calling prepareMint
			expect(q.quote).toBe(quote);
			expect(outputType).toEqual({ type: 'p2pk', options: { pubkey: 'P' }, denominations: [10] });

			expect(config).toBeDefined();
			const cfg = config!;
			expect(cfg).toMatchObject({ privkey: 'sk' });
			expect(typeof cfg.onCountersReserved).toBe('function');
		});

		it('supports factory() OutputType for mint', async () => {
			const factory = vi.fn();
			await ops.mintBolt11(8, quote).asFactory(factory, [8]).prepare();

			const [, , , , ot] = wallet.prepareMint.mock.calls[0];
			expect(ot).toEqual({ type: 'factory', factory, denominations: [8] });
		});

		it('supports custom() OutputType for mint', async () => {
			const data = [{ blindedMessage: { amount: Amount.from(8) } }] as unknown as OutputData[];
			await ops.mintBolt11(8, quote).asCustom(data).prepare();

			const [, , , , ot] = wallet.prepareMint.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('random() OutputType for mint with denominations', async () => {
			await ops.mintBolt11(12, quote).asRandom([12]).prepare();

			const [, , , , outputType] = wallet.prepareMint.mock.calls[0];
			expect(outputType).toEqual({ type: 'random', denominations: [12] });
		});

		it('proofsWeHave() is forwarded in mint config', async () => {
			const some = [{ amount: 3 } as unknown as Proof];
			await ops.mintBolt11(3, quote).asDeterministic(0).proofsWeHave(some).prepare();

			const [, , , cfg] = wallet.prepareMint.mock.calls[0];
			expect(cfg).toMatchObject({ proofsWeHave: some });
		});

		it('run uses wallet.prepareMint and wallet.completeMint', async () => {
			const preview: MintPreview = {
				method: 'bolt11',
				payload: { quote, outputs: [] },
				outputData: [],
				keysetId: '123',
				quote: { quote, request: '', unit: '' },
			};
			wallet.prepareMint.mockResolvedValueOnce(preview);

			await ops.mintBolt11(10, quote).keyset('kid').run();

			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			expect(wallet.completeMint).toHaveBeenCalledTimes(1);
			expect(wallet.completeMint).toHaveBeenCalledWith(preview);
		});

		it('bolt12 requires privkey at compile time', () => {
			if (false as boolean) {
				// This is a compiler check - if you remove the exclude line below the
				// compiler should complain 'MintBuilder<"bolt12", false>' is not assignable
				// @ts-expect-error run should not be callable before privkey
				ops.mintBolt12(7, mint12).run();
				// @ts-expect-error prepare should not be callable before privkey
				ops.mintBolt12(7, mint12).prepare();
			}

			void ops.mintBolt12(7, mint12).privkey('k').run();
			void ops.mintBolt12(7, mint12).privkey('k').prepare();
		});

		it('bolt12 throws at runtime without privkey for JS consumers', async () => {
			const builder: any = ops.mintBolt12(7, mint12);
			await expect(builder.run()).rejects.toThrow(/privkey is required/i);
			await expect(builder.prepare()).rejects.toThrow(/privkey is required/i);
			expect(wallet.prepareMint).not.toHaveBeenCalled();
		});

		it('bolt12 prepare forwards config and outputType', async () => {
			const cb = vi.fn();
			await ops
				.mintBolt12(7, mint12)
				.asDeterministic(0, [7])
				.keyset('kid')
				.onCountersReserved(cb)
				.privkey('sk')
				.prepare();

			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			const [method, amount, q, cfg, ot] = wallet.prepareMint.mock.calls[0];

			expect(method).toBe('bolt12');
			expect(Amount.from(amount).toNumber()).toBe(7);
			expect(q).toBe(mint12);
			expect(cfg).toMatchObject({ keysetId: 'kid', privkey: 'sk' });
			expect(typeof cfg!.onCountersReserved).toBe('function');
			expect(ot).toEqual({ type: 'deterministic', counter: 0, denominations: [7] });
		});

		it('bolt12 run uses wallet.prepareMint and wallet.completeMint', async () => {
			const preview: MintPreview = {
				method: 'bolt12',
				payload: { quote: mint12.quote, outputs: [] },
				outputData: [],
				keysetId: '123',
				quote: { quote: mint12.quote, request: '', unit: '' },
			};
			wallet.prepareMint.mockResolvedValueOnce(preview);

			await ops.mintBolt12(7, mint12).privkey('sk').run();

			expect(wallet.prepareMint).toHaveBeenCalledTimes(1);
			expect(wallet.completeMint).toHaveBeenCalledTimes(1);
			expect(wallet.completeMint).toHaveBeenCalledWith(preview);
		});

		it('bolt12 supports factory OutputType', async () => {
			const factory = vi.fn();
			await ops.mintBolt12(7, mint12).asFactory(factory, [7]).privkey('sk').prepare();

			const [, , , , ot] = wallet.prepareMint.mock.calls[0];
			expect(ot).toEqual({ type: 'factory', factory, denominations: [7] });
		});

		it('bolt12 supports custom OutputType', async () => {
			const data = [{ blindedMessage: { amount: Amount.from(7) } }] as unknown as OutputData[];
			await ops.mintBolt12(7, mint12).asCustom(data).privkey('sk').prepare();

			const [, , , , ot] = wallet.prepareMint.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('bolt12 supports random OutputType with denominations', async () => {
			await ops.mintBolt12(7, mint12).asRandom([7]).privkey('sk').prepare();

			const [, , , , ot] = wallet.prepareMint.mock.calls[0];
			expect(ot).toEqual({ type: 'random', denominations: [7] });
		});

		it('bolt12 forwards proofsWeHave in config', async () => {
			const some = [{ amount: 3 } as unknown as Proof];
			await ops.mintBolt12(7, mint12).asDeterministic(0).proofsWeHave(some).privkey('sk').prepare();

			const [, , , cfg] = wallet.prepareMint.mock.calls[0];
			expect(cfg).toMatchObject({ proofsWeHave: some });
		});

		it('bolt12 takes the last privkey if called twice', async () => {
			await ops.mintBolt12(7, mint12).privkey('old').privkey('new').prepare();

			const [, , , cfg] = wallet.prepareMint.mock.calls[0];
			expect(cfg).toMatchObject({ privkey: 'new' });
		});

		it('bolt11 locked quote without privkey throws at runtime', async () => {
			const lockedQuote = { ...mint12, request: 'lnbc1...', pubkey: '02abcd' } as any;
			await expect((ops.mintBolt11 as any)(10, lockedQuote).run()).rejects.toThrow(
				/privkey is required/i,
			);
			await expect((ops.mintBolt11 as any)(10, lockedQuote).prepare()).rejects.toThrow(
				/privkey is required/i,
			);
		});
	});

	// --------------------------- MeltBuilder -----------------------------------

	describe('MeltBuilder', () => {
		it('supports wallet.prepareMelt', async () => {
			const cb = vi.fn();
			await ops
				.meltBolt11(melt11, proofs)
				.privkey('12345')
				.keyset('kid')
				.onCountersReserved(cb)
				.prepare();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			const [method, q, ps, cfg, maybeOT] = wallet.prepareMelt.mock.calls[0];

			expect(method).toBe('bolt11');
			expect(q).toBe(melt11);
			expect(ps).toBe(proofs);

			expect(cfg).toBeDefined();
			expect(cfg).toMatchObject({ keysetId: 'kid' });
			expect(typeof (cfg as MeltProofsConfig).onCountersReserved).toBe('function');

			expect(maybeOT).toBeUndefined();
		});
		it('bolt11: calls wallet.prepareMelt and completeMelt with config only when no OutputType was set', async () => {
			const cb = vi.fn();
			await ops
				.meltBolt11(melt11, proofs)
				.privkey('12345')
				.keyset('kid')
				.onCountersReserved(cb)
				.run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [method, q, ps, cfg, maybeOT] = wallet.prepareMelt.mock.calls[0];

			expect(method).toBe('bolt11');
			expect(q).toBe(melt11);
			expect(ps).toBe(proofs);

			expect(cfg).toBeDefined();
			expect(cfg).toMatchObject({ keysetId: 'kid' });
			expect(typeof (cfg as MeltProofsConfig).onCountersReserved).toBe('function');

			expect(maybeOT).toBeUndefined();
		});

		it('bolt11: supports OutputType (random) and passes it to prepareMelt', async () => {
			await ops.meltBolt11(melt11, proofs).asRandom([1, 1, 1]).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , , ot] = wallet.prepareMelt.mock.calls[0];
			expect(ot).toEqual({ type: 'random', denominations: [1, 1, 1] });
		});

		it('bolt11: supports custom OutputType', async () => {
			const data = [{ blindedMessage: { amount: Amount.zero() } }] as unknown as OutputData[];
			await ops.meltBolt11(melt11, proofs).asCustom(data).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , , ot] = wallet.prepareMelt.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('bolt12: calls wallet.prepareMelt and completeMelt with config only when no OutputType was set', async () => {
			await ops.meltBolt12(melt12, proofs).keyset('kid').run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [method, q, ps, cfg, maybeOT] = wallet.prepareMelt.mock.calls[0];

			expect(method).toBe('bolt12');
			expect(q).toBe(melt12);
			expect(ps).toBe(proofs);
			expect(cfg).toEqual({ keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('bolt12: supports deterministic OutputType', async () => {
			await ops.meltBolt12(melt12, proofs).asDeterministic(0, []).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , , ot] = wallet.prepareMelt.mock.calls[0];
			expect(ot).toEqual({ type: 'deterministic', counter: 0, denominations: [] });
		});

		it('bolt11: supports P2PK OutputType', async () => {
			await ops.meltBolt11(melt11, proofs).asP2PK({ pubkey: 'X', locktime: 99 }, []).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , , ot] = wallet.prepareMelt.mock.calls[0];
			expect(ot).toEqual({
				type: 'p2pk',
				options: { pubkey: 'X', locktime: 99 },
				denominations: [],
			});
		});

		it('bolt12: supports factory() OutputType', async () => {
			const factory = vi.fn();
			await ops.meltBolt12(melt12, proofs).asFactory(factory, []).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , , ot] = wallet.prepareMelt.mock.calls[0];
			expect(ot).toEqual({
				type: 'factory',
				factory,
				denominations: [],
			});
		});

		it('bolt12: forwards onCountersReserved callback', async () => {
			const cb = vi.fn();
			await ops.meltBolt12(melt12, proofs).onCountersReserved(cb).run();

			expect(wallet.prepareMelt).toHaveBeenCalledTimes(1);
			expect(wallet.completeMelt).toHaveBeenCalledTimes(1);

			const [, , , cfg] = wallet.prepareMelt.mock.calls[0];
			expect(cfg).toBeDefined();
			expect(typeof (cfg as MeltProofsConfig).onCountersReserved).toBe('function');
		});
	});
});
