/**
 * This file tests TLV encoding/decoding roundtrip functionality. It takes test vectors, decodes
 * them, re-encodes them, and verifies the output matches.
 *
 * Test vectors from NUT-26 specification.
 */

import { describe, test, expect } from 'vitest';
import { decodeBech32mToBytes, encodeBech32m } from '../../src/utils/bech32m';
import { decodeTLV, encodeTLV } from '../../src/utils/tlv';
import type { DecodedTLVPaymentRequest } from '../../src/utils/tlv';

/**
 * Helper function to perform roundtrip test:
 *
 * 1. Decode the bech32m encoded string to TLV bytes.
 * 2. Decode TLV bytes to payment request object.
 * 3. Re-encode payment request object to TLV bytes.
 * 4. Decode the re-encoded TLV bytes.
 * 5. Compare original and final decoded objects.
 */
function testRoundtrip(encoded: string, description: string) {
	// Step 1: Decode original
	const originalBytes = decodeBech32mToBytes(encoded.toLowerCase());
	const originalDecoded = decodeTLV(originalBytes);

	// Step 2: Re-encode
	const reEncodedBytes = encodeTLV(originalDecoded);

	// Step 3: Decode re-encoded
	const finalDecoded = decodeTLV(reEncodedBytes);

	// Step 4: Compare
	expect(finalDecoded).toEqual(originalDecoded);

	// Also verify bech32m roundtrip
	const reEncodedBech32 = encodeBech32m('creqb', reEncodedBytes);
	const finalBytes = decodeBech32mToBytes(reEncodedBech32);
	const finalFromBech32 = decodeTLV(finalBytes);
	expect(finalFromBech32).toEqual(originalDecoded);
}

describe('TLV Encoding/Decoding Roundtrip Tests', () => {
	describe('Basic Payment Request', () => {
		const encoded =
			'CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF';

		test('roundtrip basic payment request', () => {
			testRoundtrip(encoded, 'Basic payment request with nostr transport');
		});

		test('manual verification of fields', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe('b7a90176');
			expect(decoded.amount).toBe(BigInt(10));
			expect(decoded.unit).toBe('sat');
			expect(decoded.mints).toEqual(['https://8333.space:3338']);
			expect(decoded.transports).toHaveLength(1);
			expect(decoded.transports![0].type).toBe('nostr');

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.id).toBe(decoded.id);
			expect(finalDecoded.amount).toBe(decoded.amount);
			expect(finalDecoded.unit).toBe(decoded.unit);
			expect(finalDecoded.mints).toEqual(decoded.mints);
		});
	});

	describe('Nostr Transport Payment Request', () => {
		const encoded =
			'CREQB1QYQQSE3EXFSN2VTZ8QPQQZQQQQQQQQQQQPJQXQQPQQZSQXTGW368QUE69UHK66TWWSCJUETCV9KHQMR99E3K7MG9QQVKSAR5WPEN5TE0D45KUAPJ9EJHSCTDWPKX2TNRDAKSWQPEQYQQZQQZQQSQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQRQQZSZMSZXYMSXQQ8Q9HQGWFHXV6SCAGZ48';

		test('roundtrip nostr transport with multiple mints', () => {
			testRoundtrip(encoded, 'Payment request with multiple mints and nostr transport');
		});
	});

	describe('Minimal Payment Request', () => {
		const encoded =
			'CREQB1QYQQSDMXX3SNYC3N8YPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYP0LHG';

		test('roundtrip minimal payment request', () => {
			testRoundtrip(encoded, 'Minimal payment request (no amount, no transport)');
		});
	});

	describe('Payment Request with NUT-10 Locking', () => {
		const encoded =
			'CREQB1QYQQSCEEV56R2EPJVYPQQZQQQQQQQQQQQ86QXQQPQQZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6ZQQTYQSQQGQQGQYYVPJVVEKYDTZVGERWEFNXCCNGDFHVVUNYEPEXDJRWWRYVSMNXEPNVS6NXDENXGCNZVRZXF3KVEFCVG6NQENZVVCXZCNRXCCN2EFEVVENXVGRQQXSWARFD4JK7AT5QSENVVPS2N5FAS';

		test('roundtrip payment request with NUT-10 P2PK', () => {
			testRoundtrip(encoded, 'Payment request with NUT-10 P2PK locking');
		});

		test('verify NUT-10 fields', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.nut10).toBeDefined();
			expect(decoded.nut10).toHaveLength(1);
			expect(decoded.nut10![0].kind).toBe('P2PK');
			expect(decoded.nut10![0].data).toBe(
				'02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331',
			);
			expect(decoded.nut10![0].tags).toEqual([['timeout', '3600']]);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.nut10).toEqual(decoded.nut10);
		});
	});

	describe('HTTP POST Transport (kind=0x01)', () => {
		const encoded =
			'CREQB1QYQQJ6R5W3C97AR9WD6QYQQGQQQQQQQQQQQ05QCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MG8QPQSZQQPQYPQQGNGW368QUE69UHKZURF9EJHSCTDWPKX2TNRDAKJ7A339ACXZ7TDV4H8GQCQZ5RXXATNW3HK6PNKV9K82EF3QEMXZMR4V5EQ9X3SJM';

		test('roundtrip HTTP POST transport', () => {
			testRoundtrip(encoded, 'Payment request with HTTP POST transport');
		});

		test('verify POST transport with tags', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.transports).toHaveLength(1);
			expect(decoded.transports![0].type).toBe('post');
			expect(decoded.transports![0].target).toBe('https://api.example.com/v1/payment');
			expect(decoded.transports![0].tags).toEqual([['custom', 'value1', 'value2']]);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.transports).toEqual(decoded.transports);
		});
	});

	describe('Relay Tag Extraction from nprofile', () => {
		const encoded =
			'CREQB1QYQQ5UN9D3SHJHM5V4EHGQSQPQQQQQQQQQQQQEQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQUQGZQGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7F39EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FJ9EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FN9EJHSCTDWPKX2TNRDAKSKRFDAR';

		test('roundtrip with relay tags from nprofile', () => {
			testRoundtrip(encoded, 'Payment request with relay tags extracted from nprofile');
		});
	});

	describe('Description Field', () => {
		const encoded =
			'CREQB1QYQQJER9WD347AR9WD6QYQQGQQQQQQQQQQQXGQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQV9GETNWSS8QCTED4JKUAPQV3JHXCMJD9C8G6T0DCFLJJRX';

		test('roundtrip with description field', () => {
			testRoundtrip(encoded, 'Payment request with description');
		});

		test('verify description content', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.description).toBe('Test payment description');

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.description).toBe(decoded.description);
		});
	});

	describe('Single-Use Field (true)', () => {
		const encoded =
			'CREQB1QYQQ7UMFDENKCE2LW4EK2HM5WF6K2QSQPQQQQQQQQQQQQEQRQQQSQPQQQYQS2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGX0AYM7';

		test('roundtrip single_use=true', () => {
			testRoundtrip(encoded, 'Payment request with single_use=true');
		});

		test('verify single_use flag', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.singleUse).toBe(true);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.singleUse).toBe(true);
		});
	});

	describe('Single-Use Field (false)', () => {
		const encoded =
			'CREQB1QYQPQUMFDENKCE2LW4EK2HMXV9K8XEGZQQYQQQQQQQQQQQRYQVQQZQQYQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQ40L90';

		test('roundtrip single_use=false', () => {
			testRoundtrip(encoded, 'Payment request with single_use=false');
		});

		test('verify single_use=false flag', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.singleUse).toBe(false);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.singleUse).toBe(false);
		});
	});

	describe('Non-Sat Unit (msat)', () => {
		const encoded =
			'CREQB1QYQQJATWD9697MTNV96QYQQGQQQQQQQQQQP7SQCQQ3KHXCT5Q5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYYMU95';

		test('roundtrip msat unit', () => {
			testRoundtrip(encoded, 'Payment request with msat unit');
		});
	});

	describe('Non-Sat Unit (usd)', () => {
		const encoded =
			'CREQB1QYQQSATWD9697ATNVSPQQZQQQQQQQQQQQ86QXQQRW4EKGPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDEPCJYC';

		test('roundtrip usd unit', () => {
			testRoundtrip(encoded, 'Payment request with usd unit');
		});
	});

	describe('Multiple Transports', () => {
		const encoded =
			'CREQB1QYQQ7MT4D36XJHM5WFSKUUMSDAE8GQSQPQQQQQQQQQQQRAQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQCQZQ5RP09KK2MN5YPMKJARGYPKH2MR5D9CXCEFQW3EXZMNNWPHHYARNQUQZ7QGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQ9Q9HQYVFHQUQZWQGQQYQSYQPQDP68GURN8GHJ7CTSDYCJUETCV9KHQMR99E3K7MF0WPSHJMT9DE6QWQP6QYQQZQGZQQSXSAR5WPEN5TE0V9CXJV3WV4UXZMTSD3JJUCM0D5HHQCTED4JKUAQRQQGQSURJD9HHY6T50YRXYCTRDD6HQTSH7TP';

		test('roundtrip multiple transports', () => {
			testRoundtrip(encoded, 'Payment request with multiple transports (nostr + 2 POST)');
		});

		test('verify all transports preserved', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.transports).toHaveLength(3);
			expect(decoded.transports![0].type).toBe('nostr');
			expect(decoded.transports![1].type).toBe('post');
			expect(decoded.transports![2].type).toBe('post');
			expect(decoded.transports![2].tags).toEqual([['priority', 'backup']]);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.transports).toEqual(decoded.transports);
		});
	});

	describe('Minimal Nostr Transport (pubkey only)', () => {
		const encoded =
			'CREQB1QYQQ6MTFDE5K6CTVTAHX7UM5WGPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSWQP8QYQQZQQZQQSRHUXX8L9EX335Q7HE0F09AEJ04ZPAZPL0NE2CGUKYAWD24MAYT8G7QNXMQ';

		test('roundtrip minimal nostr transport', () => {
			testRoundtrip(encoded, 'Minimal nostr transport with pubkey only');
		});
	});

	describe('Minimal HTTP POST Transport (URL only)', () => {
		const encoded =
			'CREQB1QYQQCMTFDE5K6CTVTA58GARSQVQQZQQ9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RSQ8SPQQQSZQSQZA58GARSWVAZ7TMPWP5JUETCV9KHQMR99E3K7MG0TWYGX';

		test('roundtrip minimal HTTP POST transport', () => {
			testRoundtrip(encoded, 'Minimal HTTP POST transport with URL only');
		});
	});

	describe('NUT-10 HTLC Locking (kind=1)', () => {
		const encoded =
			'CREQB1QYQQJ6R5D3347AR9WD6QYQQGQQQQQQQQQQP7SQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQF5S4ZVGVSXCMMRDDJKGGRSV9UK6ETWWSYQPTGPQQQSZQSQGFS46VR9XCMRSV3SVFNXYDP3XGERZVNRVCMKZC3NV3JKYVP5X5UKXEFJ8QEXZVTZXQ6XVERPXUMX2CFKXQERVCFKXAJNGVTPV5ERVE3NV33SXQQ5PPKX7CMTW35K6EG2XYMNQVPSXQCRQVPSQVQY5PNJV4N82MNYGGCRXVEJ8QCKXVEHXCMNWETPXGMNXETZXUCNSVMZXUURXVPKXANR2V35XSUNXVM9VCMNSEPCVVEKVVF4VGCKZDEHVD3RYDPKXQUNJCEJXEJS4EHJHC';

		test('roundtrip HTLC locking with NUT-10', () => {
			testRoundtrip(encoded, 'Payment request with NUT-10 HTLC locking');
		});

		test('verify HTLC fields', () => {
			const bytes = decodeBech32mToBytes(encoded.toLowerCase());
			const decoded = decodeTLV(bytes);

			expect(decoded.nut10).toBeDefined();
			expect(decoded.nut10![0].kind).toBe('HTLC');
			expect(decoded.nut10![0].tags).toHaveLength(2);

			const reEncoded = encodeTLV(decoded);
			const finalDecoded = decodeTLV(reEncoded);

			expect(finalDecoded.nut10![0].kind).toBe(decoded.nut10![0].kind);
			expect(finalDecoded.nut10![0].data).toBe(decoded.nut10![0].data);
			expect(finalDecoded.nut10![0].tags).toEqual(decoded.nut10![0].tags);
		});
	});

	describe('Custom Currency Unit', () => {
		const encoded =
			'CREQB1QYQQKCM4WD6X7M2LW4HXJAQZQQYQQQQQQQQQQQRYQVQQXCN5VVZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6PZHCW8';

		test('roundtrip custom currency unit (btc)', () => {
			testRoundtrip(encoded, 'Payment request with btc unit');
		});
	});

	describe('Manual Construction and Encoding', () => {
		test('encode from scratch - minimal request', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'test123',
				unit: 'sat',
				mints: ['https://mint.test.com'],
			};

			const encoded = encodeTLV(request);
			const decoded = decodeTLV(encoded);

			expect(decoded.id).toBe(request.id);
			expect(decoded.unit).toBe(request.unit);
			expect(decoded.mints).toEqual(request.mints);
			expect(decoded.amount).toBeUndefined();
			expect(decoded.transports).toBeUndefined();
		});

		test('encode from scratch - full request with nostr', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'full_test',
				amount: BigInt(1000),
				unit: 'sat',
				singleUse: true,
				mints: ['https://mint1.com', 'https://mint2.com'],
				description: 'Test payment',
				transports: [
					{
						type: 'nostr' as const,
						target: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
						tags: [['n', '17']],
					},
				],
			};

			const encoded = encodeTLV(request);
			const decoded = decodeTLV(encoded);

			expect(decoded).toEqual(request);
		});

		test('encode from scratch - POST transport with tags', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'post_test',
				amount: BigInt(500),
				unit: 'sat',
				mints: ['https://mint.com'],
				transports: [
					{
						type: 'post' as any,
						target: 'https://api.test.com/payment',
						tags: [
							['auth', 'bearer'],
							['priority', 'high'],
						],
					},
				],
			};

			const encoded = encodeTLV(request);
			const decoded = decodeTLV(encoded);

			expect(decoded).toEqual(request);
		});

		test('encode from scratch - NUT-10 P2PK', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'p2pk_test',
				amount: BigInt(250),
				unit: 'sat',
				mints: ['https://mint.com'],
				nut10: [
					{
						kind: 'P2PK',
						data: '02abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
						tags: [
							['timeout', '7200'],
							['refund', '03abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd'],
						],
					},
				],
			};

			const encoded = encodeTLV(request);
			const decoded = decodeTLV(encoded);

			expect(decoded).toEqual(request);
		});

		test('encode from scratch - empty optional fields omitted', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'omit_test',
				unit: 'sat',
				mints: ['https://mint.com'],
				transports: [], // Empty array should be omitted
				nut10: [], // Empty array should be omitted
			};

			const encoded = encodeTLV(request);
			const decoded = decodeTLV(encoded);

			expect(decoded.id).toBe(request.id);
			expect(decoded.unit).toBe(request.unit);
			expect(decoded.mints).toEqual(request.mints);
			expect(decoded.transports).toBeUndefined(); // Should be omitted
			expect(decoded.nut10).toBeUndefined(); // Should be omitted
		});
	});
});
