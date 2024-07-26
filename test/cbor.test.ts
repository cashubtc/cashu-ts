import { decodeCBOR } from '../src/cbor';

const tests = [
	{
		cbor: 'AA==',
		hex: '00',
		roundtrip: true,
		decoded: 0
	},
	{
		cbor: 'AQ==',
		hex: '01',
		roundtrip: true,
		decoded: 1
	},
	{
		cbor: 'Cg==',
		hex: '0a',
		roundtrip: true,
		decoded: 10
	},
	{
		cbor: 'Fw==',
		hex: '17',
		roundtrip: true,
		decoded: 23
	},
	{
		cbor: 'GBg=',
		hex: '1818',
		roundtrip: true,
		decoded: 24
	},
	{
		cbor: 'GBk=',
		hex: '1819',
		roundtrip: true,
		decoded: 25
	},
	{
		cbor: 'GGQ=',
		hex: '1864',
		roundtrip: true,
		decoded: 100
	},
	{
		cbor: 'GQPo',
		hex: '1903e8',
		roundtrip: true,
		decoded: 1000
	},
	{
		cbor: 'GgAPQkA=',
		hex: '1a000f4240',
		roundtrip: true,
		decoded: 1000000
	},
	{
		cbor: 'GwAAAOjUpRAA',
		hex: '1b000000e8d4a51000',
		roundtrip: true,
		decoded: 1000000000000
	},
	{
		cbor: 'IA==',
		hex: '20',
		roundtrip: true,
		decoded: -1
	},
	{
		cbor: 'KQ==',
		hex: '29',
		roundtrip: true,
		decoded: -10
	},
	{
		cbor: 'OGM=',
		hex: '3863',
		roundtrip: true,
		decoded: -100
	},
	{
		cbor: 'OQPn',
		hex: '3903e7',
		roundtrip: true,
		decoded: -1000
	},
	{
		cbor: '+QAA',
		hex: 'f90000',
		roundtrip: true,
		decoded: 0.0
	},
	{
		cbor: '+TwA',
		hex: 'f93c00',
		roundtrip: true,
		decoded: 1.0
	},
	{
		cbor: '+z/xmZmZmZma',
		hex: 'fb3ff199999999999a',
		roundtrip: true,
		decoded: 1.1
	},
	{
		cbor: '+T4A',
		hex: 'f93e00',
		roundtrip: true,
		decoded: 1.5
	},
	{
		cbor: '+Xv/',
		hex: 'f97bff',
		roundtrip: true,
		decoded: 65504.0
	},
	{
		cbor: '+kfDUAA=',
		hex: 'fa47c35000',
		roundtrip: true,
		decoded: 100000.0
	},
	{
		cbor: '+n9///8=',
		hex: 'fa7f7fffff',
		roundtrip: true,
		decoded: 3.4028234663852886e38
	},
	{
		cbor: '+3435DyIAHWc',
		hex: 'fb7e37e43c8800759c',
		roundtrip: true,
		decoded: 1.0e300
	},
	{
		cbor: '+QAB',
		hex: 'f90001',
		roundtrip: true,
		decoded: 5.960464477539063e-8
	},
	{
		cbor: '+QQA',
		hex: 'f90400',
		roundtrip: true,
		decoded: 6.103515625e-5
	},
	{
		cbor: '+cQA',
		hex: 'f9c400',
		roundtrip: true,
		decoded: -4.0
	},
	{
		cbor: '+8AQZmZmZmZm',
		hex: 'fbc010666666666666',
		roundtrip: true,
		decoded: -4.1
	},
	{
		cbor: '9A==',
		hex: 'f4',
		roundtrip: true,
		decoded: false
	},
	{
		cbor: '9Q==',
		hex: 'f5',
		roundtrip: true,
		decoded: true
	},
	{
		cbor: '9g==',
		hex: 'f6',
		roundtrip: true,
		decoded: null
	},
	{
		cbor: 'YA==',
		hex: '60',
		roundtrip: true,
		decoded: ''
	},
	{
		cbor: 'YWE=',
		hex: '6161',
		roundtrip: true,
		decoded: 'a'
	},
	{
		cbor: 'ZElFVEY=',
		hex: '6449455446',
		roundtrip: true,
		decoded: 'IETF'
	},
	{
		cbor: 'YiJc',
		hex: '62225c',
		roundtrip: true,
		decoded: '"\\'
	},
	{
		cbor: 'YsO8',
		hex: '62c3bc',
		roundtrip: true,
		decoded: 'ü'
	},
	{
		cbor: 'Y+awtA==',
		hex: '63e6b0b4',
		roundtrip: true,
		decoded: '水'
	},
	{
		cbor: 'ZPCQhZE=',
		hex: '64f0908591',
		roundtrip: true,
		decoded: '𐅑'
	},
	{
		cbor: 'gA==',
		hex: '80',
		roundtrip: true,
		decoded: []
	},
	{
		cbor: 'gwECAw==',
		hex: '83010203',
		roundtrip: true,
		decoded: [1, 2, 3]
	},
	{
		cbor: 'gwGCAgOCBAU=',
		hex: '8301820203820405',
		roundtrip: true,
		decoded: [1, [2, 3], [4, 5]]
	},
	{
		cbor: 'mBkBAgMEBQYHCAkKCwwNDg8QERITFBUWFxgYGBk=',
		hex: '98190102030405060708090a0b0c0d0e0f101112131415161718181819',
		roundtrip: true,
		decoded: [
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
		]
	},
	{
		cbor: 'oA==',
		hex: 'a0',
		roundtrip: true,
		decoded: {}
	},
	{
		cbor: 'omFhAWFiggID',
		hex: 'a26161016162820203',
		roundtrip: true,
		decoded: {
			a: 1,
			b: [2, 3]
		}
	},
	{
		cbor: 'gmFhoWFiYWM=',
		hex: '826161a161626163',
		roundtrip: true,
		decoded: [
			'a',
			{
				b: 'c'
			}
		]
	},
	{
		cbor: 'pWFhYUFhYmFCYWNhQ2FkYURhZWFF',
		hex: 'a56161614161626142616361436164614461656145',
		roundtrip: true,
		decoded: {
			a: 'A',
			b: 'B',
			c: 'C',
			d: 'D',
			e: 'E'
		}
	}
];

describe('cbor decoder', () => {
	test.each(tests)('given $hex as arguments, returns $decoded', ({ hex, decoded }) => {
		//@ts-ignore
		const res = decodeCBOR(Buffer.from(hex, 'hex'));
		console.log(decoded);
		console.log(res);
		expect(res).toEqual(decoded);
	});
});
