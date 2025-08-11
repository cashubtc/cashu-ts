const { CashuWallet, CashuMint } = require('@cashu/cashu-ts');
const { createP2PKsecret } = require('@cashu/cashu-ts/crypto/client/NUT11');

const mint = new CashuMint('http://localhost:3338');
const wallet = new CashuWallet(mint);
console.log(CashuWallet, createP2PKsecret);
