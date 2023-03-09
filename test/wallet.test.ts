import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import { decode } from '@gandlaf21/bolt11-decode';
import axios from 'axios';

// Mock jest and set the type
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('test fees', () => {
	test('test get fees', async () => {
		const mint = new CashuMint('https://legend.lnbits.com', 'cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC');
		const invoice =
			'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

		mockedAxios.get.mockResolvedValueOnce({ data: {} });
		const keys = await mint.getKeys();
		const wallet = new CashuWallet(keys, mint);

		mockedAxios.post.mockResolvedValueOnce({ data: { fee: 20 } });
		const fee = await wallet.getFee(invoice);
		const amount = decode(invoice).sections[2].value / 1000;
		expect(fee + amount).toEqual(2020);
	});
});
