import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { WalletOps } from '../../src/wallet/WalletOps';

import type { Proof } from '../../src/model/types';
import type { OutputData } from '../../src/model/OutputData';
import type {
	OutputType,
	OutputConfig,
	SendConfig,
	SendOfflineConfig,
	ReceiveConfig,
	MintProofsConfig,
	SendResponse,
	MeltProofsConfig,
} from '../../src/wallet/types';
import type { MeltQuoteResponse, Bolt12MeltQuoteResponse } from '../../src/mint/types';

// ---- Function signatures for typed mocks ------------------------------------

type SendFn = (
	amount: number,
	proofs: Proof[],
	config?: SendConfig,
	outputConfig?: OutputConfig,
) => Promise<SendResponse>;

type ReceiveFn = (
	token: string,
	config?: ReceiveConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type MintBolt11Fn = (
	amount: number,
	quote: string,
	config?: MintProofsConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type MintBolt12Fn = (
	amount: number,
	quote: string,
	config?: MintProofsConfig,
	outputType?: OutputType,
) => Promise<{ proofs: Proof[] }>;

type SendOfflineFn = (amount: number, proofs: Proof[], config?: SendOfflineConfig) => SendResponse;

type MeltBolt11Fn = (
	quote: MeltQuoteResponse,
	proofs: Proof[],
	config?: MeltProofsConfig,
	outputType?: OutputType,
) => Promise<{ change: Proof[] }>;

type MeltBolt12Fn = (
	quote: Bolt12MeltQuoteResponse,
	proofs: Proof[],
	config?: MeltProofsConfig,
	outputType?: OutputType,
) => Promise<{ change: Proof[] }>;

// ---- Mock wallet ------------------------------------------------------------

class MockWallet {
	defaultOutputType: () => OutputType = vi.fn(() => ({ type: 'random' as const }));

	send: Mock<SendFn> = vi.fn<SendFn>(async () => ({ keep: [], send: [] }));
	receive: Mock<ReceiveFn> = vi.fn<ReceiveFn>(async () => ({ proofs: [] }));
	mintProofsBolt11: Mock<MintBolt11Fn> = vi.fn<MintBolt11Fn>(async () => ({ proofs: [] }));
	mintProofsBolt12: Mock<MintBolt12Fn> = vi.fn<MintBolt12Fn>(async () => ({ proofs: [] }));
	sendOffline: Mock<SendOfflineFn> = vi.fn<SendOfflineFn>(() => ({ keep: [], send: [] }));

	meltProofsBolt11: Mock<MeltBolt11Fn> = vi.fn<MeltBolt11Fn>(async () => ({ change: [] }));
	meltProofsBolt12: Mock<MeltBolt12Fn> = vi.fn<MeltBolt12Fn>(async () => ({ change: [] }));
}

// ---- Fixtures ---------------------------------------------------------------

const proofs: Proof[] = [
	{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
	{ amount: 3, id: '00bd033559de27d0', secret: 'test', C: 'test' },
];

const token =
	'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';

const quote = 'q123';

const melt11: MeltQuoteResponse = {
	quote: 'mq11',
	amount: 5,
	fee_reserve: 1,
	state: 'UNPAID' as any,
	expiry: 0,
	payment_preimage: null,
	request: 'lnbc1...',
	unit: 'sat',
};

const melt12: Bolt12MeltQuoteResponse = {
	quote: 'mq12',
	amount: 7,
	fee_reserve: 2,
	state: 'UNPAID' as any,
	expiry: 0,
	payment_preimage: null,
	request: 'lno1...',
	unit: 'sat',
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
		it('calls wallet.send with config only when no OutputType was set', async () => {
			await ops.send(5, proofs).includeFees(true).keyset('kid').run();

			expect(wallet.send).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, config, maybeOutputConfig] = wallet.send.mock.calls[0];

			expect(amount).toBe(5);
			expect(sentProofs).toBe(proofs);
			expect(config).toEqual({ includeFees: true, keysetId: 'kid' });
			expect(maybeOutputConfig).toBeUndefined();
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
				.onCountersReserved(() => {})
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
		});

		it('offlineExactOnly calls sendOffline with exactMatch true and requireDleq false by default', async () => {
			await ops.send(5, proofs).offlineExactOnly().includeFees(true).run();

			expect(wallet.sendOffline).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, config] = wallet.sendOffline.mock.calls[0];

			expect(amount).toBe(5);
			expect(sentProofs).toBe(proofs);
			expect(config).toEqual({ includeFees: true, exactMatch: true, requireDleq: false });
			expect(wallet.send).not.toHaveBeenCalled();
		});

		it('offlineCloseMatch calls sendOffline with exactMatch false and requireDleq true when set', async () => {
			await ops.send(5, proofs).offlineCloseMatch(true).run();

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
			const mockData = [{ blindedMessage: { amount: 4 } }] as OutputData[];
			const mockKeep = [{ blindedMessage: { amount: 1 } }] as OutputData[];

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
			const data = [{ blindedMessage: { amount: 5 } }] as OutputData[];
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
			const some = [{ amount: 1 } as Proof, { amount: 2 } as Proof];
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
		it('calls wallet.mintProofs with config only when no OutputType was set', async () => {
			await ops.mintBolt11(10, quote).keyset('kid').run();

			expect(wallet.mintProofsBolt11).toHaveBeenCalledTimes(1);
			const [amount, q, config, maybeOT] = wallet.mintProofsBolt11.mock.calls[0];

			expect(amount).toBe(10);
			expect(q).toBe(quote);
			expect(config).toEqual({ keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('calls wallet.mintProofs with custom OutputType and config', async () => {
			await ops
				.mintBolt11(10, quote)
				.asP2PK({ pubkey: 'P' }, [10])
				.privkey('sk')
				.onCountersReserved(() => {})
				.run();

			expect(wallet.mintProofsBolt11).toHaveBeenCalledTimes(1);
			const [amount, q, config, outputType] = wallet.mintProofsBolt11.mock.calls[0];

			expect(amount).toBe(10);
			expect(q).toBe(quote);
			expect(outputType).toEqual({ type: 'p2pk', options: { pubkey: 'P' }, denominations: [10] });

			expect(config).toBeDefined();
			const cfg = config!;
			expect(cfg).toMatchObject({ privkey: 'sk' });
			expect(typeof cfg.onCountersReserved).toBe('function');
		});

		it('supports factory() OutputType for mint', async () => {
			const factory = vi.fn();
			await ops.mintBolt11(8, quote).asFactory(factory, [8]).run();

			const [, , , ot] = wallet.mintProofsBolt11.mock.calls[0];
			expect(ot).toEqual({ type: 'factory', factory, denominations: [8] });
		});

		it('supports custom() OutputType for mint', async () => {
			const data = [{ blindedMessage: { amount: 8 } }] as OutputData[];
			await ops.mintBolt11(8, quote).asCustom(data).run();

			const [, , , ot] = wallet.mintProofsBolt11.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('random() OutputType for mint with denominations', async () => {
			await ops.mintBolt11(12, quote).asRandom([12]).run();

			const [, , , outputType] = wallet.mintProofsBolt11.mock.calls[0];
			expect(outputType).toEqual({ type: 'random', denominations: [12] });
		});

		it('proofsWeHave() is forwarded in mint config', async () => {
			const some = [{ amount: 3 } as Proof];
			await ops.mintBolt11(3, quote).asDeterministic(0).proofsWeHave(some).run();

			const [, , cfg] = wallet.mintProofsBolt11.mock.calls[0];
			expect(cfg).toMatchObject({ proofsWeHave: some });
		});
	});

	// --------------------------- MeltBuilder -----------------------------------

	describe('MeltBuilder', () => {
		it('bolt11: calls wallet.meltProofs with config only when no OutputType was set', async () => {
			const cb = vi.fn();
			await ops.meltBolt11(melt11, proofs).keyset('kid').onCountersReserved(cb).run();

			expect(wallet.meltProofsBolt11).toHaveBeenCalledTimes(1);
			const [q, ps, cfg, maybeOT] = wallet.meltProofsBolt11.mock.calls[0];

			expect(q).toBe(melt11);
			expect(ps).toBe(proofs);
			expect(cfg).toBeDefined();
			expect(cfg!).toMatchObject({ keysetId: 'kid' });
			expect(typeof cfg!.onCountersReserved).toBe('function');
			expect(maybeOT).toBeUndefined();
		});

		it('bolt11: supports OutputType (random) and passes as 4th arg', async () => {
			await ops.meltBolt11(melt11, proofs).asRandom([1, 1, 1]).run();

			const [, , , ot] = wallet.meltProofsBolt11.mock.calls[0];
			expect(ot).toEqual({ type: 'random', denominations: [1, 1, 1] });
		});

		it('bolt11: supports custom OutputType', async () => {
			const data = [{ blindedMessage: { amount: 0 } }] as OutputData[];
			await ops.meltBolt11(melt11, proofs).asCustom(data).run();

			const [, , , ot] = wallet.meltProofsBolt11.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('bolt12: calls wallet.meltProofsBolt12 with config only when no OutputType was set', async () => {
			await ops.meltBolt12(melt12, proofs).keyset('kid').run();

			expect(wallet.meltProofsBolt12).toHaveBeenCalledTimes(1);
			const [q, ps, cfg, maybeOT] = wallet.meltProofsBolt12.mock.calls[0];

			expect(q).toBe(melt12);
			expect(ps).toBe(proofs);
			expect(cfg).toEqual({ keysetId: 'kid' });
			expect(maybeOT).toBeUndefined();
		});

		it('bolt12: supports deterministic OutputType', async () => {
			await ops.meltBolt12(melt12, proofs).asDeterministic(0, []).run();

			const [, , , ot] = wallet.meltProofsBolt12.mock.calls[0];
			expect(ot).toEqual({ type: 'deterministic', counter: 0, denominations: [] });
		});

		it('bolt11: supports P2PK OutputType', async () => {
			await ops.meltBolt11(melt11, proofs).asP2PK({ pubkey: 'X', locktime: 99 }, []).run();

			const [, , , ot] = wallet.meltProofsBolt11.mock.calls[0];
			expect(ot).toEqual({
				type: 'p2pk',
				options: { pubkey: 'X', locktime: 99 },
				denominations: [],
			});
		});

		it('bolt12: supports factory() OutputType', async () => {
			const factory = vi.fn();
			await ops.meltBolt12(melt12, proofs).asFactory(factory, []).run();

			const [, , , ot] = wallet.meltProofsBolt12.mock.calls[0];
			expect(ot).toEqual({
				type: 'factory',
				factory,
				denominations: [],
			});
		});

		it('bolt11: forwards onChangeOutputsCreated callback', async () => {
			const cb = vi.fn();
			await ops.meltBolt11(melt11, proofs).onChangeOutputsCreated(cb).run();

			expect(wallet.meltProofsBolt11).toHaveBeenCalledTimes(1);
			const [, , cfg] = wallet.meltProofsBolt11.mock.calls[0];
			expect(cfg).toBeDefined();
			expect(cfg!.onChangeOutputsCreated).toBe(cb);
		});

		it('bolt12: forwards onChangeOutputsCreated callback', async () => {
			const cb = vi.fn();
			await ops.meltBolt12(melt12, proofs).onChangeOutputsCreated(cb).run();

			expect(wallet.meltProofsBolt12).toHaveBeenCalledTimes(1);
			const [, , cfg] = wallet.meltProofsBolt12.mock.calls[0];
			expect(cfg).toBeDefined();
			expect(cfg!.onChangeOutputsCreated).toBe(cb);
		});

		it('bolt12: forwards onCountersReserved callback', async () => {
			const cb = vi.fn();
			await ops.meltBolt12(melt12, proofs).onCountersReserved(cb).run();

			expect(wallet.meltProofsBolt12).toHaveBeenCalledTimes(1);
			const [, , cfg] = wallet.meltProofsBolt12.mock.calls[0];
			expect(cfg).toBeDefined();
			expect(typeof cfg!.onCountersReserved).toBe('function');
		});
	});
});
