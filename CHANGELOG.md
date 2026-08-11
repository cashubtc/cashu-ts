# Changelog

## [5.0.0-rc.5](https://github.com/cashubtc/cashu-ts/compare/v5.0.0-rc.4...v5.0.0-rc.5) (2026-07-23)


### ⚠ BREAKING CHANGES

* nut-18 mint preferences (mp, sm) ([#683](https://github.com/cashubtc/cashu-ts/issues/683))

### Features

* **crypto:** public secp pubkey validation in curve_secp ([#863](https://github.com/cashubtc/cashu-ts/issues/863)) ([f92facd](https://github.com/cashubtc/cashu-ts/commit/f92facd37fe3a02624b533c11b2abd5e165c7ffd))
* **model:** add MintInfo.getMintMeltMethod and document offline rehydration ([#812](https://github.com/cashubtc/cashu-ts/issues/812)) ([bc151c9](https://github.com/cashubtc/cashu-ts/commit/bc151c9913ee35279a8e0560ee249295aa5caa0a))
* **model:** encode and decode NUT-18 payment payloads ([#853](https://github.com/cashubtc/cashu-ts/issues/853)) ([ad68742](https://github.com/cashubtc/cashu-ts/commit/ad68742c28fada9f849610bb5313dce7fb254d87))
* nut-18 mint preferences (mp, sm) ([#683](https://github.com/cashubtc/cashu-ts/issues/683)) ([65cb30e](https://github.com/cashubtc/cashu-ts/commit/65cb30ea0be8398f30c42e317653a441f333ea5c))
* **nut18:** add PaymentRequestBuilder ([#780](https://github.com/cashubtc/cashu-ts/issues/780)) ([49f6034](https://github.com/cashubtc/cashu-ts/commit/49f6034f7596671b5c060a5006be473982e93829))
* **nut18:** pay and validate payment requests end to end ([#787](https://github.com/cashubtc/cashu-ts/issues/787)) ([2c218f4](https://github.com/cashubtc/cashu-ts/commit/2c218f434542b5c105f5c374cbbb76fc5bb57382))
* **utils:** rename normalizeUrl to normalizeMintUrl and make it public ([#834](https://github.com/cashubtc/cashu-ts/issues/834)) ([415cadb](https://github.com/cashubtc/cashu-ts/commit/415cadb6f5a08e62ccd912665a485e3a93884b33))
* **wallet:** add getFeesToInclude fee helper ([#846](https://github.com/cashubtc/cashu-ts/issues/846)) ([7f69e49](https://github.com/cashubtc/cashu-ts/commit/7f69e4940000d2425bd0256c89f9bd330ec46154))
* **wallet:** prefer newest keyset version in getCheapestKeyset ([#835](https://github.com/cashubtc/cashu-ts/issues/835)) ([73a7667](https://github.com/cashubtc/cashu-ts/commit/73a7667f6855f08d07ece54f3806b89f36b0dbd1))
* **wallet:** prefer stale keysets in default proof selection ([#813](https://github.com/cashubtc/cashu-ts/issues/813)) ([9c8688c](https://github.com/cashubtc/cashu-ts/commit/9c8688c3c44248e0a76e2a95e9ef3cdc9282f58d))
* **wallet:** support u64 amounts in proof selection ([#822](https://github.com/cashubtc/cashu-ts/issues/822)) ([42c97e3](https://github.com/cashubtc/cashu-ts/commit/42c97e3cebc74408d74499a11af7a879885828d1))


### Bug Fixes

* **auth:** tidy the OIDC debug logging ([#883](https://github.com/cashubtc/cashu-ts/issues/883)) ([553439c](https://github.com/cashubtc/cashu-ts/commit/553439c9d1e6b4cee23d9423c4fd4f55a6d51659))
* **crypto:** bound untrusted P2PK witness and CBOR decode input ([#874](https://github.com/cashubtc/cashu-ts/issues/874)) ([e8b5c1e](https://github.com/cashubtc/cashu-ts/commit/e8b5c1e826411f20b39a917f3708112af821c88c))
* **crypto:** harden P2PK witness edge cases ([#877](https://github.com/cashubtc/cashu-ts/issues/877)) ([13d69fa](https://github.com/cashubtc/cashu-ts/commit/13d69fa97802d3d05f3330c5a7e8aa1c6d1cd67d))
* **model:** bound Amount.from to the u64 range ([#830](https://github.com/cashubtc/cashu-ts/issues/830)) ([d9162e7](https://github.com/cashubtc/cashu-ts/commit/d9162e79d9589898103bf278279165634162f67c))
* **model:** cap Amount at the u64 range ([#832](https://github.com/cashubtc/cashu-ts/issues/832)) ([1c959da](https://github.com/cashubtc/cashu-ts/commit/1c959da1b20a8e389e730e1070646f661da93775))
* **model:** preserve Amount instances through MintInfo snapshot ([#826](https://github.com/cashubtc/cashu-ts/issues/826)) ([ff12b31](https://github.com/cashubtc/cashu-ts/commit/ff12b31931f15e63549e3b0f1b58c0aaece35a35))
* **utils:** bound splitAmount output count ([#859](https://github.com/cashubtc/cashu-ts/issues/859)) ([8c7549b](https://github.com/cashubtc/cashu-ts/commit/8c7549bbda9124df85470f831d8918f6d0fe66ce))
* **utils:** return false from isValidHex for non-string input ([#843](https://github.com/cashubtc/cashu-ts/issues/843)) ([605b506](https://github.com/cashubtc/cashu-ts/commit/605b506bb8c770c413e29c79ac1f8c251417e47b))
* **wallet:** bound fee convergence loop ([#854](https://github.com/cashubtc/cashu-ts/issues/854)) ([308b3cd](https://github.com/cashubtc/cashu-ts/commit/308b3cd8ca310c0d954d30b57ebc3b179ae39023))
* **wallet:** bound keyset denomination count at ingest ([#864](https://github.com/cashubtc/cashu-ts/issues/864)) ([697211a](https://github.com/cashubtc/cashu-ts/commit/697211a926bdbeab939cc27b1e23a9923d46ea7c))
* **wallet:** classify odd-length hex keyset ids as legacy ([#839](https://github.com/cashubtc/cashu-ts/issues/839)) ([5f14fd4](https://github.com/cashubtc/cashu-ts/commit/5f14fd41a3f0b63f2d6744976a01ee55201ba7cf))
* **wallet:** compute keyset fees with integer arithmetic ([#869](https://github.com/cashubtc/cashu-ts/issues/869)) ([8ad6129](https://github.com/cashubtc/cashu-ts/commit/8ad6129c5f48142df0808711b28797573ec25432))
* **wallet:** more debug log tidy-up ([#881](https://github.com/cashubtc/cashu-ts/issues/881)) ([72bae37](https://github.com/cashubtc/cashu-ts/commit/72bae3709bbd573836fb5df588a0132f40f44d38))
* **wallet:** reject a missing pubkey in locked mint quotes ([#856](https://github.com/cashubtc/cashu-ts/issues/856)) ([40b24ab](https://github.com/cashubtc/cashu-ts/commit/40b24aba7144081ea6176a1e2dd2a35b6f187031))
* **wallet:** return -1 from Keyset.version for unparseable ids ([#837](https://github.com/cashubtc/cashu-ts/issues/837)) ([832b467](https://github.com/cashubtc/cashu-ts/commit/832b467848d3d4c7e89b89b70a8a07a7e8bd7c3a))
* **wallet:** throw from sendOffline when no offline selection matches ([#871](https://github.com/cashubtc/cashu-ts/issues/871)) ([966beaf](https://github.com/cashubtc/cashu-ts/commit/966beaf16ef4cefdcc6f453a9eaa0135241e0078))
* **wallet:** tidy diagnostic log output ([#879](https://github.com/cashubtc/cashu-ts/issues/879)) ([a9089bd](https://github.com/cashubtc/cashu-ts/commit/a9089bdb3d9bad61d48877014f59b2bbf2bb9573))
* **wallet:** validate pubkey in locked mint quote responses ([#851](https://github.com/cashubtc/cashu-ts/issues/851)) ([74435fe](https://github.com/cashubtc/cashu-ts/commit/74435fe91dae1bda73e651ce0ea8b30ffcc783aa))
* **wallet:** validate the lock pubkey in mint quote methods ([#861](https://github.com/cashubtc/cashu-ts/issues/861)) ([f5148fd](https://github.com/cashubtc/cashu-ts/commit/f5148fd27f5c600155b62d7dec905c77bff5c274))
* **wallet:** verify the lock pubkey on generic mint quotes ([#875](https://github.com/cashubtc/cashu-ts/issues/875)) ([b749d82](https://github.com/cashubtc/cashu-ts/commit/b749d828856609f8487e3785f766ae43df5d7c79))
* **wallet:** widen exact-match trim bound for selection-level fee rounding ([#814](https://github.com/cashubtc/cashu-ts/issues/814)) ([78e1180](https://github.com/cashubtc/cashu-ts/commit/78e1180ffbbf44c45d25aefccd238b222f02ec6d))

## [5.0.0-rc.4](https://github.com/cashubtc/cashu-ts/compare/v5.0.0-rc.3...v5.0.0-rc.4) (2026-07-17)


### ⚠ BREAKING CHANGES

* **wallet:** pooled batch restore with config object and spent filtering ([#795](https://github.com/cashubtc/cashu-ts/issues/795))
* **p2pk:** require compressed, on-curve pubkeys ([#781](https://github.com/cashubtc/cashu-ts/issues/781))

### Features

* **wallet:** pooled batch restore with config object and spent filtering ([#795](https://github.com/cashubtc/cashu-ts/issues/795)) ([0bc004b](https://github.com/cashubtc/cashu-ts/commit/0bc004bcfad309a3562beb4334588d0c4276f5bd))
* **wallet:** restore every keyset in one call with restoreAll ([#797](https://github.com/cashubtc/cashu-ts/issues/797)) ([b319326](https://github.com/cashubtc/cashu-ts/commit/b3193262b7f2ab1d5e171485ae41a8e15eec0d95))


### Bug Fixes

* **crypto:** validate counter range in BIP-32 secret derivation ([#806](https://github.com/cashubtc/cashu-ts/issues/806)) ([e61c064](https://github.com/cashubtc/cashu-ts/commit/e61c0648fec9c62dc1b999ad18ff813b7fea3887))
* **transport:** retry idempotent requests once on network errors ([#799](https://github.com/cashubtc/cashu-ts/issues/799)) ([7a824fe](https://github.com/cashubtc/cashu-ts/commit/7a824fef7383ca829d51b7fc391966d5321e26ee))
* **transport:** stop pool claims after a failure ([#798](https://github.com/cashubtc/cashu-ts/issues/798)) ([5aea97b](https://github.com/cashubtc/cashu-ts/commit/5aea97baa4b1eea779110d474142b77c322d8371))
* **wallet:** widen config type on bolt12/onchain mint helpers ([#783](https://github.com/cashubtc/cashu-ts/issues/783)) ([7775b0f](https://github.com/cashubtc/cashu-ts/commit/7775b0f6746c1fc2c8a8158abea64247324a5e80))


### Performance Improvements

* **crypto:** cache the keyset parent node in the BIP-32 deriver ([#796](https://github.com/cashubtc/cashu-ts/issues/796)) ([965ec73](https://github.com/cashubtc/cashu-ts/commit/965ec73088ace636aa4fefba599b3d62ae0f932b))
* **wallet:** run state-check batches through a bounded request pool ([#789](https://github.com/cashubtc/cashu-ts/issues/789)) ([0a4725f](https://github.com/cashubtc/cashu-ts/commit/0a4725f2fba74c41d44e66afe984f60e446296e1))


### Miscellaneous Chores

* **docker:** update CDK_IMAGE_RC to cashubtc/mintd:0.17.3-rc.0 ([#775](https://github.com/cashubtc/cashu-ts/issues/775)) ([70a05b5](https://github.com/cashubtc/cashu-ts/commit/70a05b5dff15f8d16ff7c4a4513b818bb57bd0a5))


### Code Refactoring

* **p2pk:** require compressed, on-curve pubkeys ([#781](https://github.com/cashubtc/cashu-ts/issues/781)) ([98a4149](https://github.com/cashubtc/cashu-ts/commit/98a41492282bf402a250a06ec29a3d84370791cf))

## [5.0.0-rc.3](https://github.com/cashubtc/cashu-ts/compare/v5.0.0-rc.2...v5.0.0-rc.3) (2026-07-08)


### ⚠ BREAKING CHANGES

* **crypto:** align NUT-29 batch quote signatures with amended spec ([#675](https://github.com/cashubtc/cashu-ts/issues/675))
* **nut04/05:** quote accounting and custom payment method base structs ([#698](https://github.com/cashubtc/cashu-ts/issues/698))

### Features

* **crypto:** deterministic P2PK & NUT-20 quote-lock key derivation ([#697](https://github.com/cashubtc/cashu-ts/issues/697)) ([042e56c](https://github.com/cashubtc/cashu-ts/commit/042e56ccb6275296a6c60bcc0b6403239ef5ae77))
* **nut04/05:** quote accounting and custom payment method base structs ([#698](https://github.com/cashubtc/cashu-ts/issues/698)) ([0e373f9](https://github.com/cashubtc/cashu-ts/commit/0e373f99fc277072b4f7c2ecb7d2ba7d15c247e1))
* **nut29:** add batch quote checks ([#768](https://github.com/cashubtc/cashu-ts/issues/768)) ([854d91f](https://github.com/cashubtc/cashu-ts/commit/854d91f22a401a3d0ccf2bc2690f621bb0de583e))


### Bug Fixes

* **crypto:** align NUT-29 batch quote signatures with amended spec ([#675](https://github.com/cashubtc/cashu-ts/issues/675)) ([f3a3841](https://github.com/cashubtc/cashu-ts/commit/f3a38411920f9a75d1c37a7d55bbf08e94d19704))
* **p2bk:** align HTLC key slots with the [data, ...pubkeys, ...refund] order (NUT-28) ([#763](https://github.com/cashubtc/cashu-ts/issues/763)) ([bb0b766](https://github.com/cashubtc/cashu-ts/commit/bb0b76684f350a9433a0120cd35330ac4b7bd28c))
* **p2pk:** cap NUT-28 locking slots at 11 (P2PK 11 keys, HTLC 10) ([#753](https://github.com/cashubtc/cashu-ts/issues/753)) ([80a55b9](https://github.com/cashubtc/cashu-ts/commit/80a55b9627a6cb180f72f5b3e1a03b4f098923cc))
* **scripts:** probe docker tags with and without v prefix ([#726](https://github.com/cashubtc/cashu-ts/issues/726)) ([8667aca](https://github.com/cashubtc/cashu-ts/commit/8667acaa412ffb8695b964a764bf0c0cb4cd8fb4))
* **utils:** throw CTSError for malformed token templates ([#742](https://github.com/cashubtc/cashu-ts/issues/742)) ([c60cd35](https://github.com/cashubtc/cashu-ts/commit/c60cd3578c8096a6d9e4cc6a76a99bfa7d07a359))


### Miscellaneous Chores

* **deps:** bump actions/setup-node from 4 to 6 in /.github/actions/integration-against-mint in the github-actions group ([#729](https://github.com/cashubtc/cashu-ts/issues/729)) ([b94af5f](https://github.com/cashubtc/cashu-ts/commit/b94af5fe3fe2757ab41b6c18649d6c71c1df7d4a))

## [5.0.0-rc.2](https://github.com/cashubtc/cashu-ts/compare/v5.0.0-rc.1...v5.0.0-rc.2) (2026-07-01)


### ⚠ BREAKING CHANGES

* **p2pk:** model P2PK/HTLC locks as kind+data spending conditions ([#712](https://github.com/cashubtc/cashu-ts/issues/712))

### Features

* add NUT-27 Nostr mint backup helpers ([#709](https://github.com/cashubtc/cashu-ts/issues/709)) ([1332fcb](https://github.com/cashubtc/cashu-ts/commit/1332fcbc5507d0ce1abe9849b835d3e21dc547fb))
* **mint-info:** derive default method_name per NUT-04/05 ([#707](https://github.com/cashubtc/cashu-ts/issues/707)) ([7494881](https://github.com/cashubtc/cashu-ts/commit/749488151a2efcc09671ba145349d8b0683f2cef))
* **payment-request:** add PaymentRequest.toP2PKOptions() ([#700](https://github.com/cashubtc/cashu-ts/issues/700)) ([13e8aa1](https://github.com/cashubtc/cashu-ts/commit/13e8aa14142b6c137ac4dded789819b38ba1e4b4))
* **wallet:** gate proof creation to active prefixed keysets ([#691](https://github.com/cashubtc/cashu-ts/issues/691)) ([3af343e](https://github.com/cashubtc/cashu-ts/commit/3af343e62c1a83a9a1c09e60862eaa705cea1e36))


### Bug Fixes

* **dleq:** use rejection sampling for deterministic DLEQ nonce ([#696](https://github.com/cashubtc/cashu-ts/issues/696)) ([e54c7d1](https://github.com/cashubtc/cashu-ts/commit/e54c7d1426b804ce4bd78a551b16aeb3f8ea54c3))
* **htlc:** return false for a malformed preimage instead of throwing ([#713](https://github.com/cashubtc/cashu-ts/issues/713)) ([1d1fe5b](https://github.com/cashubtc/cashu-ts/commit/1d1fe5b432f53041bb8aa3813b29564eeace0a83))
* **htlc:** support hashlock-only (pubkey-less) HTLC locks ([#710](https://github.com/cashubtc/cashu-ts/issues/710)) ([9546f23](https://github.com/cashubtc/cashu-ts/commit/9546f23dc2cc47942dedc08577388b10fafb3bf4))
* **nut-17:** replace Math.random() subId with CSPRNG-backed UUID v7 ([#685](https://github.com/cashubtc/cashu-ts/issues/685)) ([92e87ba](https://github.com/cashubtc/cashu-ts/commit/92e87ba016ea5ab6f4755e258dbba3b7cb90819d))
* **payment-request:** forward and harden nut10 on creqB decode ([#703](https://github.com/cashubtc/cashu-ts/issues/703)) ([fb64615](https://github.com/cashubtc/cashu-ts/commit/fb64615f007cd1dc557a4704c115997d13bcd23c))
* **wallet:** allow melt on inactive keyset when no change is created ([#705](https://github.com/cashubtc/cashu-ts/issues/705)) ([15f9ff1](https://github.com/cashubtc/cashu-ts/commit/15f9ff1ce9557092303f62c1ef55563464d20741))


### Code Refactoring

* **p2pk:** model P2PK/HTLC locks as kind+data spending conditions ([#712](https://github.com/cashubtc/cashu-ts/issues/712)) ([76b090c](https://github.com/cashubtc/cashu-ts/commit/76b090cffdf541aff15d9f5580f4cc9e85bb0b34))

## [5.0.0-rc.1](https://github.com/cashubtc/cashu-ts/compare/v4.5.0...v5.0.0-rc.1) (2026-05-23)


### ⚠ BREAKING CHANGES

* remove v4-deprecated APIs ([#676](https://github.com/cashubtc/cashu-ts/issues/676))
* **crypto:** BLS12-381 v3 keysets ([#661](https://github.com/cashubtc/cashu-ts/issues/661))

### Features

* add scoped request fetch hooks ([#677](https://github.com/cashubtc/cashu-ts/issues/677)) ([0216b78](https://github.com/cashubtc/cashu-ts/commit/0216b78d1f1df8bc40651ba3d2c1d965eff83197))
* **crypto:** BLS12-381 v3 keysets ([#661](https://github.com/cashubtc/cashu-ts/issues/661)) ([a80dbf4](https://github.com/cashubtc/cashu-ts/commit/a80dbf4d36ba4e1101a41180b46de0d59cd526fc))
* **mintinfo:** add supportedMethods(op) to list usable mint/melt methods ([#673](https://github.com/cashubtc/cashu-ts/issues/673)) ([9be2d56](https://github.com/cashubtc/cashu-ts/commit/9be2d56346ec2b747655c4db65006be79c8f9861))
* **nut06:** add method_name to mint/melt method settings (NUT-04/05) ([#672](https://github.com/cashubtc/cashu-ts/issues/672)) ([28e3a20](https://github.com/cashubtc/cashu-ts/commit/28e3a208020cb1dd61512ced33e815ff61d488f1))


### Code Refactoring

* **crypto:** split curve primitives ([#667](https://github.com/cashubtc/cashu-ts/issues/667)) ([35da507](https://github.com/cashubtc/cashu-ts/commit/35da507bb4e3e33ee12a0801c917478c5015a48d))
* remove v4-deprecated APIs ([#676](https://github.com/cashubtc/cashu-ts/issues/676)) ([994675a](https://github.com/cashubtc/cashu-ts/commit/994675aa13ea382300923a5e18277dc709e19699))

## [4.5.0](https://github.com/cashubtc/cashu-ts/compare/v4.4.0...v4.5.0) (2026-05-21)


### Features

* add onchain mint/melt support ([#633](https://github.com/cashubtc/cashu-ts/issues/633)) ([d95f923](https://github.com/cashubtc/cashu-ts/commit/d95f92308f96c8ac1d32160e242e83b89f29cb3b))

## [4.4.0](https://github.com/cashubtc/cashu-ts/compare/v4.3.0...v4.4.0) (2026-05-16)


### Features

* allow ProofLike in WalletEvent proof state updates ([#660](https://github.com/cashubtc/cashu-ts/issues/660)) ([6c3589c](https://github.com/cashubtc/cashu-ts/commit/6c3589c9d316e57fc44d4b7b6cfabd15cc22ba88))
* **model:** add AmountWithUnit value object ([#662](https://github.com/cashubtc/cashu-ts/issues/662)) ([3cd03d7](https://github.com/cashubtc/cashu-ts/commit/3cd03d7d98ba8b42e22f48bc92ceb35c388704b5))

## [4.3.0](https://github.com/cashubtc/cashu-ts/compare/v4.2.1...v4.3.0) (2026-05-12)


### Features

* **errors:** add CTSError base class ([#657](https://github.com/cashubtc/cashu-ts/issues/657)) ([a42527e](https://github.com/cashubtc/cashu-ts/commit/a42527e65766531ee4b96990c033c45cfa27b11a))
* **nut12:** deterministic DLEQ nonce derivation ([#638](https://github.com/cashubtc/cashu-ts/issues/638)) ([441b3cf](https://github.com/cashubtc/cashu-ts/commit/441b3cf851c988c8d898061454ffe98d98b9a296))
* **types:** align nullable wire fields with spec (T | null) ([#655](https://github.com/cashubtc/cashu-ts/issues/655)) ([16f533b](https://github.com/cashubtc/cashu-ts/commit/16f533b09b63bfab324501d8704a8e3396724d0c))
* **wallet:** add maxSpendableAfterFees primitive ([#654](https://github.com/cashubtc/cashu-ts/issues/654)) ([f9d3205](https://github.com/cashubtc/cashu-ts/commit/f9d3205c61ddca3ba17848df042af8bb609789d4))
* **wallet:** improve async melt change handling ([#659](https://github.com/cashubtc/cashu-ts/issues/659)) ([0119bde](https://github.com/cashubtc/cashu-ts/commit/0119bde2eea1d71482291c1f426c7d8469b459e4))


### Bug Fixes

* **mint:** coerce omitted payment_preimage and witness to null ([#653](https://github.com/cashubtc/cashu-ts/issues/653)) ([0f0dc04](https://github.com/cashubtc/cashu-ts/commit/0f0dc04f14698406cbb11f5619ad0d04c36d3413))
* **mint:** treat null amount on BOLT12 mint quote as no-amount ([#649](https://github.com/cashubtc/cashu-ts/issues/649)) ([067b38d](https://github.com/cashubtc/cashu-ts/commit/067b38d530d2a43f62b1c2b8ea7308976d6a0c6e))
* **wallet:** treat expiry: 0 as no-expiry in validateMintQuote ([#648](https://github.com/cashubtc/cashu-ts/issues/648)) ([e35c053](https://github.com/cashubtc/cashu-ts/commit/e35c05350dee1ca551e76daeb5d466317a5ca860))
* **wallet:** verify DLEQ on received proofs even without requireDleq (NUT-12) ([#656](https://github.com/cashubtc/cashu-ts/issues/656)) ([dc04293](https://github.com/cashubtc/cashu-ts/commit/dc042934fb90b2360a5c21dea1a620756a44efc3))

## [4.2.1](https://github.com/cashubtc/cashu-ts/compare/v4.2.0...v4.2.1) (2026-05-06)


### Bug Fixes

* **batch minting:** type BatchMintRequest.quote_amounts was incorrect - now Amount[] ([#646](https://github.com/cashubtc/cashu-ts/issues/646)) ([c8a181c](https://github.com/cashubtc/cashu-ts/commit/c8a181ca67607a7d7906ff4a3072f561c82e9daa))

## [4.2.0](https://github.com/cashubtc/cashu-ts/compare/v4.1.0...v4.2.0) (2026-05-05)


### Features

* replace sanitizeUrl with normalizeUrl for mint URL validation ([#632](https://github.com/cashubtc/cashu-ts/issues/632)) ([4f02d8b](https://github.com/cashubtc/cashu-ts/commit/4f02d8b06ed736f760250d6d769ad1d713e496a0))


### Bug Fixes

* gate User-Agent override outside browser-like runtimes ([cfbb09f](https://github.com/cashubtc/cashu-ts/commit/cfbb09fe82adc4d0ef34f9f5307269d4d3cb321e))
* harden mint URL normalization ([#637](https://github.com/cashubtc/cashu-ts/issues/637)) ([c72caa5](https://github.com/cashubtc/cashu-ts/commit/c72caa54d4d3dfab060b856dbc24acbee6a26730))
* only set User-Agent override in non-browserlike runtimes ([#640](https://github.com/cashubtc/cashu-ts/issues/640)) ([cfbb09f](https://github.com/cashubtc/cashu-ts/commit/cfbb09fe82adc4d0ef34f9f5307269d4d3cb321e))

## [4.1.0](https://github.com/cashubtc/cashu-ts/compare/v4.0.0...v4.1.0) (2026-04-16)


### Features

* add createEphemeralCounterSource function ([#630](https://github.com/cashubtc/cashu-ts/issues/630)) ([12fe7b1](https://github.com/cashubtc/cashu-ts/commit/12fe7b10928a2c3a4dd6a6ce66a1fa0a65a7b297))
* widen selectProofsToSend and groupProofsByState to accept ProofLike[] ([#631](https://github.com/cashubtc/cashu-ts/issues/631)) ([87b4be4](https://github.com/cashubtc/cashu-ts/commit/87b4be46a5d1f90c788f58b7b458c08d33eed8f4))


### Bug Fixes

* typedocs were not running on release-please. Now just v4. releases without hyphen ([#626](https://github.com/cashubtc/cashu-ts/issues/626)) ([a3cbb49](https://github.com/cashubtc/cashu-ts/commit/a3cbb49251681e82419cbc98d7db5031422db485))

## [4.0.0](https://github.com/cashubtc/cashu-ts/compare/v3.6.1...v4.0.0) (2026-04-14)


### ⚠ BREAKING CHANGES

* **utils:** restrict internal functions from public API surface ([#570](https://github.com/cashubtc/cashu-ts/issues/570))
* remove handleTokens from public API ([#569](https://github.com/cashubtc/cashu-ts/issues/569))
* **p2pk:** add normalizeP2PKOptions ([#564](https://github.com/cashubtc/cashu-ts/issues/564))
* remove v3 token encoding; accept raw proofs in receive flows ([#558](https://github.com/cashubtc/cashu-ts/issues/558))
* generic mint/melt methods for custom payment types ([#544](https://github.com/cashubtc/cashu-ts/issues/544))
* multi-unit KeyChain, cache API cleanup, deprecation removal ([#540](https://github.com/cashubtc/cashu-ts/issues/540))
* Add bigint support to CBOR for creqA payment requests ([#538](https://github.com/cashubtc/cashu-ts/issues/538))
* Proof.amount → bigint, strip crypto primitives, consolidate melt ([#537](https://github.com/cashubtc/cashu-ts/issues/537))
* tighten mint/melt API; remove MeltBlanks and prefer_async ([#534](https://github.com/cashubtc/cashu-ts/issues/534))
* migrate amount-bearing APIs to use Amount VO ([#533](https://github.com/cashubtc/cashu-ts/issues/533))
* remove support for CJS build ([#524](https://github.com/cashubtc/cashu-ts/issues/524))

### Features

* Add bigint support to CBOR for creqA payment requests ([#538](https://github.com/cashubtc/cashu-ts/issues/538)) ([7a54a91](https://github.com/cashubtc/cashu-ts/commit/7a54a91cf550d34b3a005a86db948d0235a4b08e))
* add JSONInt to public api. Update migration docs ([#593](https://github.com/cashubtc/cashu-ts/issues/593)) ([464ec82](https://github.com/cashubtc/cashu-ts/commit/464ec82635d7e64fb5ea70b81ccdce754d7ef13c))
* add requireSigDleq option to Wallet for DLEQ enforcement on signatures ([#622](https://github.com/cashubtc/cashu-ts/issues/622)) ([df5cec6](https://github.com/cashubtc/cashu-ts/commit/df5cec629be71743e20033e7fdeaffdc4b76d29a))
* allow consumers to override anti-fingerprinting headers ([#580](https://github.com/cashubtc/cashu-ts/issues/580)) ([31268a1](https://github.com/cashubtc/cashu-ts/commit/31268a15e60bb81bfd64ab3a5ff68812ab5d3302))
* bigint roundtrip for v3/v4 tokens, wire in the enhanced CBOR ([#539](https://github.com/cashubtc/cashu-ts/issues/539)) ([88bffc0](https://github.com/cashubtc/cashu-ts/commit/88bffc01a3d929cef9e86c0bc72532a6c64ddc40))
* **errors:** add RateLimitError and parseRetryAfter for explicit 429 ([#594](https://github.com/cashubtc/cashu-ts/issues/594)) ([74e0efc](https://github.com/cashubtc/cashu-ts/commit/74e0efc828b410a3105429811c171c681bba7669))
* extend Amount utils, update migration docs ([#584](https://github.com/cashubtc/cashu-ts/issues/584)) ([4d4529c](https://github.com/cashubtc/cashu-ts/commit/4d4529c2a6e75b3a005891453d3fe13fa8f2fdd2))
* generic mint/melt methods for custom payment types ([#544](https://github.com/cashubtc/cashu-ts/issues/544)) ([6c9121b](https://github.com/cashubtc/cashu-ts/commit/6c9121b3c77803618d3b15a2ab51ff58c91c7bb2))
* migrate amount-bearing APIs to use Amount VO ([#533](https://github.com/cashubtc/cashu-ts/issues/533)) ([ae5d41d](https://github.com/cashubtc/cashu-ts/commit/ae5d41d00ccd309c3fa29a23230354ca8c789c30))
* multi-unit KeyChain, cache API cleanup, deprecation removal ([#540](https://github.com/cashubtc/cashu-ts/issues/540)) ([2ac031d](https://github.com/cashubtc/cashu-ts/commit/2ac031d449321bb79915e639b4806de3a7399c6a))
* **nut29:** wire NUT-06 max_batch_size into prepareBatchMint enforcement ([#607](https://github.com/cashubtc/cashu-ts/issues/607)) ([d88f1a9](https://github.com/cashubtc/cashu-ts/commit/d88f1a9df9e361b057bc52f658e53cca73d2273a))
* Proof.amount → bigint, strip crypto primitives, consolidate melt ([#537](https://github.com/cashubtc/cashu-ts/issues/537)) ([c426323](https://github.com/cashubtc/cashu-ts/commit/c42632321bc9f3e252ba568908f45d9475574370))
* remove v3 token encoding; accept raw proofs in receive flows ([#558](https://github.com/cashubtc/cashu-ts/issues/558)) ([abd1efc](https://github.com/cashubtc/cashu-ts/commit/abd1efc9d62024925238df3f86830487080d0681))
* ResponseMeta callback and per-mint rate-limit header exposure ([#596](https://github.com/cashubtc/cashu-ts/issues/596)) ([42db5c7](https://github.com/cashubtc/cashu-ts/commit/42db5c7b7660935ff2a5d0e13a61da7312d9f34b))
* Support NUT-29 Batch Minting ([#478](https://github.com/cashubtc/cashu-ts/issues/478)) ([de895da](https://github.com/cashubtc/cashu-ts/commit/de895da73a6e2cdb0f84e0dfeb0847aa5dbadefe))
* tighten mint/melt API; remove MeltBlanks and prefer_async ([#534](https://github.com/cashubtc/cashu-ts/issues/534)) ([8ef99c9](https://github.com/cashubtc/cashu-ts/commit/8ef99c90fff8337ff063a9c02218e51997e5c348))
* **utils:** add serializeProofs/deserializeProofs, make getEncodedTokenV4 internal ([2c92842](https://github.com/cashubtc/cashu-ts/commit/2c92842a96e30d6bd850c60d71f3062d015668cf))


### Bug Fixes

* align maxPerMint with desiredPoolSize in createAuthWallet. ([#602](https://github.com/cashubtc/cashu-ts/issues/602)) ([8b32c97](https://github.com/cashubtc/cashu-ts/commit/8b32c97a1dbc1d749f54f954d2feef997932605d))
* harden fetch RequestInit against client fingerprinting ([#545](https://github.com/cashubtc/cashu-ts/issues/545)) ([2af85d1](https://github.com/cashubtc/cashu-ts/commit/2af85d10fd34c82c84fb7219e7244c723519db0f))
* normalize and dedup p2pk pubkeys / refund keys at edges (was just in P2PKBuilder) ([#546](https://github.com/cashubtc/cashu-ts/issues/546)) ([99964a7](https://github.com/cashubtc/cashu-ts/commit/99964a742f875ac4b04e81764af6edc09ce400d6))
* **p2pk:** add sigflag validation ([#563](https://github.com/cashubtc/cashu-ts/issues/563)) ([b8ad4a9](https://github.com/cashubtc/cashu-ts/commit/b8ad4a9897df7959ff33aa652c728a34c7ddc435))
* point docs breadcrumbs to site root ([#614](https://github.com/cashubtc/cashu-ts/issues/614)) ([16fe8d9](https://github.com/cashubtc/cashu-ts/commit/16fe8d9dc64ed767f1ec8df010feceea701d8a38))
* prevent getEncodedToken from mutating input token proofs ([#536](https://github.com/cashubtc/cashu-ts/issues/536)) ([dc90078](https://github.com/cashubtc/cashu-ts/commit/dc9007829e6f0fc31dcb0c39d0bb212f512aa5e1)), closes [#535](https://github.com/cashubtc/cashu-ts/issues/535)
* reject zero blinding factor in NUT-13 derivation and blindMessage ([#572](https://github.com/cashubtc/cashu-ts/issues/572)) ([8ad5064](https://github.com/cashubtc/cashu-ts/commit/8ad5064ce91e39140bf4d400081a5da82e84a1d5))
* remove Pragma and Cache-Control headers. These are not supported in CDK cors preflight ([#566](https://github.com/cashubtc/cashu-ts/issues/566)) ([f431bbf](https://github.com/cashubtc/cashu-ts/commit/f431bbfaddb2e7f545128377842e41ab03f152f1))
* retain p2bk_e in offline send ([#616](https://github.com/cashubtc/cashu-ts/issues/616)) ([8cdcf0d](https://github.com/cashubtc/cashu-ts/commit/8cdcf0dbbe7dc8505fd7fdfebc94255cf8bb5319))
* switch to GH releases for renovate ([#585](https://github.com/cashubtc/cashu-ts/issues/585)) ([1749279](https://github.com/cashubtc/cashu-ts/commit/174927906825f66d9f465307810a5181e2bdca4e))
* update release-please-action to v4.4.0 for Node.js 24 support ([#583](https://github.com/cashubtc/cashu-ts/issues/583)) ([f45d657](https://github.com/cashubtc/cashu-ts/commit/f45d657037d79126c80a0c377268480cc197bad3))
* use constant time byte check for verifyDLEQProof ([#574](https://github.com/cashubtc/cashu-ts/issues/574)) ([494c969](https://github.com/cashubtc/cashu-ts/commit/494c969a121a2d220ad1b2be351eb397a6a0abc0))
* verify DLEQ proofs and amounts on mint BlindSignature responses (NUT-12) ([#567](https://github.com/cashubtc/cashu-ts/issues/567)) ([0cc9da9](https://github.com/cashubtc/cashu-ts/commit/0cc9da9dce63ad02b9f71e1647d1e9ab081e9707))
* **wallet:** remove witness from plain secret (not nut-10) proofs in normalization ([#579](https://github.com/cashubtc/cashu-ts/issues/579)) ([7d61d7e](https://github.com/cashubtc/cashu-ts/commit/7d61d7e33f8d3355063c86c272cea22fafa667be))


### Miscellaneous Chores

* remove support for CJS build ([#524](https://github.com/cashubtc/cashu-ts/issues/524)) ([b0e417e](https://github.com/cashubtc/cashu-ts/commit/b0e417edbd9cf0e8d358ed2c67525b37d78cdc7c))
* **utils:** restrict internal functions from public API surface ([#570](https://github.com/cashubtc/cashu-ts/issues/570)) ([dff7005](https://github.com/cashubtc/cashu-ts/commit/dff7005b2eb83f0124f4fe1ce02fdc73388fb2ef))


### Code Refactoring

* **p2pk:** add normalizeP2PKOptions ([#564](https://github.com/cashubtc/cashu-ts/issues/564)) ([04c4d92](https://github.com/cashubtc/cashu-ts/commit/04c4d925ee55e0468c508a4329c5614be42b7918))
* remove handleTokens from public API ([#569](https://github.com/cashubtc/cashu-ts/issues/569)) ([19e0830](https://github.com/cashubtc/cashu-ts/commit/19e08309578631ba9e1a307e90a55ca59da003b1))

## [3.6.1](https://github.com/cashubtc/cashu-ts/compare/v3.6.0...v3.6.1) (2026-03-17)


### Bug Fixes

* **auth:** use ensureCAT if available so token is refreshed ([#529](https://github.com/cashubtc/cashu-ts/issues/529)) ([7ba4bbc](https://github.com/cashubtc/cashu-ts/commit/7ba4bbc61a133e61c907408619b17f4903aa04a8))

## [3.6.0](https://github.com/cashubtc/cashu-ts/compare/v3.5.0...v3.6.0) (2026-03-13)


### Features

* **amount:** add Amount value object (bigint support), AmountLike input and refactor internals ([#514](https://github.com/cashubtc/cashu-ts/issues/514)) ([cb5fd22](https://github.com/cashubtc/cashu-ts/commit/cb5fd22d7781ae44ff7a4d627bd44d47202e8f49))
* **core:** add utility functions schnorrSignDigest, computeMessageDigest ([#515](https://github.com/cashubtc/cashu-ts/issues/515)) ([1b201c8](https://github.com/cashubtc/cashu-ts/commit/1b201c8a996215af3259a9567ef3eb098e50fc7c))
* experimental Sig_all signing package ([#485](https://github.com/cashubtc/cashu-ts/issues/485)) ([d8f33f0](https://github.com/cashubtc/cashu-ts/commit/d8f33f0d6e149b4457015d092d5fd0599aa36273))
* **jsonint:** add bigint-safe JSON parsing and mint normalization ([#519](https://github.com/cashubtc/cashu-ts/issues/519)) ([f40fcaf](https://github.com/cashubtc/cashu-ts/commit/f40fcaf09509a35ea3be5961130bb92440ff7a7a))
* **wallet:** add two step minting: prepareMint and completeMint ([#523](https://github.com/cashubtc/cashu-ts/issues/523)) ([39f5568](https://github.com/cashubtc/cashu-ts/commit/39f5568b577a492c375ee09b71b4a8fbc24e12ad))


### Bug Fixes

* **mint:** preserve normalized melt fields ([f40fcaf](https://github.com/cashubtc/cashu-ts/commit/f40fcaf09509a35ea3be5961130bb92440ff7a7a))

## [3.5.0](https://github.com/cashubtc/cashu-ts/compare/v3.4.1...v3.5.0) (2026-02-18)


### Features

* **melt:** replace Prefer header with prefer_async POST request ([#500](https://github.com/cashubtc/cashu-ts/issues/500)) ([efe2550](https://github.com/cashubtc/cashu-ts/commit/efe2550c63136f5d1b51a9d5458ea5cdcd851f5a))
* **p2bk:** update to latest spec - removes Keysetid and NUT-18 flag ([fa26bc5](https://github.com/cashubtc/cashu-ts/commit/fa26bc573bd7348831df64e590ff470d0cfede2c))


### Bug Fixes

* remove unbounded per request cache ([#484](https://github.com/cashubtc/cashu-ts/issues/484)) ([b1d32ab](https://github.com/cashubtc/cashu-ts/commit/b1d32ab8de5b4a0468057a8126ad00ec139c3c48))

## [3.4.1](https://github.com/cashubtc/cashu-ts/compare/v3.4.0...v3.4.1) (2026-02-05)


### Bug Fixes

* restore from inactive keyset ([#486](https://github.com/cashubtc/cashu-ts/issues/486)) ([dd3ee5b](https://github.com/cashubtc/cashu-ts/commit/dd3ee5b0613b3f45d7b9378c1471f14c64090f7d))

## [3.4.0](https://github.com/cashubtc/cashu-ts/compare/v3.3.0...v3.4.0) (2026-02-05)

New style changelog begins, containing features/fixes.

### Features

- add new glob prefix wildcard match for nut-21/22 ([77c544a](https://github.com/cashubtc/cashu-ts/commit/77c544a411b166612fd4797f07836141404607e9))
- **ci:** add release automation and husky ([6bf4492](https://github.com/cashubtc/cashu-ts/commit/6bf44923188defbef2b3a7b98f68fb16d940a6f6))

### Bug Fixes

- **ci:** add missing permission ([05182da](https://github.com/cashubtc/cashu-ts/commit/05182da1807cedea3eab69773eb6f132c5813fe4))
	ts/commit/950ae5495273cea30578a84d67934a42eb140f0d))
- standalone asset build in CI ([2cc1138](https://github.com/cashubtc/cashu-ts/commit/2cc1138bc195edd4566e69c5ef84dc06ef7948ec))

## [v3.0.0](https://github.com/cashubtc/cashu-ts/releases/tag/v3.0.0) (2025-10-24)

### Features

- Transaction builder (WalletOps)
- Deterministic counters (WalletCounters / CounterSource)
- Wallet Event Subscriptions (WalletEvents)
- Clear and Blind Authentication (AuthManager / AuthProvider / OIDCAuth)
- Wallet Keychain with backup (KeyChain)
- Wallet load from cache
- P2PK Settings Builder (P2PKBuilder)
- RGLI Proof Selection (SelectProofs)
- Preview Send/Receive/Melt Transactions
- Bech32 format Payment Requests
- Pay to Blinded Key (P2BK)
- SIG_ALL and HTLC support
- Integrated Crypto Library (replaces @cashu/crypto)
- Easier proof management (groupProofsByState)
- Better output handline (OutputType / OutputConfig)

If upgrading from v2, please review the [migration guide](migration-3.0.0.md) for breaking changes.

## [v2.8.1](https://github.com/cashubtc/cashu-ts/releases/tag/v2.8.1) (2025-11-17)

This release is now obsolete.

If upgrading from v1, please review the [migration guide](migration-2.0.0.md) for breaking changes.

## [v1.2.1](https://github.com/cashubtc/cashu-ts/releases/tag/v1.2.1) (2024-10-24)

This release is now obsolete.

If upgrading from v0, please review the [migration guide](migration-1.0.0.md) for breaking changes.

## [v0.9.0](https://github.com/cashubtc/cashu-ts/releases/tag/v0.9.0) (2024-01-18)

This release is now obsolete.
