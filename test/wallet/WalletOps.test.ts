import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletOps } from '../../src/wallet/WalletOps';
import { Proof } from '../../src/model/types';

class MockWallet {
	// policy default matters for the “keep omitted” optimisation
	defaultOutputType = vi.fn(() => ({ type: 'random' as const }));

	send = vi.fn(async (...args: any[]) => ({ calledWith: args, keep: [], send: [] }));
	receive = vi.fn(async (...args: any[]) => ({ calledWith: args, proofs: [] }));
	mintProofs = vi.fn(async (...args: any[]) => ({ calledWith: args, proofs: [] }));
	sendOffline = vi.fn((...args: any[]) => ({ calledWith: args, keep: [], send: [] }));
}

describe('WalletOps builders', () => {
	let wallet: MockWallet;
	let ops: WalletOps;
	const proofs: Proof[] = [
		{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
		{ amount: 3, id: '00bd033559de27d0', secret: 'test', C: 'test' },
	];
	const token: string =
		'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
	const quote = 'q123';

	beforeEach(() => {
		wallet = new MockWallet();
		ops = new WalletOps(wallet as any);
		vi.clearAllMocks();
	});

	describe('SendBuilder', () => {
		it('calls wallet.send with config only when no OutputType was set', async () => {
			await ops.send(5, proofs).includeFees(true).keyset('kid').run();

			expect(wallet.send).toHaveBeenCalledTimes(1);
			const [amount, sentProofs, maybeOutputConfig, config] = wallet.send.mock.calls[0];

			expect(amount).toBe(5);
			expect(sentProofs).toBe(proofs);
			// 3rd arg is config (overload without OutputConfig)
			expect(maybeOutputConfig).toEqual({ includeFees: true, keysetId: 'kid' });
			expect(config).toBeUndefined();
		});

		it('builds OutputConfig with send only and omits keep when keep not set', async () => {
			await ops.send(5, proofs).sendDeterministic(0, [5]).run();

			expect(wallet.send).toHaveBeenCalledTimes(1);
			const [, , outputConfig, config] = wallet.send.mock.calls[0];

			expect(outputConfig).toEqual({
				send: { type: 'deterministic', counter: 0, denominations: [5] },
			});
			expect(config).toEqual({});
		});

		it('includes keep when keep OutputType is provided', async () => {
			await ops
				.send(5, proofs)
				.sendRandom([5])
				.keepDeterministic(0, [])
				.includeFees(true)
				.onCountersReserved(() => {})
				.run();

			expect(wallet.send).toHaveBeenCalledTimes(1);
			const [, , outputConfig, config] = wallet.send.mock.calls[0];

			expect(outputConfig).toEqual({
				send: { type: 'random', denominations: [5] },
				keep: { type: 'deterministic', counter: 0, denominations: [] },
			});
			expect(config).toMatchObject({ includeFees: true });
			// the callback presence is enough, we don’t call it here
			expect(typeof config.onCountersReserved).toBe('function');
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

			expect(wallet.sendOffline).toHaveBeenCalledTimes(1);
			const [, , config] = wallet.sendOffline.mock.calls[0];
			expect(config).toEqual({ includeFees: undefined, exactMatch: false, requireDleq: true });
		});

		it('throws if offline mode is combined with any OutputType', async () => {
			await expect(ops.send(5, proofs).sendRandom().offlineExactOnly().run()).rejects.toThrow(
				/Offline selection cannot be combined/i,
			);

			await expect(ops.send(5, proofs).keepRandom().offlineCloseMatch().run()).rejects.toThrow(
				/Offline selection cannot be combined/i,
			);
		});

		it('supports sendP2PK and keepP2PK OutputTypes', async () => {
			await ops
				.send(7, proofs)
				.sendP2PK({ pubkey: 'pub', locktime: 123 }, [7])
				.keepP2PK({ pubkey: ['a', 'b'], requiredSignatures: 2 }, [])
				.run();

			const [, , outputConfig] = wallet.send.mock.calls[0];
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
			await ops.send(9, proofs).sendFactory(factory, [9]).keepFactory(factory, []).run();

			const [, , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'factory', factory, denominations: [9] },
				keep: { type: 'factory', factory, denominations: [] },
			});
		});

		it('supports sendCustom and keepCustom OutputTypes', async () => {
			// Just mock OutputData shape minimally; the builder only passes it through
			const mockData = [{ blindedMessage: { amount: 4 } }] as any;
			const mockKeep = [{ blindedMessage: { amount: 1 } }] as any;

			await ops.send(4, proofs).sendCustom(mockData).keepCustom(mockKeep).run();

			const [, , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig).toEqual({
				send: { type: 'custom', data: mockData },
				keep: { type: 'custom', data: mockKeep },
			});
		});

		it('when only keep is set, send defaults via wallet.defaultOutputType()', async () => {
			const defaultSpy = vi.spyOn(wallet, 'defaultOutputType');
			await ops.send(5, proofs).keepDeterministic(0, []).run();

			expect(defaultSpy).toHaveBeenCalled(); // send side filled by policy
			const [, , outputConfig] = wallet.send.mock.calls[0];
			expect(outputConfig.keep).toEqual({ type: 'deterministic', counter: 0, denominations: [] });
			// send is whatever defaultOutputType() returned
			expect(outputConfig.send).toEqual({ type: 'random' });
		});

		it('offlineExactOnly respects requireDleq=true', async () => {
			await ops.send(5, proofs).offlineExactOnly(true).run();

			const [, , cfg] = wallet.sendOffline.mock.calls[0];
			expect(cfg).toEqual({ includeFees: undefined, exactMatch: true, requireDleq: true });
		});

		it('includeFees() with no arg sets includeFees: true', async () => {
			await ops.send(5, proofs).includeFees().run();
			// default path (no OT) -> third arg is the config
			const [, , cfg] = wallet.send.mock.calls[0];
			expect(cfg).toEqual({ includeFees: true });
		});

		it('offlineCloseMatch honours includeFees: true', async () => {
			await ops.send(5, proofs).includeFees(true).offlineCloseMatch().run();

			const [, , cfg] = wallet.sendOffline.mock.calls[0];
			expect(cfg).toEqual({ includeFees: true, exactMatch: false, requireDleq: false });
		});
	});

	describe('ReceiveBuilder', () => {
		it('calls wallet.receive with config only when no OutputType was set', async () => {
			await ops.receive(token).requireDleq(true).keyset('kid').run();

			expect(wallet.receive).toHaveBeenCalledTimes(1);
			const [tok, config] = wallet.receive.mock.calls[0];
			expect(tok).toBe(token);
			expect(config).toEqual({ requireDleq: true, keysetId: 'kid' });
		});

		it('calls wallet.receive with custom OutputType and config', async () => {
			const cb = vi.fn();
			await ops
				.receive(token)
				.deterministic(0, [5])
				.privkey(['k1', 'k2'])
				.onCountersReserved(cb)
				.run();

			expect(wallet.receive).toHaveBeenCalledTimes(1);
			const [tok, outputType, config] = wallet.receive.mock.calls[0];

			expect(tok).toBe(token);
			expect(outputType).toEqual({ type: 'deterministic', counter: 0, denominations: [5] });
			expect(config).toMatchObject({ privkey: ['k1', 'k2'] });
			expect(typeof config.onCountersReserved).toBe('function');
		});

		it('supports factory() OutputType for receive', async () => {
			const factory = vi.fn();
			await ops.receive(token).factory(factory, [3, 2]).run();

			const [, outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'factory', factory, denominations: [3, 2] });
		});

		it('supports custom() OutputType for receive', async () => {
			const data = [{ blindedMessage: { amount: 5 } }] as any;
			await ops.receive(token).custom(data).run();

			const [, outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'custom', data });
		});

		it('privkey accepts string as well as string[]', async () => {
			await ops.receive(token).deterministic(0).privkey('single-key').run();

			const [, , config] = wallet.receive.mock.calls[0];
			expect(config).toMatchObject({ privkey: 'single-key' });
		});

		it('random() OutputType for receive with denominations', async () => {
			await ops.receive(token).random([1, 2, 3]).run();

			const [, outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({ type: 'random', denominations: [1, 2, 3] });
		});

		it('p2pk() OutputType for receive', async () => {
			await ops.receive(token).p2pk({ pubkey: 'PUB', locktime: 42 }, [7]).run();

			const [, outputType] = wallet.receive.mock.calls[0];
			expect(outputType).toEqual({
				type: 'p2pk',
				options: { pubkey: 'PUB', locktime: 42 },
				denominations: [7],
			});
		});

		it('proofsWeHave() is forwarded in receive config', async () => {
			const some = [{ amount: 1 } as any, { amount: 2 } as any];
			await ops.receive(token).deterministic(0).proofsWeHave(some).run();

			const [, , cfg] = wallet.receive.mock.calls[0];
			expect(cfg).toMatchObject({ proofsWeHave: some });
		});

		it('requireDleq() with no arg sets requireDleq: true', async () => {
			await ops.receive(token).requireDleq().run();

			const [, cfgOrOT, maybeCfg] = wallet.receive.mock.calls[0];
			// no OT path -> cfg is the second arg
			const cfg = maybeCfg ?? cfgOrOT;
			expect(cfg).toMatchObject({ requireDleq: true });
		});
	});

	describe('MintBuilder', () => {
		it('calls wallet.mintProofs with config only when no OutputType was set', async () => {
			await ops.mint(10, quote).keyset('kid').run();

			expect(wallet.mintProofs).toHaveBeenCalledTimes(1);
			const [amount, q, config] = wallet.mintProofs.mock.calls[0];

			expect(amount).toBe(10);
			expect(q).toBe(quote);
			expect(config).toEqual({ keysetId: 'kid' });
		});

		it('calls wallet.mintProofs with custom OutputType and config', async () => {
			await ops
				.mint(10, quote)
				.p2pk({ pubkey: 'P' }, [10])
				.privkey('sk')
				.onCountersReserved(() => {})
				.run();

			expect(wallet.mintProofs).toHaveBeenCalledTimes(1);
			const [amount, q, outputType, config] = wallet.mintProofs.mock.calls[0];

			expect(amount).toBe(10);
			expect(q).toBe(quote);
			expect(outputType).toEqual({ type: 'p2pk', options: { pubkey: 'P' }, denominations: [10] });
			expect(config).toMatchObject({ privkey: 'sk' });
			expect(typeof config.onCountersReserved).toBe('function');
		});

		it('supports factory() OutputType for mint', async () => {
			const factory = vi.fn();
			await ops.mint(8, quote).factory(factory, [8]).run();

			const [, , ot] = wallet.mintProofs.mock.calls[0];
			expect(ot).toEqual({ type: 'factory', factory, denominations: [8] });
		});

		it('supports custom() OutputType for mint', async () => {
			const data = [{ blindedMessage: { amount: 8 } }] as any;
			await ops.mint(8, quote).custom(data).run();

			const [, , ot] = wallet.mintProofs.mock.calls[0];
			expect(ot).toEqual({ type: 'custom', data });
		});

		it('random() OutputType for mint with denominations', async () => {
			await ops.mint(12, quote).random([12]).run();

			const [, , outputType] = wallet.mintProofs.mock.calls[0];
			expect(outputType).toEqual({ type: 'random', denominations: [12] });
		});

		it('proofsWeHave() is forwarded in mint config', async () => {
			const some = [{ amount: 3 } as any];
			await ops.mint(3, quote).deterministic(0).proofsWeHave(some).run();

			const [, , , cfg] = wallet.mintProofs.mock.calls[0];
			expect(cfg).toMatchObject({ proofsWeHave: some });
		});
	});
});
