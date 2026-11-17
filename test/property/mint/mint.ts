import {
  Amount,
  CheckStateEnum,
  JSONInt,
  MeltQuoteState,
  MintQuoteState,
  bolt11AmountMsat,
  bytesToHex,
  createBlindSignature,
  createDLEQProof,
  createNewMintKeys,
  getPubKeyFromPrivKey,
  hashToCurve,
  pointFromHex,
  serializeMintKeys,
  verifyMintQuoteSignature,
  verifyUnblindedSignature,
  type CheckStateResponse,
  type GetInfoResponse,
  type GetKeysResponse,
  type GetKeysetsResponse,
  type KeysetPair,
  type MeltQuoteBaseResponse,
  type MeltQuoteBolt11Response,
  type MeltQuoteBolt12Response,
  type MeltQuoteOnchainResponse,
  type MintQuoteBolt11Response,
  type MintQuoteBolt12Response,
  type MintQuoteOnchainResponse,
  type MintResponse,
  type PostRestoreResponse,
  type Proof,
  type RequestFetch,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
  type SwapResponse,
} from '../../../src';

export const mintUrl = 'http://mint.test';
export const unit = 'sat';

/**
 * One request the mint received and the response it gave, as wire JSON.
 */
export type Exchange = {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  status: number;
  response: unknown;
  /**
   * What the wallet was given when `tamper` altered the response.
   */
  sent?: unknown;
};

type WireOutput = { amount: number | bigint; id: string; B_: string };
type WireProof = { amount: number | bigint; id: string; secret: string; C: string };

class Refusal extends Error {
  constructor(
    readonly code: number,
    detail: string,
  ) {
    super(detail);
  }
}

const utf8 = new TextEncoder();
const mintPrivkey = new Uint8Array(32).fill(7);

/**
 * Keys for a 1, 2, 4, 8 keyset; `feePpk` sets its input fee.
 */
export function mintKeys(feePpk: number): KeysetPair {
  return createNewMintKeys(4, new Uint8Array(32).fill(feePpk + 1), { input_fee_ppk: feePpk });
}

// Hashing to the curve dominates the checks, so cache it across runs.
const ys = new Map<string, string>();
const verified = new Map<string, boolean>();

export function proofY(secret: string): string {
  let Y = ys.get(secret);
  if (Y === undefined) ys.set(secret, (Y = hashToCurve(utf8.encode(secret)).toHex(true)));
  return Y;
}

/**
 * Honest in-memory mint: a FakeWallet backend that pays every quote, served over `fetch`.
 *
 * @remarks
 * Every exchange is logged. `tamper` may rewrite a response body and `hold` may delay it; both run
 * after the mint has committed the request, as a lost response would.
 */
export class InMemoryMint {
  readonly keys: KeysetPair;
  readonly keysetId: string;
  readonly feePpk: number;
  readonly log: Exchange[] = [];
  readonly spent = new Set<string>();
  readonly signed = new Map<string, SerializedBlindedSignature>();
  readonly mintQuotes = new Map<string, MintQuoteBolt11Response>();
  readonly meltQuotes = new Map<string, MeltQuoteBolt11Response>();
  readonly otherQuotes = new Map<string, unknown>();
  issued = 0n;
  redeemed = 0n;
  feesCharged = 0n;
  tamper?: (ex: Exchange) => unknown;
  hold?: (ex: Exchange) => Promise<void> | undefined;
  private nextQuote = 0;

  constructor(
    keys: KeysetPair,
    readonly opts: {
      feePpk: number;
      feeReserve: number;
      lnFee: number;
      dleq: boolean;
      maxArrayLength?: number;
    },
  ) {
    this.keys = keys;
    this.keysetId = keys.keysetId;
    this.feePpk = opts.feePpk;
  }

  /**
   * Value the mint has signed and not yet seen spent.
   */
  outstanding(): bigint {
    return this.issued - this.redeemed;
  }

  readonly fetch: RequestFetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSONInt.parse(init.body) as Record<string, unknown>)
        : undefined;
    const ex: Exchange = { method, path: url.pathname, body, status: 200, response: undefined };
    try {
      ex.response = this.handle(ex.method, ex.path, body as never);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      ex.status = 400;
      ex.response = { code: e.code, detail: e.message };
    }
    this.log.push(ex);
    const sent = ex.status === 200 && this.tamper ? this.tamper(ex) : ex.response;
    if (sent !== ex.response) ex.sent = sent;
    const held = this.hold?.(ex);
    if (held) await untilAborted(held, signal);
    return new Response(JSONInt.stringify(sent) ?? '', { status: ex.status });
  };

  // `never` lets each route read the body as its own request type; a wrong shape throws.
  private handle(method: string, path: string, body: never): unknown {
    const route = `${method} ${path}`;
    if (route === 'GET /v1/info') return this.info();
    if (route === 'GET /v1/keysets') return this.keysets();
    if (route === 'GET /v1/keys' || route === `GET /v1/keys/${this.keysetId}`) return this.keyset();
    if (route === 'POST /v1/mint/quote/bolt11') return this.createMintQuote(body);
    if (route.startsWith('GET /v1/mint/quote/bolt11/')) return this.mintQuote(lastSegment(path));
    if (route === 'POST /v1/mint/bolt11') return this.mint(body);
    if (route === 'POST /v1/swap') return this.swap(body);
    if (route === 'POST /v1/melt/quote/bolt11') return this.createMeltQuote(body);
    if (route.startsWith('GET /v1/melt/quote/bolt11/')) return this.meltQuote(lastSegment(path));
    if (route === 'POST /v1/melt/bolt11') return this.melt(body);
    if (route === 'POST /v1/checkstate') return this.checkstate(body);
    if (route === 'POST /v1/restore') return this.restore(body);
    const [, side, kind, id] = /^\/v1\/(mint|melt)\/quote\/([a-z0-9]+)\/?(.*)$/.exec(path) ?? [];
    if (side === 'mint' && id && method === 'GET') return this.otherQuote(id);
    if (side === 'melt' && id && method === 'GET') return this.otherQuote(id);
    if (side === 'mint' && method === 'POST') return this.createOtherMintQuote(kind, body);
    if (side === 'melt' && method === 'POST') return this.createOtherMeltQuote(kind, body);
    throw new Refusal(404, `no route ${route}`);
  }

  info(): GetInfoResponse {
    const methods = (names: string[]) => names.map((method) => ({ method, unit }));
    return {
      name: 'in-memory mint',
      pubkey: bytesToHex(getPubKeyFromPrivKey(mintPrivkey)),
      version: 'test/0',
      contact: [],
      max_array_length: this.opts.maxArrayLength,
      nuts: {
        '4': { methods: methods(['bolt11', 'bolt12', 'onchain']), disabled: false },
        '5': { methods: methods(['bolt11', 'bolt12', 'onchain', 'custom']), disabled: false },
        '7': { supported: true },
        '8': { supported: true },
        '9': { supported: true },
        '12': { supported: this.opts.dleq },
        '20': { supported: true },
      },
    };
  }

  private keysets(): GetKeysetsResponse {
    return {
      keysets: [{ id: this.keysetId, unit, active: true, input_fee_ppk: this.feePpk }],
    };
  }

  private keyset(): GetKeysResponse {
    const keys = serializeMintKeys(this.keys.pubKeys);
    return {
      keysets: [{ id: this.keysetId, unit, active: true, input_fee_ppk: this.feePpk, keys }],
    };
  }

  private createMintQuote(body: { amount: number; pubkey: string }): MintQuoteBolt11Response {
    const id = `mint-quote-${this.nextQuote++}`;
    const amount = Amount.from(body.amount);
    const quote: MintQuoteBolt11Response = {
      quote: id,
      request: invoice(body.amount, id),
      unit,
      method: 'bolt11',
      amount,
      amount_paid: amount,
      amount_issued: Amount.zero(),
      state: MintQuoteState.PAID,
      updated_at: null,
      expiry: null,
      pubkey: body.pubkey,
    };
    this.mintQuotes.set(id, quote);
    return quote;
  }

  // Quotes on other methods are only quoted and looked up, never paid.
  private createOtherMintQuote(
    kind: string,
    body: { amount?: number; pubkey: string },
  ): MintQuoteBolt12Response | MintQuoteOnchainResponse {
    const base = {
      quote: `${kind}-quote-${this.nextQuote++}`,
      unit,
      amount_paid: Amount.zero(),
      amount_issued: Amount.zero(),
      updated_at: null,
      expiry: null,
      pubkey: body.pubkey,
    };
    const quote =
      kind === 'bolt12'
        ? {
            ...base,
            method: kind,
            request: `lno1${base.quote}`,
            amount: body.amount === undefined ? null : Amount.from(body.amount),
          }
        : { ...base, method: 'onchain', request: `bc1q${base.quote}` };
    this.otherQuotes.set(quote.quote, quote);
    return quote;
  }

  private createOtherMeltQuote(
    kind: string,
    body: { request: string; amount?: number; options?: { amountless?: { amount_msat: number } } },
  ): MeltQuoteBolt12Response | MeltQuoteOnchainResponse | MeltQuoteBaseResponse {
    const msat = body.options?.amountless?.amount_msat;
    const base: MeltQuoteBaseResponse = {
      quote: `${kind}-quote-${this.nextQuote++}`,
      request: body.request,
      amount: Amount.from(msat === undefined ? (body.amount ?? 1) : Math.ceil(msat / 1000)),
      method: kind,
      unit,
      state: MeltQuoteState.UNPAID,
      expiry: 4102444800,
    };
    const fee_reserve = Amount.from(this.opts.feeReserve);
    const quote =
      kind === 'bolt12'
        ? { ...base, fee_reserve, payment_preimage: null }
        : kind === 'onchain'
          ? {
              ...base,
              fee_options: [{ fee_index: 0, fee_reserve, estimated_blocks: 6 }],
              selected_fee_index: null,
              outpoint: null,
            }
          : base;
    this.otherQuotes.set(quote.quote, quote);
    return quote;
  }

  private otherQuote(id: string): unknown {
    const quote = this.otherQuotes.get(id);
    if (!quote) throw new Refusal(20007, 'quote not found');
    return quote;
  }

  private mintQuote(id: string): MintQuoteBolt11Response {
    const quote = this.mintQuotes.get(id);
    if (!quote) throw new Refusal(20007, 'quote not found');
    return quote;
  }

  private mint(body: { quote: string; outputs: WireOutput[]; signature?: string }): MintResponse {
    const quote = this.mintQuote(body.quote);
    if (quote.state !== MintQuoteState.PAID) throw new Refusal(20002, 'quote already issued');
    const sum = this.checkOutputs(body.outputs);
    if (!quote.amount.equals(sum)) throw new Refusal(11002, 'outputs do not match quote');
    const outputs = body.outputs.map(normalizeOutput);
    if (
      !quote.pubkey ||
      !body.signature ||
      !verifyMintQuoteSignature(quote.pubkey, quote.quote, outputs, body.signature)
    ) {
      throw new Refusal(20008, 'quote signature invalid');
    }
    this.mintQuotes.set(quote.quote, {
      ...quote,
      state: MintQuoteState.ISSUED,
      amount_issued: quote.amount,
    });
    return { signatures: outputs.map((o) => this.sign(o)) };
  }

  private swap(body: { inputs: WireProof[]; outputs: WireOutput[] }): SwapResponse {
    const fee = this.fee(body.inputs.length);
    const total = this.checkInputs(body.inputs);
    const out = this.checkOutputs(body.outputs);
    if (total - fee !== out) throw new Refusal(11002, 'transaction is not balanced');
    this.spend(body.inputs, fee);
    return { signatures: body.outputs.map((o) => this.sign(normalizeOutput(o))) };
  }

  private createMeltQuote(body: { request: string }): MeltQuoteBolt11Response {
    const id = `melt-quote-${this.nextQuote++}`;
    const msat = bolt11AmountMsat(body.request);
    if (msat === null) throw new Refusal(11000, 'amountless invoice');
    const quote: MeltQuoteBolt11Response = {
      quote: id,
      request: body.request,
      amount: Amount.from(msat / 1000n),
      method: 'bolt11',
      fee_reserve: Amount.from(this.opts.feeReserve),
      unit,
      state: MeltQuoteState.UNPAID,
      expiry: 4102444800,
      payment_preimage: null,
    };
    this.meltQuotes.set(id, quote);
    return quote;
  }

  private meltQuote(id: string): MeltQuoteBolt11Response {
    const quote = this.meltQuotes.get(id);
    if (!quote) throw new Refusal(20007, 'quote not found');
    return quote;
  }

  private melt(body: {
    quote: string;
    inputs: WireProof[];
    outputs?: WireOutput[];
  }): MeltQuoteBolt11Response {
    const quote = this.meltQuote(body.quote);
    if (quote.state !== MeltQuoteState.UNPAID) throw new Refusal(20006, 'quote already paid');
    const fee = this.fee(body.inputs.length);
    const total = this.checkInputs(body.inputs);
    const blanks = body.outputs ?? [];
    this.checkOutputs(blanks);
    const due = quote.amount.toBigInt() + quote.fee_reserve.toBigInt();
    if (total - fee < due) throw new Refusal(11002, 'inputs do not cover the quote');
    const lnFee = BigInt(Math.min(this.opts.lnFee, this.opts.feeReserve));
    this.spend(body.inputs, fee + lnFee);
    const change = splitPow2(total - fee - quote.amount.toBigInt() - lnFee).slice(0, blanks.length);
    const paid: MeltQuoteBolt11Response = {
      ...quote,
      state: MeltQuoteState.PAID,
      payment_preimage: '00'.repeat(32),
      change: change.map((a, i) =>
        this.sign({ ...normalizeOutput(blanks[i]), amount: Amount.from(a) }),
      ),
    };
    this.meltQuotes.set(quote.quote, { ...paid, change: undefined });
    return paid;
  }

  private checkstate(body: { Ys: string[] }): CheckStateResponse {
    return {
      states: body.Ys.map((Y) => ({
        Y,
        state: this.spent.has(Y) ? CheckStateEnum.SPENT : CheckStateEnum.UNSPENT,
        witness: null,
      })),
    };
  }

  private restore(body: { outputs: WireOutput[] }): PostRestoreResponse {
    const res: PostRestoreResponse = { outputs: [], signatures: [] };
    for (const o of body.outputs) {
      const sig = this.signed.get(o.B_);
      if (!sig) continue;
      res.outputs.push({ amount: sig.amount, id: sig.id, B_: o.B_ });
      res.signatures.push(sig);
    }
    return res;
  }

  fee(nInputs: number): bigint {
    return BigInt(Math.ceil((nInputs * this.feePpk) / 1000));
  }

  /**
   * Signs as this mint, with a DLEQ proof when the mint offers them.
   */
  sign(o: SerializedBlindedMessage): SerializedBlindedSignature {
    const priv = this.keys.privKeys[o.amount.toString()];
    const B_ = pointFromHex(o.B_);
    const { C_ } = createBlindSignature(B_, priv, this.keysetId);
    const sig: SerializedBlindedSignature = {
      id: this.keysetId,
      amount: o.amount,
      C_: C_.toHex(true),
    };
    if (this.opts.dleq) {
      const { e, s } = createDLEQProof(B_, priv);
      sig.dleq = { e: bytesToHex(e), s: bytesToHex(s) };
    }
    this.signed.set(o.B_, sig);
    this.issued += o.amount.toBigInt();
    return sig;
  }

  /**
   * True when the mint signed this proof and has not seen it spent.
   */
  holds(p: Proof): boolean {
    const priv = this.keys.privKeys[p.amount.toString()];
    if (p.id !== this.keysetId || !priv || this.spent.has(proofY(p.secret))) return false;
    const key = `${p.id}:${p.amount.toString()}:${p.secret}:${p.C}`;
    let valid = verified.get(key);
    if (valid === undefined) {
      try {
        const C = pointFromHex(p.C);
        valid = verifyUnblindedSignature({ id: p.id, secret: utf8.encode(p.secret), C }, priv);
      } catch {
        valid = false;
      }
      verified.set(key, valid);
    }
    return valid;
  }

  private checkInputs(inputs: WireProof[]): bigint {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Refusal(11000, 'no inputs');
    const seen = new Set<string>();
    let total = 0n;
    for (const p of inputs) {
      const proof = { ...p, amount: Amount.from(p.amount) };
      const Y = proofY(p.secret);
      if (this.spent.has(Y)) throw new Refusal(11001, 'proof already spent');
      if (seen.has(Y)) throw new Refusal(11007, 'duplicate inputs');
      if (!this.holds(proof)) throw new Refusal(10003, 'proof could not be verified');
      seen.add(Y);
      total += proof.amount.toBigInt();
    }
    return total;
  }

  private checkOutputs(outputs: WireOutput[]): bigint {
    const seen = new Set<string>();
    let total = 0n;
    for (const o of outputs) {
      if (o.id !== this.keysetId) throw new Refusal(12001, 'unknown keyset');
      if (this.signed.has(o.B_) || seen.has(o.B_)) {
        throw new Refusal(10002, 'outputs have already been signed');
      }
      seen.add(o.B_);
      total += BigInt(o.amount);
    }
    return total;
  }

  private spend(inputs: WireProof[], fee: bigint): void {
    for (const p of inputs) {
      this.spent.add(proofY(p.secret));
      this.redeemed += BigInt(p.amount);
    }
    this.feesCharged += fee;
  }
}

/**
 * A bolt11 invoice for `sat` whose payment hash is never read.
 */
export function invoice(sat: number, salt: string): string {
  const tail = Array.from(utf8.encode(salt), (b) => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[b % 32]);
  return `lnbc${sat * 10}n1p${tail.join('')}`;
}

function normalizeOutput(o: WireOutput): SerializedBlindedMessage {
  return { amount: Amount.from(o.amount), id: o.id, B_: o.B_ };
}

function splitPow2(n: bigint): bigint[] {
  const parts: bigint[] = [];
  for (let bit = 8n; bit >= 1n; bit /= 2n) {
    while (n >= bit) {
      parts.push(bit);
      n -= bit;
    }
  }
  return parts;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function abortError(): Error {
  return new DOMException('This operation was aborted', 'AbortError');
}

function untilAborted(held: Promise<void>, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    held.then(resolve).catch(reject);
  });
}
