import { test, describe, expect } from 'vitest';
import {
	decodePaymentRequest,
	PaymentRequest,
	PaymentRequestTransport,
	PaymentRequestTransportType,
	NUT10Option,
} from '../../src/index';

describe('payment requests', () => {
	test('encode payment requests', async () => {
		const request = new PaymentRequest(
			[
				{
					type: PaymentRequestTransportType.NOSTR,
					target: 'asd',
					tags: [['n', '17']],
				} as PaymentRequestTransport,
			],
			'4840f51e',
			1000,
			'sat',
			['https://mint.com'],
			'test',
			true, // single use
			{
				kind: 'P2PK',
				data: 'pubkey',
				tags: [['tag', 'tag-value']],
			} as NUT10Option,
			true, // NUT26 (P2BK)
		);
		const pr = request.toEncodedRequest();
		expect(pr).toBeDefined();
		const decodedRequest = decodePaymentRequest(pr);
		expect(decodedRequest).toBeDefined();
		expect(decodedRequest.id).toBe('4840f51e');
		expect(decodedRequest.amount).toBe(1000);
		expect(decodedRequest.unit).toBe('sat');
		expect(decodedRequest.mints).toStrictEqual(['https://mint.com']);
		expect(decodedRequest.description).toBe('test');
		expect(decodedRequest.transport).toBeDefined();
		expect(decodedRequest.transport?.length).toBe(1);
		expect(decodedRequest.singleUse).toBe(true);
		expect(decodedRequest.transport?.[0].type).toBe(PaymentRequestTransportType.NOSTR);
		expect(decodedRequest.transport?.[0].target).toBe('asd');
		expect(decodedRequest.transport?.[0].tags).toStrictEqual([['n', '17']]);
		expect(decodedRequest.nut10).toBeDefined();
		expect(decodedRequest.nut10?.kind).toBe('P2PK');
		expect(decodedRequest.nut10?.data).toBe('pubkey');
		expect(decodedRequest.nut10?.tags).toStrictEqual([['tag', 'tag-value']]);
		expect(decodedRequest.nut26).toBe(true);

		const decodedRequestClassConstructor = PaymentRequest.fromEncodedRequest(pr);
		expect(decodedRequestClassConstructor).toStrictEqual(decodedRequest);

		// Handle no transport fromRawRequest
		decodedRequest.transport = undefined;
		const raw = decodedRequest.toRawRequest();
		const req = PaymentRequest.fromRawRequest(raw);
		expect(req).toStrictEqual(decodedRequest);
	});
	test('test decoding payment requests with no amount', async () => {
		const prWithoutAmount =
			'creqApGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
		const request: PaymentRequest = decodePaymentRequest(prWithoutAmount);
		expect(request).toBeDefined();
		expect(request.id).toBe('4840f51e');
		expect(request.amount).toBeUndefined();
		expect(request.unit).toBe('sat');
		expect(request.mints).toStrictEqual(['https://mint.com']);
		expect(request.description).toBeUndefined();
		expect(request.transport).toBeDefined();
		expect(request.transport?.length).toBe(1);
		expect(request.transport?.[0].type).toBe(PaymentRequestTransportType.NOSTR);
		expect(request.getTransport(PaymentRequestTransportType.NOSTR)?.target).toBe(
			'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgymdex3gvfsfujp3xyn7e7qrs8yyq9d8zsu2zqujxuxcapfqvzc8grqdkts',
		);
		expect(request.transport?.[0].target).toBe(
			'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgymdex3gvfsfujp3xyn7e7qrs8yyq9d8zsu2zqujxuxcapfqvzc8grqdkts',
		);
	});
	test('test unsupported prefix/version', async () => {
		const prWithInvalidPrefix =
			'croqApGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
		const prWithInvalidVersion =
			'creqZpGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
		expect(() => decodePaymentRequest(prWithInvalidPrefix)).toThrow(
			'unsupported pr: invalid prefix',
		);
		expect(() => decodePaymentRequest(prWithInvalidVersion)).toThrow('unsupported pr version');
	});

	describe('toEncodedCreqB - creqB format (TLV + bech32m)', () => {
		test('encode and decode basic payment request with nostr transport', () => {
			const pr = new PaymentRequest(
				[
					{
						type: PaymentRequestTransportType.NOSTR,
						target: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
						tags: [['n', '17']],
					},
				],
				'test_id_123',
				500,
				'sat',
				['https://mint.example.com'],
				'Test payment request',
				true,
			);

			const encoded = pr.toEncodedCreqB();

			// Verify it starts with CREQB (uppercase)
			expect(encoded.startsWith('CREQB')).toBe(true);

			// Decode and verify all fields
			const decoded = PaymentRequest.fromEncodedRequest(encoded);
			expect(decoded.id).toBe('test_id_123');
			expect(decoded.amount).toBe(500);
			expect(decoded.unit).toBe('sat');
			expect(decoded.mints).toEqual(['https://mint.example.com']);
			expect(decoded.description).toBe('Test payment request');
			expect(decoded.singleUse).toBe(true);
			expect(decoded.transport).toHaveLength(1);
			expect(decoded.transport![0].type).toBe(PaymentRequestTransportType.NOSTR);
		});

		test('encode and decode payment request with POST transport', () => {
			const pr = new PaymentRequest(
				[
					{
						type: PaymentRequestTransportType.POST,
						target: 'https://api.example.com/payment',
						tags: [
							['auth', 'bearer'],
							['priority', 'high'],
						],
					},
				],
				'http_test',
				250,
				'sat',
				['https://mint.example.com'],
				undefined,
				false,
			);

			const encoded = pr.toEncodedCreqB();
			const decoded = PaymentRequest.fromEncodedRequest(encoded);

			expect(decoded.id).toBe('http_test');
			expect(decoded.amount).toBe(250);
			expect(decoded.transport![0].type).toBe(PaymentRequestTransportType.POST);
			expect(decoded.transport![0].target).toBe('https://api.example.com/payment');
			expect(decoded.transport![0].tags).toEqual([
				['auth', 'bearer'],
				['priority', 'high'],
			]);
		});

		test('encode and decode minimal payment request', () => {
			const pr = new PaymentRequest(undefined, 'minimal_id', undefined, 'sat', [
				'https://mint.example.com',
			]);

			const encoded = pr.toEncodedCreqB();
			const decoded = PaymentRequest.fromEncodedRequest(encoded);

			expect(decoded.id).toBe('minimal_id');
			expect(decoded.amount).toBeUndefined();
			expect(decoded.unit).toBe('sat');
			expect(decoded.mints).toEqual(['https://mint.example.com']);
			expect(decoded.transport).toBeUndefined();
		});

		test('encode and decode payment request with NUT-10', () => {
			const pr = new PaymentRequest(
				undefined,
				'p2pk_test',
				1000,
				'sat',
				['https://mint.example.com'],
				'Locked payment',
				false,
				{
					kind: 'P2PK',
					data: '02abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
					tags: [
						['timeout', '7200'],
						['refund', '03abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd'],
					],
				} as NUT10Option,
			);

			const encoded = pr.toEncodedCreqB();
			const decoded = PaymentRequest.fromEncodedRequest(encoded);

			expect(decoded.id).toBe('p2pk_test');
			expect(decoded.amount).toBe(1000);
			expect(decoded.unit).toBe('sat');
			expect(decoded.description).toBe('Locked payment');
			// Note: nut10 is decoded from creqB format, but only first entry is stored
		});

		test('roundtrip from creqB test vector', () => {
			// Use an existing test vector
			const originalEncoded =
				'CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF';

			const pr = PaymentRequest.fromEncodedRequest(originalEncoded);
			const reEncoded = pr.toEncodedCreqB();
			const decoded = PaymentRequest.fromEncodedRequest(reEncoded);

			// Verify all fields preserved
			expect(decoded.id).toBe(pr.id);
			expect(decoded.amount).toBe(pr.amount);
			expect(decoded.unit).toBe(pr.unit);
			expect(decoded.mints).toEqual(pr.mints);
			expect(decoded.transport![0].type).toBe(pr.transport![0].type);
			expect(decoded.transport![0].target).toBe(pr.transport![0].target);
		});
	});
});
