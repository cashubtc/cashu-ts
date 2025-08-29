import { describe, expect, test, vi } from 'vitest';
import { createCairoSecret, hashExecutableBytecode } from '../../../src/crypto/client/NUTXX';
import { parseSecret } from '../../../src/crypto/common/NUT10';
import executable from './executables/is_prime_executable.json';
import { bytesToHex } from '@noble/hashes/utils';

type Felt252 = {
	value: string;
};
type Program = {
	bytecode: Array<Felt252>;
};
type Executable = {};

describe('test create cairo secret', () => {
	test('create secret from program hash ', async () => {
		let programHash = 'd2427325043dc712487cbba2c06374d87ebd27ac88e56d82af8d2745af253e81';
		const secret = createCairoSecret(programHash);
		const decodedSecret = parseSecret(secret);

		expect(decodedSecret[0]).toBe('Cairo');
		expect(Object.keys(decodedSecret[1]).includes('nonce')).toBe(true);
		expect(Object.keys(decodedSecret[1]).includes('data')).toBe(true);
	});
});

describe('test hash executable bytecode', () => {
	test('hash executable bytecode for is_prime_executable.json', async () => {
		let programHash = bytesToHex(hashExecutableBytecode(executable.program.bytecode));
		expect(programHash).toBe('b04a6409ba1d8ce2651c34759204f14de821928dd667ff38ecdc4ce2006668ba');
	});
});
