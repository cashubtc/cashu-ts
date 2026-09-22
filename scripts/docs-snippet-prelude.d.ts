// Ambient names that docs-src fences use without declaring: most fences are fragments that
// continue an earlier one. Typed with the shipped types so an API change fails here too.
type CTS = typeof import('@cashu/cashu-ts');
type Wallet = import('@cashu/cashu-ts').Wallet;
type Proof = import('@cashu/cashu-ts').Proof;
type Amount = import('@cashu/cashu-ts').Amount;
// No global alias for PaymentRequest: the DOM lib already declares one and would win.

declare const wallet: Wallet;
declare const mint: import('@cashu/cashu-ts').Mint;
declare const mintUrl: string;
declare const myMint: string;
declare const info: import('@cashu/cashu-ts').MintInfo;
declare const seed: Uint8Array;
declare const keysetId: string;
declare const cache: unknown;

declare const proof: Proof;
declare const proof1: Proof;
declare const proof2: Proof;
declare const proof3: Proof;
declare const proofs: Proof[];
declare const myProofs: Proof[];
declare const myExistingProofs: Proof[];
declare const proofsToSend: Proof[];
declare const token: string;
declare const tokenA: string;
declare const tokenB: string;
declare const receipt: import('@cashu/cashu-ts').SpendReceipt;

declare const quote: import('@cashu/cashu-ts').MintQuoteBolt11Response;
declare const quoteId: string;
declare const meltQuote: import('@cashu/cashu-ts').MeltQuoteBolt11Response;
declare const paidQuote: import('@cashu/cashu-ts').MeltQuoteBolt11Response;
declare const ids: string[];
declare const ac: AbortController;
declare const onMint: Parameters<Wallet['on']['mintQuoteUpdates']>[1];
declare const onErr: Parameters<Wallet['on']['mintQuoteUpdates']>[2];
declare const lastKnown: number;

declare const pubkey: string;
declare const pubkeyHex: string;
declare const myPubkey: string;
declare const payeePk: string;
declare const privkey: string;
declare const privkeyHex: string;
declare const myPrivkey: string;
declare const myStaticPrivkey: string;
declare const refundPrivkey: string;
declare const preimage: string;
declare const locktime: number;

declare const pr: import('@cashu/cashu-ts').PaymentRequest;
declare const request: import('@cashu/cashu-ts').PaymentRequest;
declare const payload: import('@cashu/cashu-ts').PaymentRequestPayload;
declare const scanned: string;
declare const body: string;
declare const nprofile: string;
declare const myMeltMethods: NonNullable<
  Parameters<import('@cashu/cashu-ts').PaymentRequest['amountToSend']>[1]
>;
declare const chosenAmount: Amount;
declare const total: Amount;

declare const makeOutputData: import('@cashu/cashu-ts').OutputDataFactory;
declare const prebuiltRxOutputs: import('@cashu/cashu-ts').OutputData[];
declare function saveKeychainToDb(cache: unknown): void;
declare function saveNextToDb(counterKey: string, next: number): Promise<void>;

declare const nostr: Parameters<CTS['CashuNip07']['signP2PK']>[0];
declare const xOnlyPubkey: string;
declare const walletEvent: { content: string };
declare const cancelButton: HTMLElement;
declare const invoice: string;
interface Window {
  nostr: Parameters<CTS['CashuNip07']['signP2PK']>[0];
}

declare const bip39seed: Uint8Array;
declare const mnemonic: string;
declare const storedSeedHex: string;
declare const preferredKeysetId: string;
declare const counter: number;
declare const gapLimit: number;
declare const targetPubkey: string;
declare const mintA: string;
declare const mintB: string;
declare const walletA: Wallet;
declare const walletB: Wallet;
declare const myKeyChain: import('@cashu/cashu-ts').KeyChain;
declare const offer: string;
declare const tokenString: string;
declare const pastedText: string;
declare const state: Awaited<ReturnType<Wallet['checkProofsStates']>>[number];
declare const ohttpFetch: import('@cashu/cashu-ts').RequestFetch;
declare const fetchThroughOhttp: typeof fetch;
declare function isPrivateHost(hostname: string): boolean;
declare function fastBlsHashToCurveHex(secret: Uint8Array): string;
declare function loadCountersFromDb(): Record<string, number>;
declare function savePendingSend(serialized: unknown): Promise<void>;
declare function getInvoiceFor(amount: import('@cashu/cashu-ts').AmountLike): Promise<string>;
declare const appLogger: { write(level: string, message: string, context?: unknown): void };
