import { CashuMint } from '../src/CashuMint';
import { CashuWallet } from '../src/CashuWallet';

import { test, describe, expect } from 'vitest';
import { vi } from 'vitest';
import { Proof } from '../src/model/types/index';
import ws from 'ws';
import { injectWebSocketImpl } from '../src/ws';
import { getEncodedToken } from '../src/utils';
import { bytesToHex } from '@noble/hashes/utils';
import is_prime_executable from './crypto/client/executables/is_prime_executable.json';
import { hashExecutableBytecode } from '../src/crypto/client/NUTXX';
import { createCairoDataPayload } from '../src/crypto/client/NUTXX';
import { init, terminate } from 'stwo-cairo';

const mintUrl = 'http://0.0.0.0:3338';
const unit = 'sat';

injectWebSocketImpl(ws);

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}

describe('cairo', () => {
	test('createCairoSend helper function', () => {
		const executable = JSON.stringify(is_prime_executable);
		const expectedOutput = 1;
		
		const cairoSend = createCairoDataPayload(executable, expectedOutput);
		
		expect(cairoSend).toHaveProperty('programHash');
		expect(cairoSend).toHaveProperty('outputHash');
		expect(typeof cairoSend.programHash).toBe('string');
		expect(typeof cairoSend.outputHash).toBe('string');
		
		const manualProgramHash = bytesToHex(hashExecutableBytecode(is_prime_executable.program.bytecode));
		expect(cairoSend.programHash).toBe(manualProgramHash);
		
		expect(cairoSend.outputHash).toMatch(/^[0-9a-f]{64}$/);
	});

	test(
		'send and receive with cairo',
		async () => {
			const mint = new CashuMint(mintUrl);
			const wallet = new CashuWallet(mint, { unit });

			// const programHash = bytesToHex(hashExecutableBytecode(is_prime_executable.program.bytecode));
			// const outputHash = bytesToHex(Uint8Array.from([1]));
			const request = await wallet.createMintQuote(128);
			const mintedProofs = await wallet.mintProofs(128, request.quote);

			const { send } = await wallet.send(64, mintedProofs, {
				cairoSend: { executable: JSON.stringify(is_prime_executable), expectedOutput: BigInt(1) },
			});
			const encoded = getEncodedToken({ mint: mintUrl, proofs: send });
			await init();
			const response = await wallet.receive(encoded, {
				cairoReceive: {
					executable: JSON.stringify(is_prime_executable),
					programInput: [BigInt(7)],
				},
			});
			console.log('Response:', response);
			terminate();
		},
		10 * 60 * 1000, // 10 minutes timeout
	);
});
