# Cashu TS

⚠️ **Don't be reckless:** This project is in early development, it does however work with real sats! Always use amounts you don't mind loosing.

Cashu TS is a JavaScript library for [Cashu](https://github.com/cashubtc) wallets written in Typescript.

Wallet Features:

- [x] connect to mint (load keys)
- [x] request minting tokens
- [x] minting tokens
- [x] sending tokens (get encoded token for chosen value)
- [x] receiving tokens
- [x] melting tokens
- [x] check if tokens are spent
- [ ] ...

## Usage

### Install

```shell
npm i @cashu/cashu-ts
```

### Import

```typescript
import { CashuMint, CashuWallet, getEncodedProofs } from '@cashu/cashu-ts';

const mint = new CashuMint('{MINT_HOST}', '{/path/to/api/root/}', '{MINT_PORT}');
const keys = await mint.getKeys();
const wallet = new CashuWallet(keys, mint);

const { pr, hash } = await wallet.requestMint(200);

//pay this LN invoice
console.log({ pr }, { hash });

async function invoiceHasBeenPaid() {
	const proofs = await wallet.requestTokens(200, hash);
	//Encoded proofs can be spent at the mint
	const encoded = getEncodedProofs(proofs);
	console.log(encoded);
}
```

## Contribute

Contributions are very welcome.

If you want to contribute, please open an Issue or a PR.
