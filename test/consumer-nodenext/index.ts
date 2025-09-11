import { Wallet, CashuWallet, CashuMint, createP2PKsecret } from '@cashu/cashu-ts';

const mintUrl = 'http://localhost:3338';
const mint = new CashuMint(mintUrl);
const wallet = new CashuWallet(mint);
const walletv3 = new Wallet(mintUrl);
const secret = createP2PKsecret('foo');
console.log(wallet, walletv3, secret);
