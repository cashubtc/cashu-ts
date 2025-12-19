/**
 * This file tests the bech32m encoding for payment requests. This encoding scheme relies on bech32m
 * as well as the TLV encoding utils, so these tests cover both.
 *
 * Test vectors from NUT-26 specification.
 */

import { describe, test, expect } from 'vitest';
import { decodeBech32mToBytes, encodeBech32m } from '../../src/utils/bech32m';
import { decodeTLV, encodeTLV } from '../../src/utils/tlv';
import type { DecodedTLVPaymentRequest } from '../../src/utils/tlv';
import { PaymentRequest } from '../../src/model/PaymentRequest';
import { PaymentRequestTransportType } from '../../src/wallet/types/payment-requests';

describe('NUT-26 Test Vectors', () => {
	describe('Basic Payment Request', () => {
		const encoded =
			'CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF';

		const expected = {
			i: 'b7a90176',
			a: 10,
			u: 'sat',
			m: ['https://8333.space:3338'],
			t: [
				{
					t: 'nostr',
					a: 'nprofile1qqsgm6qfa3c8dtz2fvzhvfqeacmwm0e50pe3k5tfmvpjjmn0vj7m2tgpz3mhxue69uhhyetvv9ujuerpd46hxtnfduq3wamnwvaz7tmjv4kxz7fw8qenxvewwdcxzcm99uqs6amnwvaz7tmwdaejumr0ds4ljh7n',
					g: [['n', '17']],
				},
			],
		};

		test('decodeTLV parses payment request correctly', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.unit).toBe(expected.u);
			expect(decoded.mints).toEqual(expected.m);
			expect(decoded.transports).toHaveLength(1);
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
			expect(decoded.transports![0].tags).toEqual(expected.t[0].g);
		});

		test('PaymentRequest.fromEncodedRequest', () => {
			const pr = PaymentRequest.fromEncodedRequest(encoded);
			expect(pr.id).toBe(expected.i);
			expect(pr.amount).toBe(expected.a);
			expect(pr.unit).toBe(expected.u);
			expect(pr.mints).toEqual(expected.m);
			expect(pr.transport![0].type).toBe(expected.t[0].t);
			expect(pr.transport![0].target).toBe(expected.t[0].a);
		});
	});

	describe('Nostr Transport Payment Request', () => {
		const encoded =
			'CREQB1QYQQSE3EXFSN2VTZ8QPQQZQQQQQQQQQQQPJQXQQPQQZSQXTGW368QUE69UHK66TWWSCJUETCV9KHQMR99E3K7MG9QQVKSAR5WPEN5TE0D45KUAPJ9EJHSCTDWPKX2TNRDAKSWQPEQYQQZQQZQQSQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQRQQZSZMSZXYMSXQQ8Q9HQGWFHXV6SCAGZ48';

		const expected = {
			i: 'f92a51b8',
			a: 100,
			u: 'sat',
			m: ['https://mint1.example.com', 'https://mint2.example.com'],
			t: [
				{
					t: 'nostr',
					a: 'nprofile1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8uzqt',
					g: [
						['n', '17'],
						['n', '9735'],
					],
				},
			],
		};

		test('decodeTLV parses payment request with multiple mints', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.mints).toEqual(expected.m);
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
			expect(decoded.transports![0].tags).toEqual(expected.t[0].g);
		});
	});

	describe('Minimal Payment Request', () => {
		const encoded =
			'CREQB1QYQQSDMXX3SNYC3N8YPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYP0LHG';

		const expected = {
			i: '7f4a2b39',
			u: 'sat',
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses minimal payment request', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBeUndefined();
			expect(decoded.unit).toBe(expected.u);
			expect(decoded.mints).toEqual(expected.m);
			expect(decoded.transports).toBeUndefined();
		});
	});

	describe('Payment Request with NUT-10 Locking', () => {
		const encoded =
			'CREQB1QYQQSCEEV56R2EPJVYPQQZQQQQQQQQQQQ86QXQQPQQZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6ZQQTYQSQQGQQGQYYVPJVVEKYDTZVGERWEFNXCCNGDFHVVUNYEPEXDJRWWRYVSMNXEPNVS6NXDENXGCNZVRZXF3KVEFCVG6NQENZVVCXZCNRXCCN2EFEVVENXVGRQQXSWARFD4JK7AT5QSENVVPS2N5FAS';

		const expected = {
			i: 'c9e45d2a',
			a: 500,
			u: 'sat',
			m: ['https://mint.example.com'],
			nut10: {
				k: 'P2PK',
				d: '02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331',
				t: [['timeout', '3600']],
			},
		};

		test('decodeTLV parses payment request with NUT-10', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.mints).toEqual(expected.m);
			expect(decoded.nut10).toBeDefined();
			expect(decoded.nut10).toHaveLength(1);
			expect(decoded.nut10![0].kind).toBe(expected.nut10.k);
			expect(decoded.nut10![0].data).toBe(expected.nut10.d);
			expect(decoded.nut10![0].tags).toEqual(expected.nut10.t);
		});
	});

	describe('HTTP POST Transport (kind=0x01)', () => {
		const encoded =
			'CREQB1QYQQJ6R5W3C97AR9WD6QYQQGQQQQQQQQQQQ05QCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MG8QPQSZQQPQYPQQGNGW368QUE69UHKZURF9EJHSCTDWPKX2TNRDAKJ7A339ACXZ7TDV4H8GQCQZ5RXXATNW3HK6PNKV9K82EF3QEMXZMR4V5EQ9X3SJM';

		const expected = {
			i: 'http_test',
			a: 250,
			u: 'sat',
			m: ['https://mint.example.com'],
			t: [
				{
					t: 'post',
					a: 'https://api.example.com/v1/payment',
					g: [['custom', 'value1', 'value2']],
				},
			],
		};

		test('decodeTLV parses HTTP POST transport', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
			expect(decoded.transports![0].tags).toEqual(expected.t[0].g);
		});
	});

	describe('Relay Tag Extraction from nprofile', () => {
		const encoded =
			'CREQB1QYQQ5UN9D3SHJHM5V4EHGQSQPQQQQQQQQQQQQEQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQUQGZQGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7F39EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FJ9EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FN9EJHSCTDWPKX2TNRDAKSKRFDAR';

		const expected = {
			i: 'relay_test',
			a: 100,
			u: 'sat',
			m: ['https://mint.example.com'],
			t: [
				{
					t: 'nostr',
					a: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gprpmhxue69uhhyetvv9unztn90psk6urvv5hxxmmdqyv8wumn8ghj7un9d3shjv3wv4uxzmtsd3jjucm0d5q3samnwvaz7tmjv4kxz7fn9ejhsctdwpkx2tnrdaksxzjpjp',
				},
			],
		};

		test('decodeTLV parses relay tags from nprofile', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
		});
	});

	describe('Description Field', () => {
		const encoded =
			'CREQB1QYQQJER9WD347AR9WD6QYQQGQQQQQQQQQQQXGQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQV9GETNWSS8QCTED4JKUAPQV3JHXCMJD9C8G6T0DCFLJJRX';

		const expected = {
			i: 'desc_test',
			a: 100,
			u: 'sat',
			m: ['https://mint.example.com'],
			d: 'Test payment description',
		};

		test('decodeTLV parses description field', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.description).toBe(expected.d);
		});
	});

	describe('Single-Use Field (true)', () => {
		const encoded =
			'CREQB1QYQQ7UMFDENKCE2LW4EK2HM5WF6K2QSQPQQQQQQQQQQQQEQRQQQSQPQQQYQS2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGX0AYM7';

		const expected = {
			i: 'single_use_true',
			a: 100,
			u: 'sat',
			s: true,
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses single_use=true', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.singleUse).toBe(expected.s);
		});
	});

	describe('Single-Use Field (false)', () => {
		const encoded =
			'CREQB1QYQPQUMFDENKCE2LW4EK2HMXV9K8XEGZQQYQQQQQQQQQQQRYQVQQZQQYQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQ40L90';

		const expected = {
			i: 'single_use_false',
			a: 100,
			u: 'sat',
			s: false,
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses single_use=false', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.singleUse).toBe(expected.s);
		});
	});

	describe('Non-Sat Unit (msat)', () => {
		const encoded =
			'CREQB1QYQQJATWD9697MTNV96QYQQGQQQQQQQQQQP7SQCQQ3KHXCT5Q5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYYMU95';

		const expected = {
			i: 'unit_msat',
			a: 1000,
			u: 'msat',
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses msat unit', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.unit).toBe(expected.u);
		});
	});

	describe('Non-Sat Unit (usd)', () => {
		const encoded =
			'CREQB1QYQQSATWD9697ATNVSPQQZQQQQQQQQQQQ86QXQQRW4EKGPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDEPCJYC';

		const expected = {
			i: 'unit_usd',
			a: 500,
			u: 'usd',
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses usd unit', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.unit).toBe(expected.u);
		});
	});

	describe('Multiple Transports', () => {
		const encoded =
			'CREQB1QYQQ7MT4D36XJHM5WFSKUUMSDAE8GQSQPQQQQQQQQQQQRAQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQCQZQ5RP09KK2MN5YPMKJARGYPKH2MR5D9CXCEFQW3EXZMNNWPHHYARNQUQZ7QGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQ9Q9HQYVFHQUQZWQGQQYQSYQPQDP68GURN8GHJ7CTSDYCJUETCV9KHQMR99E3K7MF0WPSHJMT9DE6QWQP6QYQQZQGZQQSXSAR5WPEN5TE0V9CXJV3WV4UXZMTSD3JJUCM0D5HHQCTED4JKUAQRQQGQSURJD9HHY6T50YRXYCTRDD6HQTSH7TP';

		const expected = {
			i: 'multi_transport',
			a: 500,
			u: 'sat',
			m: ['https://mint.example.com'],
			d: 'Payment with multiple transports',
			t: [
				{
					t: 'nostr',
					a: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
					g: [['n', '17']],
				},
				{
					t: 'post',
					a: 'https://api1.example.com/payment',
				},
				{
					t: 'post',
					a: 'https://api2.example.com/payment',
					g: [['priority', 'backup']],
				},
			],
		};

		test('decodeTLV parses multiple transports', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.description).toBe(expected.d);
			expect(decoded.transports).toHaveLength(3);
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
			expect(decoded.transports![1].type).toBe(expected.t[1].t);
			expect(decoded.transports![1].target).toBe(expected.t[1].a);
			expect(decoded.transports![2].type).toBe(expected.t[2].t);
			expect(decoded.transports![2].target).toBe(expected.t[2].a);
			expect(decoded.transports![2].tags).toEqual(expected.t[2].g);
		});
	});

	describe('Minimal Nostr Transport (pubkey only)', () => {
		const encoded =
			'CREQB1QYQQ6MTFDE5K6CTVTAHX7UM5WGPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSWQP8QYQQZQQZQQSRHUXX8L9EX335Q7HE0F09AEJ04ZPAZPL0NE2CGUKYAWD24MAYT8G7QNXMQ';

		const expected = {
			i: 'minimal_nostr',
			u: 'sat',
			m: ['https://mint.example.com'],
			t: [
				{
					t: 'nostr',
					a: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
				},
			],
		};

		test('decodeTLV parses minimal nostr transport', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
		});
	});

	describe('Minimal HTTP POST Transport (URL only)', () => {
		const encoded =
			'CREQB1QYQQCMTFDE5K6CTVTA58GARSQVQQZQQ9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RSQ8SPQQQSZQSQZA58GARSWVAZ7TMPWP5JUETCV9KHQMR99E3K7MG0TWYGX';

		const expected = {
			i: 'minimal_http',
			u: 'sat',
			m: ['https://mint.example.com'],
			t: [
				{
					t: 'post',
					a: 'https://api.example.com',
				},
			],
		};

		test('decodeTLV parses minimal HTTP POST transport', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.transports![0].type).toBe(expected.t[0].t);
			expect(decoded.transports![0].target).toBe(expected.t[0].a);
		});
	});

	describe('NUT-10 HTLC Locking (kind=1)', () => {
		const encoded =
			'CREQB1QYQQJ6R5D3347AR9WD6QYQQGQQQQQQQQQQP7SQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQF5S4ZVGVSXCMMRDDJKGGRSV9UK6ETWWSYQPTGPQQQSZQSQGFS46VR9XCMRSV3SVFNXYDP3XGERZVNRVCMKZC3NV3JKYVP5X5UKXEFJ8QEXZVTZXQ6XVERPXUMX2CFKXQERVCFKXAJNGVTPV5ERVE3NV33SXQQ5PPKX7CMTW35K6EG2XYMNQVPSXQCRQVPSQVQY5PNJV4N82MNYGGCRXVEJ8QCKXVEHXCMNWETPXGMNXETZXUCNSVMZXUURXVPKXANR2V35XSUNXVM9VCMNSEPCVVEKVVF4VGCKZDEHVD3RYDPKXQUNJCEJXEJS4EHJHC';

		const expected = {
			i: 'htlc_test',
			a: 1000,
			u: 'sat',
			m: ['https://mint.example.com'],
			nut10: {
				k: 'HTLC',
				d: 'a]0e66820bfb412212cf7ab3deb0459ce282a1b04fda76ea6026a67e41ae26f3dc',
				t: [
					['locktime', '1700000000'],
					['refund', '033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e'],
				],
			},
		};

		test('decodeTLV parses HTLC locking with NUT-10', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.mints).toEqual(expected.m);
			expect(decoded.nut10).toBeDefined();
			expect(decoded.nut10).toHaveLength(1);
			expect(decoded.nut10![0].kind).toBe(expected.nut10.k);
			expect(decoded.nut10![0].data).toBe(expected.nut10.d);
			expect(decoded.nut10![0].tags).toEqual(expected.nut10.t);
		});
	});

	describe('Custom Currency Unit', () => {
		const encoded =
			'CREQB1QYQQKCM4WD6X7M2LW4HXJAQZQQYQQQQQQQQQQQRYQVQQXCN5VVZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6PZHCW8';

		const expected = {
			i: 'custom_unit',
			a: 100,
			u: 'btc',
			m: ['https://mint.example.com'],
		};

		test('decodeTLV parses custom currency unit', () => {
			const bytes = decodeBech32mToBytes(encoded);
			const decoded = decodeTLV(bytes);

			expect(decoded.id).toBe(expected.i);
			expect(decoded.amount).toBe(BigInt(expected.a));
			expect(decoded.unit).toBe(expected.u);
		});
	});
});

describe('NUT-26 Encoding Test Vectors', () => {
	describe('Basic Payment Request', () => {
		const expectedEncoded =
			'CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF';

		test('encodeTLV produces semantically equivalent encoding', () => {
			// First decode the original to get the correct structure
			const originalDecoded = decodeTLV(decodeBech32mToBytes(expectedEncoded.toLowerCase()));

			// Re-encode it
			const encoded = encodeTLV(originalDecoded);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			// Decode both versions and compare semantically
			const expectedDecoded = decodeTLV(decodeBech32mToBytes(expectedEncoded.toLowerCase()));
			const actualDecoded = decodeTLV(decodeBech32mToBytes(bech32Encoded));

			expect(actualDecoded).toEqual(expectedDecoded);
		});
	});

	describe('Nostr Transport Payment Request', () => {
		const expectedEncoded =
			'CREQB1QYQQSE3EXFSN2VTZ8QPQQZQQQQQQQQQQQPJQXQQPQQZSQXTGW368QUE69UHK66TWWSCJUETCV9KHQMR99E3K7MG9QQVKSAR5WPEN5TE0D45KUAPJ9EJHSCTDWPKX2TNRDAKSWQPEQYQQZQQZQQSQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQRQQZSZMSZXYMSXQQ8Q9HQGWFHXV6SCAGZ48';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'f92a51b8',
				amount: BigInt(100),
				unit: 'sat',
				mints: ['https://mint1.example.com', 'https://mint2.example.com'],
				transports: [
					{
						type: PaymentRequestTransportType.NOSTR,
						target: 'nprofile1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8uzqt',
						tags: [
							['n', '17'],
							['n', '9735'],
						],
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Minimal Payment Request', () => {
		const expectedEncoded =
			'CREQB1QYQQSDMXX3SNYC3N8YPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYP0LHG';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: '7f4a2b39',
				unit: 'sat',
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Payment Request with NUT-10 Locking', () => {
		const expectedEncoded =
			'CREQB1QYQQSCEEV56R2EPJVYPQQZQQQQQQQQQQQ86QXQQPQQZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6ZQQTYQSQQGQQGQYYVPJVVEKYDTZVGERWEFNXCCNGDFHVVUNYEPEXDJRWWRYVSMNXEPNVS6NXDENXGCNZVRZXF3KVEFCVG6NQENZVVCXZCNRXCCN2EFEVVENXVGRQQXSWARFD4JK7AT5QSENVVPS2N5FAS';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'c9e45d2a',
				amount: BigInt(500),
				unit: 'sat',
				mints: ['https://mint.example.com'],
				nut10: [
					{
						kind: 'P2PK',
						data: '02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331',
						tags: [['timeout', '3600']],
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('HTTP POST Transport (kind=0x01)', () => {
		const expectedEncoded =
			'CREQB1QYQQJ6R5W3C97AR9WD6QYQQGQQQQQQQQQQQ05QCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MG8QPQSZQQPQYPQQGNGW368QUE69UHKZURF9EJHSCTDWPKX2TNRDAKJ7A339ACXZ7TDV4H8GQCQZ5RXXATNW3HK6PNKV9K82EF3QEMXZMR4V5EQ9X3SJM';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'http_test',
				amount: BigInt(250),
				unit: 'sat',
				mints: ['https://mint.example.com'],
				transports: [
					{
						type: PaymentRequestTransportType.POST,
						target: 'https://api.example.com/v1/payment',
						tags: [['custom', 'value1', 'value2']],
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Relay Tag Extraction from nprofile', () => {
		const expectedEncoded =
			'CREQB1QYQQ5UN9D3SHJHM5V4EHGQSQPQQQQQQQQQQQQEQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQUQGZQGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7F39EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FJ9EJHSCTDWPKX2TNRDAKSXQQMQ9EPSAMNWVAZ7TMJV4KXZ7FN9EJHSCTDWPKX2TNRDAKSKRFDAR';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'relay_test',
				amount: BigInt(100),
				unit: 'sat',
				mints: ['https://mint.example.com'],
				transports: [
					{
						type: PaymentRequestTransportType.NOSTR,
						target:
							'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gprpmhxue69uhhyetvv9unztn90psk6urvv5hxxmmdqyv8wumn8ghj7un9d3shjv3wv4uxzmtsd3jjucm0d5q3samnwvaz7tmjv4kxz7fn9ejhsctdwpkx2tnrdaksxzjpjp',
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Description Field', () => {
		const expectedEncoded =
			'CREQB1QYQQJER9WD347AR9WD6QYQQGQQQQQQQQQQQXGQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQV9GETNWSS8QCTED4JKUAPQV3JHXCMJD9C8G6T0DCFLJJRX';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'desc_test',
				amount: BigInt(100),
				unit: 'sat',
				mints: ['https://mint.example.com'],
				description: 'Test payment description',
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Single-Use Field (true)', () => {
		const expectedEncoded =
			'CREQB1QYQQ7UMFDENKCE2LW4EK2HM5WF6K2QSQPQQQQQQQQQQQQEQRQQQSQPQQQYQS2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGX0AYM7';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'single_use_true',
				amount: BigInt(100),
				unit: 'sat',
				singleUse: true,
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Single-Use Field (false)', () => {
		const expectedEncoded =
			'CREQB1QYQPQUMFDENKCE2LW4EK2HMXV9K8XEGZQQYQQQQQQQQQQQRYQVQQZQQYQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQ40L90';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'single_use_false',
				amount: BigInt(100),
				unit: 'sat',
				singleUse: false,
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Non-Sat Unit (msat)', () => {
		const expectedEncoded =
			'CREQB1QYQQJATWD9697MTNV96QYQQGQQQQQQQQQQP7SQCQQ3KHXCT5Q5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSYYMU95';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'unit_msat',
				amount: BigInt(1000),
				unit: 'msat',
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Non-Sat Unit (usd)', () => {
		const expectedEncoded =
			'CREQB1QYQQSATWD9697ATNVSPQQZQQQQQQQQQQQ86QXQQRW4EKGPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDEPCJYC';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'unit_usd',
				amount: BigInt(500),
				unit: 'usd',
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Multiple Transports', () => {
		const expectedEncoded =
			'CREQB1QYQQ7MT4D36XJHM5WFSKUUMSDAE8GQSQPQQQQQQQQQQQRAQRQQQSQPGQRP58GARSWVAZ7TMDD9H8GTN90PSK6URVV5HXXMMDQCQZQ5RP09KK2MN5YPMKJARGYPKH2MR5D9CXCEFQW3EXZMNNWPHHYARNQUQZ7QGQQYQQYQPQ80CVV07TJDRRGPA0J7J7TMNYL2YR6YR7L8J4S3EVF6U64TH6GKWSXQQ9Q9HQYVFHQUQZWQGQQYQSYQPQDP68GURN8GHJ7CTSDYCJUETCV9KHQMR99E3K7MF0WPSHJMT9DE6QWQP6QYQQZQGZQQSXSAR5WPEN5TE0V9CXJV3WV4UXZMTSD3JJUCM0D5HHQCTED4JKUAQRQQGQSURJD9HHY6T50YRXYCTRDD6HQTSH7TP';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'multi_transport',
				amount: BigInt(500),
				unit: 'sat',
				mints: ['https://mint.example.com'],
				description: 'Payment with multiple transports',
				transports: [
					{
						type: PaymentRequestTransportType.NOSTR,
						target: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
						tags: [['n', '17']],
					},
					{
						type: PaymentRequestTransportType.POST,
						target: 'https://api1.example.com/payment',
					},
					{
						type: PaymentRequestTransportType.POST,
						target: 'https://api2.example.com/payment',
						tags: [['priority', 'backup']],
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Minimal Nostr Transport (pubkey only)', () => {
		const expectedEncoded =
			'CREQB1QYQQ6MTFDE5K6CTVTAHX7UM5WGPSQQGQQ5QPS6R5W3C8XW309AKKJMN59EJHSCTDWPKX2TNRDAKSWQP8QYQQZQQZQQSRHUXX8L9EX335Q7HE0F09AEJ04ZPAZPL0NE2CGUKYAWD24MAYT8G7QNXMQ';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'minimal_nostr',
				unit: 'sat',
				mints: ['https://mint.example.com'],
				transports: [
					{
						type: PaymentRequestTransportType.NOSTR,
						target: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('Minimal HTTP POST Transport (URL only)', () => {
		const expectedEncoded =
			'CREQB1QYQQCMTFDE5K6CTVTA58GARSQVQQZQQ9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RSQ8SPQQQSZQSQZA58GARSWVAZ7TMPWP5JUETCV9KHQMR99E3K7MG0TWYGX';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'minimal_http',
				unit: 'sat',
				mints: ['https://mint.example.com'],
				transports: [
					{
						type: PaymentRequestTransportType.POST,
						target: 'https://api.example.com',
					},
				],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});

	describe('NUT-10 HTLC Locking (kind=1)', () => {
		const expectedEncoded =
			'CREQB1QYQQJ6R5D3347AR9WD6QYQQGQQQQQQQQQQP7SQCQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQF5S4ZVGVSXCMMRDDJKGGRSV9UK6ETWWSYQPTGPQQQSZQSQGFS46VR9XCMRSV3SVFNXYDP3XGERZVNRVCMKZC3NV3JKYVP5X5UKXEFJ8QEXZVTZXQ6XVERPXUMX2CFKXQERVCFKXAJNGVTPV5ERVE3NV33SXQQ5PPKX7CMTW35K6EG2XYMNQVPSXQCRQVPSQVQY5PNJV4N82MNYGGCRXVEJ8QCKXVEHXCMNWETPXGMNXETZXUCNSVMZXUURXVPKXANR2V35XSUNXVM9VCMNSEPCVVEKVVF4VGCKZDEHVD3RYDPKXQUNJCEJXEJS4EHJHC';

		test('encodeTLV produces semantically equivalent encoding', () => {
			// First decode the original to get the correct structure
			const originalDecoded = decodeTLV(decodeBech32mToBytes(expectedEncoded.toLowerCase()));

			// Re-encode it
			const encoded = encodeTLV(originalDecoded);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			// Decode both versions and compare semantically
			const expectedDecoded = decodeTLV(decodeBech32mToBytes(expectedEncoded.toLowerCase()));
			const actualDecoded = decodeTLV(decodeBech32mToBytes(bech32Encoded));

			expect(actualDecoded).toEqual(expectedDecoded);
		});
	});

	describe('Custom Currency Unit', () => {
		const expectedEncoded =
			'CREQB1QYQQKCM4WD6X7M2LW4HXJAQZQQYQQQQQQQQQQQRYQVQQXCN5VVZSQXRGW368QUE69UHK66TWWSHX27RPD4CXCEFWVDHK6PZHCW8';

		test('encodeTLV produces correct encoding', () => {
			const request: DecodedTLVPaymentRequest = {
				id: 'custom_unit',
				amount: BigInt(100),
				unit: 'btc',
				mints: ['https://mint.example.com'],
			};

			const encoded = encodeTLV(request);
			const bech32Encoded = encodeBech32m('creqb', encoded);

			expect(bech32Encoded.toUpperCase()).toBe(expectedEncoded);
		});
	});
});
