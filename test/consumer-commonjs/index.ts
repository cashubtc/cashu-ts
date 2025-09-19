const { Wallet, createP2PKsecret } = require('@cashu/cashu-ts');
const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
const secret = createP2PKsecret('foo');
console.log(wallet, secret);
