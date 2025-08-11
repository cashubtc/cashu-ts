import { CashuWallet, CashuMint } from '@cashu/cashu-ts';
import { createP2PKsecret } from '@cashu/cashu-ts/crypto/client/NUT11';

const mintUrl = 'http://localhost:3338';
const mint = new CashuMint(mintUrl);
const wallet = new CashuWallet(mint);
console.log(CashuWallet, createP2PKsecret);
