import { Buffer as X } from "buffer";
import { verifyDLEQProof_reblind as Gt } from "./crypto/client/NUT12.es.js";
import { pointFromHex as ct, hashToCurve as Pt } from "./crypto/common.es.js";
import { hexToBytes as $, bytesToHex as V } from "@noble/curves/abstract/utils";
import { sha256 as Vt } from "@noble/hashes/sha256";
import { signP2PKProofs as It } from "./crypto/client/NUT11.es.js";
import { signMintQuote as Jt } from "./crypto/client/NUT20.es.js";
import { constructProofFromPromise as Xt, serializeProof as Yt, blindMessage as ot } from "./crypto/client.es.js";
import { hexToBytes as Mt, bytesToHex as G, randomBytes as ft } from "@noble/hashes/utils";
import { deriveSecret as Zt, deriveBlindingFactor as te } from "./crypto/client/NUT09.es.js";
import { createCairoDataPayload as ee, cairoProveProofs as se } from "./crypto/client/NUTXX.es.js";
function ne(n) {
  return X.from(n).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function Rt(n) {
  return X.from(n, "base64");
}
function Ot(n) {
  const t = JSON.stringify(n);
  return ie(X.from(t).toString("base64"));
}
function re(n) {
  const t = X.from(oe(n), "base64").toString();
  return JSON.parse(t);
}
function oe(n) {
  return n.replace(/-/g, "+").replace(/_/g, "/").split("=")[0];
}
function ie(n) {
  return n.replace(/\+/g, "-").replace(/\//g, "_").split("=")[0];
}
function ae(n) {
  return typeof n == "number" || typeof n == "string";
}
function wt(n) {
  const t = [];
  return kt(n, t), new Uint8Array(t);
}
function kt(n, t) {
  if (n === null)
    t.push(246);
  else if (n === void 0)
    t.push(247);
  else if (typeof n == "boolean")
    t.push(n ? 245 : 244);
  else if (typeof n == "number")
    Ut(n, t);
  else if (typeof n == "string")
    Nt(n, t);
  else if (Array.isArray(n))
    ue(n, t);
  else if (n instanceof Uint8Array)
    ce(n, t);
  else if (
    // Defensive: POJO only (null/array handled above)
    typeof n == "object" && n !== null && !Array.isArray(n)
  )
    he(n, t);
  else
    throw new Error("Unsupported type");
}
function Ut(n, t) {
  if (n < 24)
    t.push(n);
  else if (n < 256)
    t.push(24, n);
  else if (n < 65536)
    t.push(25, n >> 8, n & 255);
  else if (n < 4294967296)
    t.push(26, n >> 24, n >> 16 & 255, n >> 8 & 255, n & 255);
  else
    throw new Error("Unsupported integer size");
}
function ce(n, t) {
  const e = n.length;
  if (e < 24)
    t.push(64 + e);
  else if (e < 256)
    t.push(88, e);
  else if (e < 65536)
    t.push(89, e >> 8 & 255, e & 255);
  else if (e < 4294967296)
    t.push(
      90,
      e >> 24 & 255,
      e >> 16 & 255,
      e >> 8 & 255,
      e & 255
    );
  else
    throw new Error("Byte string too long to encode");
  for (let s = 0; s < n.length; s++)
    t.push(n[s]);
}
function Nt(n, t) {
  const e = new TextEncoder().encode(n), s = e.length;
  if (s < 24)
    t.push(96 + s);
  else if (s < 256)
    t.push(120, s);
  else if (s < 65536)
    t.push(121, s >> 8 & 255, s & 255);
  else if (s < 4294967296)
    t.push(
      122,
      s >> 24 & 255,
      s >> 16 & 255,
      s >> 8 & 255,
      s & 255
    );
  else
    throw new Error("String too long to encode");
  for (let r = 0; r < e.length; r++)
    t.push(e[r]);
}
function ue(n, t) {
  const e = n.length;
  if (e < 24)
    t.push(128 | e);
  else if (e < 256)
    t.push(152, e);
  else if (e < 65536)
    t.push(153, e >> 8, e & 255);
  else
    throw new Error("Unsupported array length");
  for (const s of n)
    kt(s, t);
}
function he(n, t) {
  const e = Object.keys(n);
  Ut(e.length, t), t[t.length - 1] |= 160;
  for (const s of e)
    Nt(s, t), kt(n[s], t);
}
function bt(n) {
  const t = new DataView(n.buffer, n.byteOffset, n.byteLength);
  return ut(t, 0).value;
}
function ut(n, t) {
  if (t >= n.byteLength)
    throw new Error("Unexpected end of data");
  const e = n.getUint8(t++), s = e >> 5, r = e & 31;
  switch (s) {
    case 0:
      return le(n, t, r);
    case 1:
      return de(n, t, r);
    case 2:
      return fe(n, t, r);
    case 3:
      return pe(n, t, r);
    case 4:
      return me(n, t, r);
    case 5:
      return ge(n, t, r);
    case 7:
      return we(n, t, r);
    default:
      throw new Error(`Unsupported major type: ${s}`);
  }
}
function Y(n, t, e) {
  if (e < 24) return { value: e, offset: t };
  if (e === 24) return { value: n.getUint8(t++), offset: t };
  if (e === 25) {
    const s = n.getUint16(t, !1);
    return t += 2, { value: s, offset: t };
  }
  if (e === 26) {
    const s = n.getUint32(t, !1);
    return t += 4, { value: s, offset: t };
  }
  if (e === 27) {
    const s = n.getUint32(t, !1), r = n.getUint32(t + 4, !1);
    return t += 8, { value: s * 2 ** 32 + r, offset: t };
  }
  throw new Error(`Unsupported length: ${e}`);
}
function le(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e);
  return { value: s, offset: r };
}
function de(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e);
  return { value: -1 - s, offset: r };
}
function fe(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e);
  if (r + s > n.byteLength)
    throw new Error("Byte string length exceeds data length");
  return { value: new Uint8Array(n.buffer, n.byteOffset + r, s), offset: r + s };
}
function pe(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e);
  if (r + s > n.byteLength)
    throw new Error("String length exceeds data length");
  const o = new Uint8Array(n.buffer, n.byteOffset + r, s);
  return { value: new TextDecoder().decode(o), offset: r + s };
}
function me(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e), o = [];
  let i = r;
  for (let a = 0; a < s; a++) {
    const c = ut(n, i);
    o.push(c.value), i = c.offset;
  }
  return { value: o, offset: i };
}
function ge(n, t, e) {
  const { value: s, offset: r } = Y(n, t, e), o = {};
  let i = r;
  for (let a = 0; a < s; a++) {
    const c = ut(n, i);
    if (!ae(c.value))
      throw new Error("Invalid key type");
    const u = ut(n, c.offset);
    o[c.value] = u.value, i = u.offset;
  }
  return { value: o, offset: i };
}
function ye(n) {
  const t = (n & 31744) >> 10, e = n & 1023, s = n & 32768 ? -1 : 1;
  return t === 0 ? s * 2 ** -14 * (e / 1024) : t === 31 ? e ? NaN : s * (1 / 0) : s * 2 ** (t - 15) * (1 + e / 1024);
}
function we(n, t, e) {
  if (e < 24)
    switch (e) {
      case 20:
        return { value: !1, offset: t };
      case 21:
        return { value: !0, offset: t };
      case 22:
        return { value: null, offset: t };
      case 23:
        return { value: void 0, offset: t };
      default:
        throw new Error(`Unknown simple value: ${e}`);
    }
  if (e === 24) return { value: n.getUint8(t++), offset: t };
  if (e === 25) {
    const s = ye(n.getUint16(t, !1));
    return t += 2, { value: s, offset: t };
  }
  if (e === 26) {
    const s = n.getFloat32(t, !1);
    return t += 4, { value: s, offset: t };
  }
  if (e === 27) {
    const s = n.getFloat64(t, !1);
    return t += 8, { value: s, offset: t };
  }
  throw new Error(`Unknown simple or float value: ${e}`);
}
class _t {
  constructor(t, e, s, r, o, i, a = !1, c) {
    this.transport = t, this.id = e, this.amount = s, this.unit = r, this.mints = o, this.description = i, this.singleUse = a, this.nut10 = c;
  }
  toRawRequest() {
    const t = {};
    return this.transport && (t.t = this.transport.map((e) => ({
      t: e.type,
      a: e.target,
      g: e.tags
    }))), this.id && (t.i = this.id), this.amount && (t.a = this.amount), this.unit && (t.u = this.unit), this.mints && (t.m = this.mints), this.description && (t.d = this.description), this.singleUse && (t.s = this.singleUse), this.nut10 && (t.nut10 = {
      k: this.nut10.kind,
      d: this.nut10.data,
      t: this.nut10.tags
    }), t;
  }
  toEncodedRequest() {
    const t = this.toRawRequest(), e = wt(t);
    return "creqA" + X.from(e).toString("base64");
  }
  getTransport(t) {
    return this.transport?.find((e) => e.type === t);
  }
  static fromRawRequest(t) {
    const e = t.t ? t.t.map((r) => ({
      type: r.t,
      target: r.a,
      tags: r.g
    })) : void 0, s = t.nut10 ? {
      kind: t.nut10.k,
      data: t.nut10.d,
      tags: t.nut10.t
    } : void 0;
    return new _t(
      e,
      t.i,
      t.a,
      t.u,
      t.m,
      t.d,
      t.s,
      s
    );
  }
  static fromEncodedRequest(t) {
    if (!t.startsWith("creq"))
      throw new Error("unsupported pr: invalid prefix");
    if (t[4] !== "A")
      throw new Error("unsupported pr version");
    const s = t.slice(5), r = Rt(s), o = bt(r);
    return this.fromRawRequest(o);
  }
}
const ke = "A", be = "cashu";
function K(n, t, e, s) {
  if (e) {
    const o = xt(e);
    if (o > n)
      throw new Error(`Split is greater than total amount: ${o} > ${n}`);
    if (e.some((i) => !Bt(i, t)))
      throw new Error("Provided amount preferences do not match the amounts of the mint keyset.");
    n = n - xt(e);
  } else
    e = [];
  return Ft(t, "desc").forEach((o) => {
    const i = Math.floor(n / o);
    for (let a = 0; a < i; ++a) e?.push(o);
    n %= o;
  }), e.sort((o, i) => o - i);
}
function vt(n, t, e, s) {
  const r = [], o = n.map((u) => u.amount);
  Ft(e, "asc").forEach((u) => {
    const h = o.filter((d) => d === u).length, l = Math.max(s - h, 0);
    for (let d = 0; d < l && !(r.reduce((m, b) => m + b, 0) + u > t); ++d)
      r.push(u);
  });
  const a = t - r.reduce((u, h) => u + h, 0);
  return a && K(a, e).forEach((h) => {
    r.push(h);
  }), r.sort((u, h) => u - h);
}
function Ft(n, t = "desc") {
  return t == "desc" ? Object.keys(n).map((e) => parseInt(e)).sort((e, s) => s - e) : Object.keys(n).map((e) => parseInt(e)).sort((e, s) => e - s);
}
function Bt(n, t) {
  return n in t;
}
function _e(n) {
  return Lt(V(n));
}
function Lt(n) {
  return BigInt(`0x${n}`);
}
function Ee(n) {
  return n.toString(16).padStart(64, "0");
}
function Tt(n) {
  return /^[a-f0-9]*$/i.test(n);
}
function Ct(n) {
  return Array.isArray(n) ? n.some((t) => !Tt(t.id)) : Tt(n.id);
}
function Ae(n, t) {
  t && (n.proofs = ht(n.proofs));
  const e = { token: [{ mint: n.mint, proofs: n.proofs }] };
  return n.unit && (e.unit = n.unit), n.memo && (e.memo = n.memo), be + ke + Ot(e);
}
function ts(n, t) {
  if (Ct(n.proofs) || t?.version === 3) {
    if (t?.version === 4)
      throw new Error("can not encode to v4 token if proofs contain non-hex keyset id");
    return Ae(n, t?.removeDleq);
  }
  return Se(n, t?.removeDleq);
}
function Se(n, t) {
  if (t && (n.proofs = ht(n.proofs)), n.proofs.forEach((c) => {
    if (c.dleq && c.dleq.r == null)
      throw new Error("Missing blinding factor in included DLEQ proof");
  }), Ct(n.proofs))
    throw new Error("can not encode to v4 token if proofs contain non-hex keyset id");
  const s = Wt(n), r = wt(s), o = "cashu", i = "B", a = ne(r);
  return o + i + a;
}
function Wt(n) {
  const t = {}, e = n.mint;
  for (let r = 0; r < n.proofs.length; r++) {
    const o = n.proofs[r];
    t[o.id] ? t[o.id].push(o) : t[o.id] = [o];
  }
  const s = {
    m: e,
    u: n.unit || "sat",
    t: Object.keys(t).map(
      (r) => ({
        i: $(r),
        p: t[r].map(
          (o) => ({
            a: o.amount,
            s: o.secret,
            c: $(o.C),
            ...o.dleq && {
              d: {
                e: $(o.dleq.e),
                s: $(o.dleq.s),
                r: $(o.dleq.r ?? "00")
              }
            },
            ...o.witness && {
              w: JSON.stringify(o.witness)
            }
          })
        )
      })
    )
  };
  return n.memo && (s.d = n.memo), s;
}
function Qt(n) {
  const t = [];
  n.t.forEach(
    (s) => s.p.forEach((r) => {
      t.push({
        secret: r.s,
        C: V(r.c),
        amount: r.a,
        id: V(s.i),
        ...r.d && {
          dleq: {
            r: V(r.d.r),
            s: V(r.d.s),
            e: V(r.d.e)
          }
        },
        ...r.w && {
          witness: r.w
        }
      });
    })
  );
  const e = { mint: n.m, proofs: t, unit: n.u || "sat" };
  return n.d && (e.memo = n.d), e;
}
function Pe(n) {
  return ["web+cashu://", "cashu://", "cashu:", "cashu"].forEach((e) => {
    n.startsWith(e) && (n = n.slice(e.length));
  }), Ie(n);
}
function Ie(n) {
  const t = n.slice(0, 1), e = n.slice(1);
  if (t === "A") {
    const s = re(e);
    if (s.token.length > 1)
      throw new Error("Multi entry token are not supported");
    const r = s.token[0], o = {
      mint: r.mint,
      proofs: r.proofs,
      unit: s.unit || "sat"
    };
    return s.memo && (o.memo = s.memo), o;
  } else if (t === "B") {
    const s = Rt(e), r = bt(s);
    return Qt(r);
  }
  throw new Error("Token version is not supported");
}
function qt(n) {
  return Me(n.keys) === n.id;
}
function Me(n) {
  const t = Object.entries(n).sort((r, o) => +r[0] - +o[0]).map(([, r]) => $(r)).reduce((r, o) => ve(r, o), new Uint8Array()), e = Vt(t);
  return "00" + X.from(e).toString("hex").slice(0, 14);
}
function ve(n, t) {
  const e = new Uint8Array(n.length + t.length);
  return e.set(n), e.set(t, n.length), e;
}
function C(n) {
  return typeof n == "object";
}
function T(...n) {
  return n.map((t) => t.replace(/(^\/+|\/+$)/g, "")).join("/");
}
function jt(n) {
  return n.replace(/\/$/, "");
}
function H(n) {
  return n.reduce((t, e) => t + e.amount, 0);
}
function es(n) {
  return _t.fromEncodedRequest(n);
}
class Te {
  get value() {
    return this._value;
  }
  set value(t) {
    this._value = t;
  }
  get next() {
    return this._next;
  }
  set next(t) {
    this._next = t;
  }
  constructor(t) {
    this._value = t, this._next = null;
  }
}
class qe {
  get first() {
    return this._first;
  }
  set first(t) {
    this._first = t;
  }
  get last() {
    return this._last;
  }
  set last(t) {
    this._last = t;
  }
  get size() {
    return this._size;
  }
  set size(t) {
    this._size = t;
  }
  constructor() {
    this._first = null, this._last = null, this._size = 0;
  }
  enqueue(t) {
    const e = new Te(t);
    return this._size === 0 || !this._last ? (this._first = e, this._last = e) : (this._last.next = e, this._last = e), this._size++, !0;
  }
  dequeue() {
    if (this._size === 0 || !this._first) return null;
    const t = this._first;
    return this._first = t.next, t.next = null, this._size--, t.value;
  }
}
function ht(n) {
  return n.map((t) => {
    const e = { ...t };
    return delete e.dleq, e;
  });
}
function $t(n, t) {
  if (n.dleq == null)
    return !1;
  const e = {
    e: $(n.dleq.e),
    s: $(n.dleq.s),
    r: Lt(n.dleq.r ?? "00")
  };
  if (!Bt(n.amount, t.keys))
    throw new Error(`undefined key for amount ${n.amount}`);
  const s = t.keys[n.amount];
  return !!Gt(
    new TextEncoder().encode(n.secret),
    e,
    ct(n.C),
    ct(s)
  );
}
function xe(...n) {
  const t = n.reduce((r, o) => r + o.length, 0), e = new Uint8Array(t);
  let s = 0;
  for (let r = 0; r < n.length; r++)
    e.set(n[r], s), s = s + n[r].length;
  return e;
}
function ss(n) {
  const t = new TextEncoder(), e = Wt(n), s = wt(e), r = t.encode("craw"), o = t.encode("B");
  return xe(r, o, s);
}
function ns(n) {
  const t = new TextDecoder(), e = t.decode(n.slice(0, 4)), s = t.decode(new Uint8Array([n[4]]));
  if (e !== "craw" || s !== "B")
    throw new Error("not a valid binary token");
  const r = n.slice(5), o = bt(r);
  return Qt(o);
}
function xt(n) {
  return n.reduce((t, e) => t + e, 0);
}
let lt;
typeof WebSocket < "u" && (lt = WebSocket);
function rs(n) {
  lt = n;
}
function De() {
  if (lt === void 0)
    throw new Error("WebSocket implementation not initialized");
  return lt;
}
const I = {
  FATAL: "FATAL",
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
  TRACE: "TRACE"
}, W = {
  fatal() {
  },
  error() {
  },
  warn() {
  },
  info() {
  },
  debug() {
  },
  trace() {
  },
  log() {
  }
}, tt = class tt {
  constructor(t = I.INFO) {
    this.minLevel = t;
  }
  logToConsole(t, e, s) {
    if (tt.SEVERITY[t] > tt.SEVERITY[this.minLevel]) return;
    const r = `[${t}] `;
    let o = e;
    const i = /* @__PURE__ */ new Set();
    if (s) {
      const a = Object.fromEntries(
        Object.entries(s).map(([h, l]) => [
          h,
          l instanceof Error ? { message: l.message, stack: l.stack } : l
        ])
      );
      o = e.replace(/\{(\w+)\}/g, (h, l) => {
        if (l in a && a[l] !== void 0) {
          i.add(l);
          const d = a[l];
          return typeof d == "string" ? d : typeof d == "number" || typeof d == "boolean" ? d.toString() : d == null ? "" : JSON.stringify(d);
        }
        return h;
      });
      const c = Object.fromEntries(
        Object.entries(a).filter(([h]) => !i.has(h))
      ), u = this.getConsoleMethod(t);
      Object.keys(c).length > 0 ? u(r + o, c) : u(r + o);
    } else
      this.getConsoleMethod(t)(r + o);
  }
  // Note: NOT static as test suite needs to spy on the output
  getConsoleMethod(t) {
    switch (t) {
      case I.FATAL:
      case I.ERROR:
        return console.error;
      case I.WARN:
        return console.warn;
      case I.INFO:
        return console.info;
      case I.DEBUG:
        return console.debug;
      case I.TRACE:
        return console.trace;
      default:
        return console.log;
    }
  }
  // Interface methods
  fatal(t, e) {
    this.logToConsole(I.FATAL, t, e);
  }
  error(t, e) {
    this.logToConsole(I.ERROR, t, e);
  }
  warn(t, e) {
    this.logToConsole(I.WARN, t, e);
  }
  info(t, e) {
    this.logToConsole(I.INFO, t, e);
  }
  debug(t, e) {
    this.logToConsole(I.DEBUG, t, e);
  }
  trace(t, e) {
    this.logToConsole(I.TRACE, t, e);
  }
  log(t, e, s) {
    this.logToConsole(t, e, s);
  }
};
tt.SEVERITY = {
  [I.FATAL]: 0,
  [I.ERROR]: 1,
  [I.WARN]: 2,
  [I.INFO]: 3,
  [I.DEBUG]: 4,
  [I.TRACE]: 5
};
let Dt = tt;
function Ke() {
  const n = Date.now();
  return {
    elapsed: () => Date.now() - n
  };
}
class J {
  constructor() {
    this.connectionMap = /* @__PURE__ */ new Map();
  }
  static getInstance() {
    return J.instance || (J.instance = new J()), J.instance;
  }
  getConnection(t, e) {
    if (this.connectionMap.has(t))
      return this.connectionMap.get(t);
    const s = new Re(t, e);
    return this.connectionMap.set(t, s), s;
  }
}
class Re {
  constructor(t, e) {
    this.subListeners = {}, this.rpcListeners = {}, this.rpcId = 0, this.onCloseCallbacks = [], this._WS = De(), this.url = new URL(t), this.messageQueue = new qe(), this._logger = e ?? W;
  }
  connect() {
    return this.connectionPromise || (this.connectionPromise = new Promise((t, e) => {
      try {
        this.ws = new this._WS(this.url.toString()), this.onCloseCallbacks = [];
      } catch (s) {
        e(s instanceof Error ? s : new Error(String(s)));
        return;
      }
      this.ws.onopen = () => {
        t();
      }, this.ws.onerror = () => {
        e(new Error("Failed to open WebSocket"));
      }, this.ws.onmessage = (s) => {
        this.messageQueue.enqueue(s.data), this.handlingInterval || (this.handlingInterval = setInterval(
          this.handleNextMessage.bind(this),
          0
        ));
      }, this.ws.onclose = (s) => {
        this.connectionPromise = void 0, this.onCloseCallbacks.forEach((r) => r(s));
      };
    })), this.connectionPromise;
  }
  sendRequest(t, e) {
    if (this.ws?.readyState !== 1) {
      if (t === "unsubscribe")
        return;
      throw this._logger.error("Attempted sendRequest, but socket was not open"), new Error("Socket not open");
    }
    const s = this.rpcId;
    this.rpcId++;
    const r = JSON.stringify({ jsonrpc: "2.0", method: t, params: e, id: s });
    this.ws?.send(r);
  }
  /**
   * @deprecated Use cancelSubscription for JSONRPC compliance.
   */
  closeSubscription(t) {
    this.ws?.send(JSON.stringify(["CLOSE", t]));
  }
  addSubListener(t, e) {
    (this.subListeners[t] = this.subListeners[t] || []).push(
      e
    );
  }
  addRpcListener(t, e, s) {
    this.rpcListeners[s] = { callback: t, errorCallback: e };
  }
  removeRpcListener(t) {
    delete this.rpcListeners[t];
  }
  removeListener(t, e) {
    if (this.subListeners[t]) {
      if (this.subListeners[t].length === 1) {
        delete this.subListeners[t];
        return;
      }
      this.subListeners[t] = this.subListeners[t].filter(
        (s) => s !== e
      );
    }
  }
  async ensureConnection() {
    this.ws?.readyState !== 1 && await this.connect();
  }
  handleNextMessage() {
    if (this.messageQueue.size === 0) {
      clearInterval(this.handlingInterval), this.handlingInterval = void 0;
      return;
    }
    const t = this.messageQueue.dequeue();
    let e;
    try {
      if (e = JSON.parse(t), "result" in e && e.id != null)
        this.rpcListeners[e.id] && (this.rpcListeners[e.id].callback(), this.removeRpcListener(e.id));
      else if ("error" in e && e.id != null)
        this.rpcListeners[e.id] && (this.rpcListeners[e.id].errorCallback(new Error(e.error.message)), this.removeRpcListener(e.id));
      else if ("method" in e && !("id" in e)) {
        const s = e.params?.subId;
        if (!s)
          return;
        if (this.subListeners[s]?.length > 0) {
          const r = e;
          this.subListeners[s].forEach((o) => o(r.params?.payload));
        }
      }
    } catch (s) {
      this._logger.error("Error doing handleNextMessage", { e: s });
      return;
    }
  }
  createSubscription(t, e, s) {
    if (this.ws?.readyState !== 1)
      throw this._logger.error("Attempted createSubscription, but socket was not open"), new Error("Socket is not open");
    const r = (Math.random() + 1).toString(36).substring(7);
    return this.addRpcListener(
      () => {
        this.addSubListener(r, e);
      },
      s,
      this.rpcId
    ), this.sendRequest("subscribe", { ...t, subId: r }), this.rpcId++, r;
  }
  /**
   * Cancels a subscription, sending an unsubscribe request and handling responses.
   *
   * @param subId The subscription ID to cancel.
   * @param callback The original payload callback to remove.
   * @param errorCallback Optional callback for unsubscribe errors (defaults to logging).
   */
  cancelSubscription(t, e, s) {
    this.removeListener(t, e), this.addRpcListener(
      () => {
        this._logger.info("Unsubscribed {subId}", { subId: t });
      },
      s || ((r) => this._logger.error("Unsubscribe failed", { e: r })),
      this.rpcId
    ), this.sendRequest("unsubscribe", { subId: t });
  }
  get activeSubscriptions() {
    return Object.keys(this.subListeners);
  }
  close() {
    this.ws && this.ws?.close();
  }
  onClose(t) {
    this.onCloseCallbacks.push(t);
  }
}
const os = {
  UNSPENT: "UNSPENT",
  PENDING: "PENDING",
  SPENT: "SPENT"
}, et = {
  UNPAID: "UNPAID",
  PENDING: "PENDING",
  PAID: "PAID"
}, gt = {
  UNPAID: "UNPAID",
  PAID: "PAID",
  ISSUED: "ISSUED"
};
var Oe = /* @__PURE__ */ ((n) => (n.POST = "post", n.NOSTR = "nostr", n))(Oe || {});
class st extends Error {
  constructor(t, e) {
    super(t), this.status = e, this.name = "HttpResponseError", Object.setPrototypeOf(this, st.prototype);
  }
}
class Et extends Error {
  constructor(t) {
    super(t), this.name = "NetworkError", Object.setPrototypeOf(this, Et.prototype);
  }
}
class At extends st {
  constructor(t, e) {
    super(e || "Unknown mint operation error", 400), this.code = t, this.name = "MintOperationError", Object.setPrototypeOf(this, At.prototype);
  }
}
let Ht = {}, at = W;
function is(n) {
  Ht = n;
}
function Ue(n) {
  at = n;
}
async function Ne({
  endpoint: n,
  requestBody: t,
  headers: e,
  ...s
}) {
  const r = t ? JSON.stringify(t) : void 0, o = {
    Accept: "application/json, text/plain, */*",
    ...r ? { "Content-Type": "application/json" } : void 0,
    ...e
  };
  let i;
  try {
    at.debug?.("HTTP request", {
      method: s.method ?? "GET",
      url: n,
      bodyLength: r?.length ?? 0,
      headers: o
    }), i = await fetch(n, { body: r, headers: o, ...s });
  } catch (u) {
    throw new Et(u instanceof Error ? u.message : "Network request failed");
  }
  const a = i.headers.get("content-type") ?? "", c = await i.text().catch(() => {
  });
  if (!i.ok) {
    let u = "HTTP request failed", h;
    if (a.includes("application/json") && c)
      try {
        h = JSON.parse(c);
      } catch {
      }
    else if (c && c.trim().startsWith("{"))
      try {
        h = JSON.parse(c);
      } catch {
      }
    let l = h && typeof h == "object" ? h : void 0;
    throw i.status === 400 && l && "code" in l && typeof l.code == "number" && "detail" in l && typeof l.detail == "string" ? new At(l.code, l.detail) : (l ? "error" in l && typeof l.error == "string" ? u = l.error : "detail" in l && typeof l.detail == "string" && (u = l.detail) : c && c.trim().length > 0 ? u = c.trim() : u = "bad response", at.error?.("HTTP error response", {
      method: s.method ?? "GET",
      url: n,
      status: i.status,
      statusText: i.statusText,
      contentType: a,
      bodySnippet: c ? c.slice(0, 2e3) : void 0
    }), new st(u, i.status));
  }
  try {
    return c && c.length > 0 ? JSON.parse(c) : null;
  } catch (u) {
    throw at.error?.("Failed to parse HTTP response", {
      err: u instanceof Error ? u.message : String(u),
      url: n,
      status: i.status,
      contentType: a,
      bodySnippet: c ? c.slice(0, 2e3) : void 0
    }), new st("bad response", i.status);
  }
}
async function D(n) {
  return await Ne({ ...n, ...Ht });
}
function pt(n, t) {
  return n.state || (t.warn(
    "Field 'state' not found in MeltQuoteResponse. Update NUT-05 of mint: https://github.com/cashubtc/nuts/pull/136)"
  ), typeof n.paid == "boolean" && (n.state = n.paid ? et.PAID : et.UNPAID)), n;
}
function Kt(n, t) {
  return n.state || (t.warn(
    "Field 'state' not found in MintQuoteResponse. Update NUT-04 of mint: https://github.com/cashubtc/nuts/pull/141)"
  ), typeof n.paid == "boolean" && (n.state = n.paid ? gt.PAID : gt.UNPAID)), n;
}
function Fe(n, t) {
  return Array.isArray(n?.contact) && n?.contact.length > 0 && (n.contact = n.contact.map((e) => Array.isArray(e) && e.length === 2 && typeof e[0] == "string" && typeof e[1] == "string" ? (t.warn(
    "Mint returned deprecated 'contact' field: Update NUT-06: https://github.com/cashubtc/nuts/pull/117"
  ), { method: e[0], info: e[1] }) : e)), n;
}
class yt {
  constructor(t) {
    this._mintInfo = t, t.nuts[22] && (this._protectedEnpoints = {
      cache: {},
      apiReturn: t.nuts[22].protected_endpoints.map((e) => ({
        method: e.method,
        regex: new RegExp(e.path)
      }))
    });
  }
  isSupported(t) {
    switch (t) {
      case 4:
      case 5:
        return this.checkMintMelt(t);
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 14:
      case 20:
        return this.checkGenericNut(t);
      case 17:
        return this.checkNut17();
      case 15:
        return this.checkNut15();
      default:
        throw new Error("nut is not supported by cashu-ts");
    }
  }
  requiresBlindAuthToken(t) {
    if (!this._protectedEnpoints)
      return !1;
    if (typeof this._protectedEnpoints.cache[t] == "boolean")
      return this._protectedEnpoints.cache[t];
    const e = this._protectedEnpoints.apiReturn.some((s) => s.regex.test(t));
    return this._protectedEnpoints.cache[t] = e, e;
  }
  checkGenericNut(t) {
    return this._mintInfo.nuts[t]?.supported ? { supported: !0 } : { supported: !1 };
  }
  checkMintMelt(t) {
    const e = this._mintInfo.nuts[t];
    return e && e.methods.length > 0 && !e.disabled ? { disabled: !1, params: e.methods } : { disabled: !0, params: e.methods };
  }
  checkNut17() {
    return this._mintInfo.nuts[17] && this._mintInfo.nuts[17].supported.length > 0 ? { supported: !0, params: this._mintInfo.nuts[17].supported } : { supported: !1 };
  }
  checkNut15() {
    return this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0 ? { supported: !0, params: this._mintInfo.nuts[15].methods } : { supported: !1 };
  }
  get contact() {
    return this._mintInfo.contact;
  }
  get description() {
    return this._mintInfo.description;
  }
  get description_long() {
    return this._mintInfo.description_long;
  }
  get name() {
    return this._mintInfo.name;
  }
  get pubkey() {
    return this._mintInfo.pubkey;
  }
  get nuts() {
    return this._mintInfo.nuts;
  }
  get version() {
    return this._mintInfo.version;
  }
  get motd() {
    return this._mintInfo.motd;
  }
}
class O {
  /**
   * @param _mintUrl Requires mint URL to create this object.
   * @param _customRequest If passed, use custom request implementation for network communication
   *   with the mint.
   * @param [authTokenGetter] A function that is called by the CashuMint instance to obtain a NUT-22
   *   BlindedAuthToken (e.g. from a database or localstorage)
   */
  constructor(t, e, s, r) {
    this._mintUrl = t, this._customRequest = e, this._checkNut22 = !1, this._mintUrl = jt(t), this._customRequest = e, s && (this._checkNut22 = !0, this._authTokenGetter = s), this._logger = r?.logger ?? W, Ue(this._logger);
  }
  //TODO: v3 - refactor CashuMint to take two or less args.
  get mintUrl() {
    return this._mintUrl;
  }
  /**
   * Fetches mints info at the /info endpoint.
   *
   * @param mintUrl
   * @param customRequest
   */
  static async getInfo(t, e, s) {
    const r = s ?? W, i = await (e || D)({
      endpoint: T(t, "/v1/info")
    });
    return Fe(i, r);
  }
  /**
   * Fetches mints info at the /info endpoint.
   */
  async getInfo() {
    return O.getInfo(this._mintUrl, this._customRequest, this._logger);
  }
  async getLazyMintInfo() {
    if (this._mintInfo)
      return this._mintInfo;
    const t = await O.getInfo(this._mintUrl, this._customRequest);
    return this._mintInfo = new yt(t), this._mintInfo;
  }
  /**
   * Performs a swap operation with ecash inputs and outputs.
   *
   * @param mintUrl
   * @param swapPayload Payload containing inputs and outputs.
   * @param customRequest
   * @returns Signed outputs.
   */
  static async swap(t, e, s, r) {
    const o = s || D, i = r ? { "Blind-auth": r } : {}, a = await o({
      endpoint: T(t, "/v1/swap"),
      method: "POST",
      requestBody: e,
      headers: i
    });
    if (!C(a) || !Array.isArray(a?.signatures))
      throw new Error(a.detail ?? "bad response");
    return a;
  }
  /**
   * Performs a swap operation with ecash inputs and outputs.
   *
   * @param swapPayload Payload containing inputs and outputs.
   * @returns Signed outputs.
   */
  async swap(t) {
    const e = await this.handleBlindAuth("/v1/swap");
    return O.swap(this._mintUrl, t, this._customRequest, e);
  }
  /**
   * Requests a new mint quote from the mint.
   *
   * @param mintUrl
   * @param mintQuotePayload Payload for creating a new mint quote.
   * @param customRequest
   * @returns The mint will create and return a new mint quote containing a payment request for the
   *   specified amount and unit.
   */
  static async createMintQuote(t, e, s, r, o) {
    const i = o ?? W, a = s || D, c = r ? { "Blind-auth": r } : {}, u = await a({
      endpoint: T(t, "/v1/mint/quote/bolt11"),
      method: "POST",
      requestBody: e,
      headers: c
    });
    return Kt(u, i);
  }
  /**
   * Requests a new mint quote from the mint.
   *
   * @param mintQuotePayload Payload for creating a new mint quote.
   * @returns The mint will create and return a new mint quote containing a payment request for the
   *   specified amount and unit.
   */
  async createMintQuote(t) {
    const e = await this.handleBlindAuth("/v1/mint/quote/bolt11");
    return O.createMintQuote(
      this._mintUrl,
      t,
      this._customRequest,
      e
    );
  }
  /**
   * Gets an existing mint quote from the mint.
   *
   * @param mintUrl
   * @param quote Quote ID.
   * @param customRequest
   * @returns The mint will create and return a Lightning invoice for the specified amount.
   */
  static async checkMintQuote(t, e, s, r, o) {
    const i = o ?? W, a = s || D, c = r ? { "Blind-auth": r } : {}, u = await a({
      endpoint: T(t, "/v1/mint/quote/bolt11", e),
      method: "GET",
      headers: c
    });
    return Kt(u, i);
  }
  /**
   * Gets an existing mint quote from the mint.
   *
   * @param quote Quote ID.
   * @returns The mint will create and return a Lightning invoice for the specified amount.
   */
  async checkMintQuote(t) {
    const e = await this.handleBlindAuth(`/v1/mint/quote/bolt11/${t}`);
    return O.checkMintQuote(this._mintUrl, t, this._customRequest, e);
  }
  /**
   * Mints new tokens by requesting blind signatures on the provided outputs.
   *
   * @param mintUrl
   * @param mintPayload Payload containing the outputs to get blind signatures on.
   * @param customRequest
   * @returns Serialized blinded signatures.
   */
  static async mint(t, e, s, r) {
    const o = s || D, i = r ? { "Blind-auth": r } : {}, a = await o({
      endpoint: T(t, "/v1/mint/bolt11"),
      method: "POST",
      requestBody: e,
      headers: i
    });
    if (!C(a) || !Array.isArray(a?.signatures))
      throw new Error("bad response");
    return a;
  }
  /**
   * Mints new tokens by requesting blind signatures on the provided outputs.
   *
   * @param mintPayload Payload containing the outputs to get blind signatures on.
   * @returns Serialized blinded signatures.
   */
  async mint(t) {
    const e = await this.handleBlindAuth("/v1/mint/bolt11");
    return O.mint(this._mintUrl, t, this._customRequest, e);
  }
  /**
   * Requests a new melt quote from the mint.
   *
   * @param mintUrl
   * @param MeltQuotePayload
   * @returns
   */
  static async createMeltQuote(t, e, s, r, o) {
    const i = o ?? W, a = s || D, c = r ? { "Blind-auth": r } : {}, u = await a({
      endpoint: T(t, "/v1/melt/quote/bolt11"),
      method: "POST",
      requestBody: e,
      headers: c
    }), h = pt(u, i);
    if (!C(h) || typeof h?.amount != "number" || typeof h?.fee_reserve != "number" || typeof h?.quote != "string")
      throw new Error("bad response");
    return h;
  }
  /**
   * Requests a new melt quote from the mint.
   *
   * @param MeltQuotePayload
   * @returns
   */
  async createMeltQuote(t) {
    const e = await this.handleBlindAuth("/v1/melt/quote/bolt11");
    return O.createMeltQuote(
      this._mintUrl,
      t,
      this._customRequest,
      e
    );
  }
  /**
   * Gets an existing melt quote.
   *
   * @param mintUrl
   * @param quote Quote ID.
   * @returns
   */
  static async checkMeltQuote(t, e, s, r, o) {
    const i = o ?? W, a = s || D, c = r ? { "Blind-auth": r } : {}, u = await a({
      endpoint: T(t, "/v1/melt/quote/bolt11", e),
      method: "GET",
      headers: c
    }), h = pt(u, i);
    if (!C(h) || typeof h?.amount != "number" || typeof h?.fee_reserve != "number" || typeof h?.quote != "string" || typeof h?.state != "string" || !Object.values(et).includes(h.state))
      throw new Error("bad response");
    return h;
  }
  /**
   * Gets an existing melt quote.
   *
   * @param quote Quote ID.
   * @returns
   */
  async checkMeltQuote(t) {
    const e = await this.handleBlindAuth(`/v1/melt/quote/bolt11/${t}`);
    return O.checkMeltQuote(this._mintUrl, t, this._customRequest, e);
  }
  /**
   * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
   * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
   * also contain blank outputs in order to receive back overpaid Lightning fees.
   *
   * @param mintUrl
   * @param meltPayload
   * @param customRequest
   * @returns
   */
  static async melt(t, e, s, r, o) {
    const i = o ?? W, a = s || D, c = r ? { "Blind-auth": r } : {}, u = await a({
      endpoint: T(t, "/v1/melt/bolt11"),
      method: "POST",
      requestBody: e,
      headers: c
    }), h = pt(u, i);
    if (!C(h) || typeof h?.state != "string" || !Object.values(et).includes(h.state))
      throw new Error("bad response");
    return h;
  }
  /**
   * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens
   * matching its amount + fees.
   *
   * @param meltPayload
   * @returns
   */
  async melt(t) {
    const e = await this.handleBlindAuth("/v1/melt/bolt11");
    return O.melt(this._mintUrl, t, this._customRequest, e);
  }
  /**
   * Checks if specific proofs have already been redeemed.
   *
   * @param mintUrl
   * @param checkPayload
   * @param customRequest
   * @returns Redeemed and unredeemed ordered list of booleans.
   */
  static async check(t, e, s) {
    const o = await (s || D)({
      endpoint: T(t, "/v1/checkstate"),
      method: "POST",
      requestBody: e
    });
    if (!C(o) || !Array.isArray(o?.states))
      throw new Error("bad response");
    return o;
  }
  /**
   * Get the mints public keys.
   *
   * @param mintUrl
   * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
   *   keys from all active keysets are fetched.
   * @param customRequest
   * @returns
   */
  static async getKeys(t, e, s) {
    e && (e = e.replace(/\//g, "_").replace(/\+/g, "-"));
    const o = await (s || D)({
      endpoint: e ? T(t, "/v1/keys", e) : T(t, "/v1/keys")
    });
    if (!C(o) || !Array.isArray(o.keysets))
      throw new Error("bad response");
    return o;
  }
  /**
   * Get the mints public keys.
   *
   * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
   *   keys from all active keysets are fetched.
   * @returns The mints public keys.
   */
  async getKeys(t, e) {
    return await O.getKeys(
      e || this._mintUrl,
      t,
      this._customRequest
    );
  }
  /**
   * Get the mints keysets in no specific order.
   *
   * @param mintUrl
   * @param customRequest
   * @returns All the mints past and current keysets.
   */
  static async getKeySets(t, e) {
    return (e || D)({ endpoint: T(t, "/v1/keysets") });
  }
  /**
   * Get the mints keysets in no specific order.
   *
   * @returns All the mints past and current keysets.
   */
  async getKeySets() {
    return O.getKeySets(this._mintUrl, this._customRequest);
  }
  /**
   * Checks if specific proofs have already been redeemed.
   *
   * @param checkPayload
   * @returns Redeemed and unredeemed ordered list of booleans.
   */
  async check(t) {
    return O.check(this._mintUrl, t, this._customRequest);
  }
  static async restore(t, e, s) {
    const o = await (s || D)({
      endpoint: T(t, "/v1/restore"),
      method: "POST",
      requestBody: e
    });
    if (!C(o) || !Array.isArray(o?.outputs) || !Array.isArray(o?.signatures))
      throw new Error("bad response");
    return o;
  }
  async restore(t) {
    return O.restore(this._mintUrl, t, this._customRequest);
  }
  /**
   * Tries to establish a websocket connection with the websocket mint url according to NUT-17.
   */
  async connectWebSocket() {
    if (this.ws)
      await this.ws.ensureConnection();
    else {
      const t = new URL(this._mintUrl), e = "v1/ws";
      t.pathname && (t.pathname.endsWith("/") ? t.pathname += e : t.pathname += "/" + e), this.ws = J.getInstance().getConnection(
        `${t.protocol === "https:" ? "wss" : "ws"}://${t.host}${t.pathname}`
      );
      try {
        await this.ws.connect();
      } catch (s) {
        throw this._logger.error("Failed to connect to WebSocket...", { e: s }), new Error("Failed to connect to WebSocket...");
      }
    }
  }
  /**
   * Closes a websocket connection.
   */
  disconnectWebSocket() {
    this.ws && this.ws.close();
  }
  get webSocketConnection() {
    return this.ws;
  }
  async handleBlindAuth(t) {
    if (!this._checkNut22)
      return;
    if ((await this.getLazyMintInfo()).requiresBlindAuthToken(t)) {
      if (!this._authTokenGetter)
        throw new Error("Can not call a protected endpoint without authProofGetter");
      return this._authTokenGetter();
    }
  }
}
class it {
  constructor(t, e, s) {
    this.amount = t, this.B_ = e, this.id = s;
  }
  getSerializedBlindedMessage() {
    return { amount: this.amount, B_: this.B_.toHex(!0), id: this.id };
  }
}
function mt(n) {
  return typeof n == "function";
}
class L {
  constructor(t, e, s) {
    this.secret = s, this.blindingFactor = e, this.blindedMessage = t;
  }
  toProof(t, e) {
    let s;
    t.dleq && (s = {
      s: Mt(t.dleq.s),
      e: Mt(t.dleq.e),
      r: this.blindingFactor
    });
    const r = {
      id: t.id,
      amount: t.amount,
      C_: ct(t.C_)
    }, o = ct(e.keys[t.amount]), i = Xt(r, this.blindingFactor, this.secret, o);
    return {
      ...Yt(i),
      ...s && {
        dleq: {
          s: G(s.s),
          e: G(s.e),
          r: Ee(s.r ?? BigInt(0))
        }
      }
    };
  }
  static createP2PKData(t, e, s, r) {
    return K(e, s.keys, r).map((i) => this.createSingleP2PKData(t, i, s.id));
  }
  static createCairoData(t, e, s, r) {
    const o = K(e, s.keys, r), i = ee(t.executable, t.expectedOutput);
    return o.map((a) => this.createSingleCairoData(i, a, s.id));
  }
  static createSingleP2PKData(t, e, s) {
    const r = Array.isArray(t.pubkey) ? t.pubkey : [t.pubkey], o = Math.max(1, Math.min(t.requiredSignatures || 1, r.length)), i = Math.max(
      1,
      Math.min(t.requiredRefundSignatures || 1, t.refundKeys ? t.refundKeys.length : 1)
    ), a = [
      "P2PK",
      {
        nonce: G(ft(32)),
        data: r[0],
        // Primary key
        tags: []
      }
    ];
    t.locktime && a[1].tags.push(["locktime", String(t.locktime)]), r.length > 1 && (a[1].tags.push(["pubkeys", ...r.slice(1)]), o > 1 && a[1].tags.push(["n_sigs", String(o)])), t.refundKeys && (a[1].tags.push(["refund", ...t.refundKeys]), i > 1 && a[1].tags.push(["n_sigs_refund", String(i)]));
    const c = JSON.stringify(a), u = new TextEncoder().encode(c), { r: h, B_: l } = ot(u);
    return new L(
      new it(e, l, s).getSerializedBlindedMessage(),
      h,
      u
    );
  }
  static createSingleCairoData(t, e, s) {
    const r = [
      "Cairo",
      {
        nonce: G(ft(32)),
        data: t.programHash,
        tags: [["program_output", t.outputHash]]
      }
    ], o = JSON.stringify(r), i = new TextEncoder().encode(o), { r: a, B_: c } = ot(i);
    return new L(
      new it(e, c, s).getSerializedBlindedMessage(),
      a,
      i
    );
  }
  static createRandomData(t, e, s) {
    return K(t, e.keys, s).map((o) => this.createSingleRandomData(o, e.id));
  }
  static createSingleRandomData(t, e) {
    const s = G(ft(32)), r = new TextEncoder().encode(s), { r: o, B_: i } = ot(r);
    return new L(
      new it(t, i, e).getSerializedBlindedMessage(),
      o,
      r
    );
  }
  static createDeterministicData(t, e, s, r, o) {
    return K(t, r.keys, o).map(
      (a, c) => this.createSingleDeterministicData(a, e, s + c, r.id)
    );
  }
  static createSingleDeterministicData(t, e, s, r) {
    const o = Zt(e, r, s), i = G(o), a = new TextEncoder().encode(i), c = _e(te(e, r, s)), { r: u, B_: h } = ot(a, c);
    return new L(
      new it(t, h, r).getSerializedBlindedMessage(),
      u,
      a
    );
  }
}
const Be = 3, Le = "sat";
class as {
  /**
   * @param mint Cashu mint instance is used to make api calls.
   * @param options.unit Optionally set unit (default is 'sat')
   * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
   * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
   * @param options.mintInfo Mint info from the mint (will be fetched from mint if not provided)
   * @param options.denominationTarget Target number proofs per denomination (default: see @constant
   *   DEFAULT_DENOMINATION_TARGET)
   * @param options.bip39seed BIP39 seed for deterministic secrets.
   * @param options.keepFactory A function that will be used by all parts of the library that
   *   produce proofs to be kept (change, etc.). This can lead to poor performance, in which case
   *   the seed should be directly provided.
   */
  constructor(t, e) {
    this._keys = /* @__PURE__ */ new Map(), this._keysets = [], this._seed = void 0, this._unit = Le, this._mintInfo = void 0, this._denominationTarget = Be, this.mint = t, this._logger = e?.logger ?? W;
    let s = [];
    if (e?.keys && !Array.isArray(e.keys) ? s = [e.keys] : e?.keys && Array.isArray(e?.keys) && (s = e?.keys), s && s.forEach((r) => this._keys.set(r.id, r)), e?.unit && (this._unit = e?.unit), e?.keysets && (this._keysets = e.keysets), e?.mintInfo && (this._mintInfo = new yt(e.mintInfo)), e?.denominationTarget && (this._denominationTarget = e.denominationTarget), e?.bip39seed) {
      if (e.bip39seed instanceof Uint8Array) {
        this._seed = e.bip39seed;
        return;
      }
      throw new Error("bip39seed must be a valid UInt8Array");
    }
    e?.keepFactory && (this._keepFactory = e.keepFactory);
  }
  get unit() {
    return this._unit;
  }
  get keys() {
    return this._keys;
  }
  get keysetId() {
    if (!this._keysetId)
      throw new Error("No keysetId set");
    return this._keysetId;
  }
  set keysetId(t) {
    this._keysetId = t;
  }
  get keysets() {
    return this._keysets;
  }
  get mintInfo() {
    if (!this._mintInfo)
      throw new Error("Mint info not loaded");
    return this._mintInfo;
  }
  /**
   * Get information about the mint.
   *
   * @returns Mint info.
   */
  async getMintInfo() {
    const t = await this.mint.getInfo();
    return this._mintInfo = new yt(t), this._mintInfo;
  }
  /**
   * Get stored information about the mint or request it if not loaded.
   *
   * @returns Mint info.
   */
  async lazyGetMintInfo() {
    return this._mintInfo ? this._mintInfo : await this.getMintInfo();
  }
  /**
   * Load mint information, keysets and keys. This function can be called if no keysets are passed
   * in the constructor.
   */
  async loadMint() {
    await this.getMintInfo(), await this.getKeySets(), await this.getKeys();
  }
  /**
   * Choose a keyset to activate based on the lowest input fee.
   *
   * Note: this function will filter out deprecated base64 keysets.
   *
   * @param keysets Keysets to choose from.
   * @returns Active keyset.
   */
  getActiveKeyset(t) {
    let e = t.filter((r) => r.active && r.unit === this._unit);
    e = e.filter((r) => r.id.startsWith("00"));
    const s = e.sort(
      (r, o) => (r.input_fee_ppk ?? 0) - (o.input_fee_ppk ?? 0)
    )[0];
    if (!s)
      throw new Error("No active keyset found");
    return s;
  }
  /**
   * Get keysets from the mint with the unit of the wallet.
   *
   * @returns Keysets with wallet's unit.
   */
  async getKeySets() {
    const e = (await this.mint.getKeySets()).keysets.filter((s) => s.unit === this._unit);
    return this._keysets = e, this._keysets;
  }
  /**
   * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet
   * keyset.
   *
   * @returns Keyset.
   */
  async getAllKeys() {
    const t = await this.mint.getKeys();
    return t.keysets.forEach((e) => {
      if (!qt(e))
        throw new Error(`Couldn't verify keyset ID ${e.id}`);
    }), this._keys = new Map(t.keysets.map((e) => [e.id, e])), this.keysetId = this.getActiveKeyset(this._keysets).id, t.keysets;
  }
  /**
   * Get public keys from the mint. If keys were already fetched, it will return those.
   *
   * If `keysetId` is set, it will fetch and return that specific keyset. Otherwise, we select an
   * active keyset with the unit of the wallet.
   *
   * @param keysetId Optional keysetId to get keys for.
   * @param forceRefresh? If set to true, it will force refresh the keyset from the mint.
   * @returns Keyset.
   */
  async getKeys(t, e) {
    if ((!(this._keysets.length > 0) || e) && await this.getKeySets(), t || (t = this.getActiveKeyset(this._keysets).id), !this._keysets.find((s) => s.id === t) && (await this.getKeySets(), !this._keysets.find((s) => s.id === t)))
      throw new Error(`could not initialize keys. No keyset with id '${t}' found`);
    if (!this._keys.get(t)) {
      const s = await this.mint.getKeys(t);
      if (!qt(s.keysets[0]))
        throw new Error(`Couldn't verify keyset ID ${s.keysets[0].id}`);
      this._keys.set(t, s.keysets[0]);
    }
    return this.keysetId = t, this._keys.get(t);
  }
  /**
   * Receive an encoded or raw Cashu token (only supports single tokens. It will only process the
   * first token in the token array)
   *
   * @param {string | Token} token - Cashu token, either as string or decoded.
   * @param {ReceiveOptions} [options] - Optional configuration for token processing.
   * @returns New token with newly created proofs, token entries that had errors.
   */
  async receive(t, e) {
    const {
      requireDleq: s,
      keysetId: r,
      outputAmounts: o,
      counter: i,
      pubkey: a,
      privkey: c,
      outputData: u,
      p2pk: h,
      cairoReceive: l
    } = e || {};
    typeof t == "string" && (t = Pe(t));
    const d = await this.getKeys(r);
    if (s && t.proofs.some((U) => !$t(U, d)))
      throw new Error("Token contains proofs with invalid DLEQ");
    const m = H(t.proofs) - this.getFeesForProofs(t.proofs);
    let b;
    u ? b = { send: u } : this._keepFactory && (b = { send: this._keepFactory });
    const w = await this.createSwapPayload(
      m,
      t.proofs,
      d,
      o,
      i,
      a,
      c,
      b,
      h,
      l
    ), { signatures: k } = await this.mint.swap(w.payload), E = w.outputData.map((U, x) => U.toProof(k[x], d)), q = [];
    return w.sortedIndices.forEach((U, x) => {
      q[U] = E[x];
    }), q;
  }
  /**
   * Send proofs of a given amount, by providing at least the required amount of proofs.
   *
   * @param amount Amount to send.
   * @param proofs Array of proofs (accumulated amount of proofs must be >= than amount)
   * @param {SendOptions} [options] - Optional parameters for configuring the send operation.
   * @returns {SendResponse}
   */
  async send(t, e, s) {
    const {
      offline: r,
      includeFees: o,
      includeDleq: i,
      keysetId: a,
      outputAmounts: c,
      pubkey: u,
      privkey: h,
      outputData: l
    } = s || {};
    if (i && (e = e.filter((w) => w.dleq != null)), H(e) < t)
      throw new Error("Not enough funds available to send");
    const { keep: d, send: m } = this.selectProofsToSend(
      e,
      t,
      s?.includeFees
    ), b = o ? this.getFeesForProofs(m) : 0;
    if (!r && (H(m) != t + b || // if the exact amount cannot be selected
    c || u || h || a || l)) {
      const w = await this.swap(t, e, s), { keep: k, send: E } = w, q = w.serialized;
      return { keep: k, send: E, serialized: q };
    }
    if (H(m) < t + b)
      throw new Error("Not enough funds available to send");
    return { keep: d, send: m };
  }
  /**
   * Selects proofs to send based on amount and fee inclusion.
   *
   * @remarks
   * Uses an adapted Randomized Greedy with Local Improvement (RGLI) algorithm, which has a time
   * complexity O(n log n) and space complexity O(n).
   * @param proofs Array of Proof objects available to select from.
   * @param amountToSend The target amount to send.
   * @param includeFees Optional boolean to include fees; Default: false.
   * @returns SendResponse containing proofs to keep and proofs to send.
   * @see https://crypto.ethz.ch/publications/files/Przyda02.pdf
   */
  selectProofsToSend(t, e, s = !1) {
    const h = Ke();
    let l = null, d = 1 / 0, m = 0, b = 0;
    const w = (p, f) => p - (s ? Math.ceil(f / 1e3) : 0), k = (p) => {
      const f = [...p];
      for (let y = f.length - 1; y > 0; y--) {
        const g = Math.floor(Math.random() * (y + 1));
        [f[y], f[g]] = [f[g], f[y]];
      }
      return f;
    }, E = (p, f, y) => {
      let g = 0, N = p.length - 1, R = null;
      for (; g <= N; ) {
        const A = Math.floor((g + N) / 2), P = p[A].exFee;
        (y ? P <= f : P >= f) ? (R = A, y ? g = A + 1 : N = A - 1) : y ? N = A - 1 : g = A + 1;
      }
      return y ? R : g < p.length ? g : null;
    }, q = (p, f) => {
      const y = f.exFee;
      let g = 0, N = p.length;
      for (; g < N; ) {
        const R = Math.floor((g + N) / 2);
        p[R].exFee < y ? g = R + 1 : N = R;
      }
      p.splice(g, 0, f);
    }, U = (p, f) => w(p, f) < e ? 1 / 0 : p + f / 1e3 - e;
    let x = 0, _ = 0;
    const M = t.map((p) => {
      const f = this.getProofFeePPK(p), y = s ? p.amount - f / 1e3 : p.amount, g = { proof: p, exFee: y, ppkfee: f };
      return (!s || y > 0) && (x += p.amount, _ += f), g;
    });
    let S = s ? M.filter((p) => p.exFee > 0) : M;
    if (S.sort((p, f) => p.exFee - f.exFee), S.length > 0) {
      let p;
      {
        const f = E(S, e, !1);
        if (f !== null) {
          const y = S[f].exFee, g = E(S, y, !0);
          if (g === null)
            throw new Error("Unexpected null rightIndex in binary search");
          p = g + 1;
        } else
          p = S.length;
      }
      for (let f = p; f < S.length; f++)
        x -= S[f].proof.amount, _ -= S[f].ppkfee;
      S = S.slice(0, p);
    }
    const nt = w(x, _);
    if (e <= 0 || e > nt)
      return { keep: t, send: [] };
    const Q = Math.min(
      Math.ceil(e * (1 + 0 / 100)),
      e + 0,
      nt
    );
    for (let p = 0; p < 60; p++) {
      const f = [];
      let y = 0, g = 0;
      for (const v of k(S)) {
        const F = y + v.proof.amount, B = g + v.ppkfee, j = w(F, B);
        if (f.push(v), y = F, g = B, j >= e) break;
      }
      const N = new Set(f), R = S.filter((v) => !N.has(v)), A = k(Array.from({ length: f.length }, (v, F) => F)).slice(
        0,
        5e3
      );
      for (const v of A) {
        const F = w(y, g);
        if (F === e || F >= e && F <= Q)
          break;
        const B = f[v], j = y - B.proof.amount, z = g - B.ppkfee, zt = w(j, z), St = e - zt, dt = E(R, St, !1);
        if (dt !== null) {
          const rt = R[dt];
          (St >= 0 || rt.exFee <= B.exFee) && (f[v] = rt, y = j + rt.proof.amount, g = z + rt.ppkfee, R.splice(dt, 1), q(R, B));
        }
      }
      const P = U(y, g);
      if (P < d) {
        this._logger.debug(
          "selectProofsToSend: best solution found in trial #{trial} - amount: {amount}, delta: {delta}",
          { trial: p, amount: y, delta: P }
        ), l = [...f].sort((F, B) => B.exFee - F.exFee), d = P, m = y, b = g;
        const v = [...l];
        for (; v.length > 1 && d > 0; ) {
          const F = v.pop(), B = y - F.proof.amount, j = g - F.ppkfee, z = U(B, j);
          if (z == 1 / 0) break;
          z < d && (l = [...v], d = z, m = B, b = j, y = B, g = j);
        }
      }
      if (l && d < 1 / 0) {
        const v = w(m, b);
        if (v === e || v >= e && v <= Q)
          break;
      }
      if (h.elapsed() > 1e3) {
        this._logger.warn("Proof selection took too long. Returning best selection so far.");
        break;
      }
    }
    if (l && d < 1 / 0) {
      const p = l.map((g) => g.proof), f = new Set(p), y = t.filter((g) => !f.has(g));
      return this._logger.info("Proof selection took {time}ms", { time: h.elapsed() }), { keep: y, send: p };
    }
    return { keep: t, send: [] };
  }
  /**
   * Calculates the fees based on inputs (proofs)
   *
   * @param proofs Input proofs to calculate fees for.
   * @returns Fee amount.
   * @throws Throws an error if the proofs keyset is unknown.
   */
  getFeesForProofs(t) {
    const e = t.reduce((s, r) => s + this.getProofFeePPK(r), 0);
    return Math.ceil(e / 1e3);
  }
  /**
   * Returns the current fee PPK for a proof according to the cached keyset.
   *
   * @param proof {Proof} A single proof.
   * @returns FeePPK {number} The feePPK for the selected proof.
   * @throws Throws an error if the proofs keyset is unknown.
   */
  getProofFeePPK(t) {
    const e = this._keysets.find((s) => s.id === t.id);
    if (!e)
      throw new Error(`Could not get fee. No keyset found for keyset id: ${t.id}`);
    return e?.input_fee_ppk || 0;
  }
  /**
   * Calculates the fees based on inputs for a given keyset.
   *
   * @param nInputs Number of inputs.
   * @param keysetId KeysetId used to lookup `input_fee_ppk`
   * @returns Fee amount.
   */
  getFeesForKeyset(t, e) {
    return Math.floor(
      Math.max(
        (t * (this._keysets.find((r) => r.id === e)?.input_fee_ppk || 0) + 999) / 1e3,
        0
      )
    );
  }
  /**
   * Splits and creates sendable tokens if no amount is specified, the amount is implied by the
   * cumulative amount of all proofs if both amount and preference are set, but the preference
   * cannot fulfill the amount, then we use the default split.
   *
   * @param {SwapOptions} [options] - Optional parameters for configuring the swap operation.
   * @returns Promise of the change- and send-proofs.
   */
  async swap(t, e, s) {
    let { outputAmounts: r } = s || {};
    const {
      includeFees: o,
      keysetId: i,
      counter: a,
      pubkey: c,
      privkey: u,
      proofsWeHave: h,
      outputData: l,
      p2pk: d,
      cairoSend: m,
      cairoReceive: b
    } = s || {}, w = await this.getKeys(i);
    let k = t;
    const E = H(e);
    let q = r?.sendAmounts || K(k, w.keys);
    if (o) {
      let A = this.getFeesForKeyset(q.length, w.id), P = K(A, w.keys);
      for (; this.getFeesForKeyset(q.concat(P).length, w.id) > A; )
        A++, P = K(A, w.keys);
      q = q.concat(P), k += A;
    }
    const { keep: U, send: x } = this.selectProofsToSend(
      e,
      k,
      !0
      // inc. fees
    ), _ = H(x) - this.getFeesForProofs(x) - k;
    if (_ < 0)
      throw new Error("Not enough balance to send");
    let M;
    if (!r?.keepAmounts && !h)
      M = K(_, w.keys);
    else if (!r?.keepAmounts && h)
      M = vt(
        h,
        _,
        w.keys,
        this._denominationTarget
      );
    else if (r) {
      if (r.keepAmounts?.reduce((A, P) => A + P, 0) != _)
        throw new Error("Keep amounts do not match amount to keep");
      M = r.keepAmounts;
    }
    if (k + this.getFeesForProofs(x) > E)
      throw this._logger.error(
        `Not enough funds available (${E}) for swap amountToSend: ${k} + fee: ${this.getFeesForProofs(
          x
        )} | length: ${x.length}`
      ), new Error("Not enough funds available for swap");
    r = {
      keepAmounts: M,
      sendAmounts: q
    };
    const S = l?.keep || this._keepFactory, nt = l?.send, Q = await this.createSwapPayload(
      k,
      x,
      w,
      r,
      a,
      c,
      u,
      { keep: S, send: nt },
      d,
      b,
      m
    ), { signatures: p } = await this.mint.swap(Q.payload), f = Q.outputData.map((A, P) => A.toProof(p[P], w)), y = [], g = [], N = Array(Q.keepVector.length), R = Array(f.length);
    return Q.sortedIndices.forEach((A, P) => {
      N[A] = Q.keepVector[P], R[A] = f[P];
    }), R.forEach((A, P) => {
      N[P] ? y.push(A) : g.push(A);
    }), {
      keep: [...y, ...U],
      send: g
    };
  }
  /**
   * Restores batches of deterministic proofs until no more signatures are returned from the mint.
   *
   * @param [gapLimit=300] The amount of empty counters that should be returned before restoring
   *   ends (defaults to 300). Default is `300`
   * @param [batchSize=100] The amount of proofs that should be restored at a time (defaults to
   *   100). Default is `100`
   * @param [counter=0] The counter that should be used as a starting point (defaults to 0). Default
   *   is `0`
   * @param [keysetId] Which keysetId to use for the restoration. If none is passed the instance's
   *   default one will be used.
   */
  async batchRestore(t = 300, e = 100, s = 0, r) {
    const o = Math.ceil(t / e), i = [];
    let a, c = 0;
    for (; c < o; ) {
      const u = await this.restore(s, e, { keysetId: r });
      u.proofs.length > 0 ? (c = 0, i.push(...u.proofs), a = u.lastCounterWithSignature) : c++, s += e;
    }
    return { proofs: i, lastCounterWithSignature: a };
  }
  /**
   * Regenerates.
   *
   * @param start Set starting point for count (first cycle for each keyset should usually be 0)
   * @param count Set number of blinded messages that should be generated.
   * @param options.keysetId Set a custom keysetId to restore from. keysetIds can be loaded with
   *   `CashuMint.getKeySets()`
   */
  async restore(t, e, s) {
    const { keysetId: r } = s || {}, o = await this.getKeys(r);
    if (!this._seed)
      throw new Error("CashuWallet must be initialized with a seed to use restore");
    const i = Array(e).fill(1), a = L.createDeterministicData(
      i.length,
      this._seed,
      t,
      o,
      i
    ), { outputs: c, signatures: u } = await this.mint.restore({
      outputs: a.map((m) => m.blindedMessage)
    }), h = {};
    c.forEach((m, b) => h[m.B_] = u[b]);
    const l = [];
    let d;
    for (let m = 0; m < a.length; m++) {
      const b = h[a[m].blindedMessage.B_];
      b && (d = t + m, a[m].blindedMessage.amount = b.amount, l.push(a[m].toProof(b, o)));
    }
    return {
      proofs: l,
      lastCounterWithSignature: d
    };
  }
  /**
   * Requests a mint quote form the mint. Response returns a Lightning payment request for the
   * requested given amount and unit.
   *
   * @param amount Amount requesting for mint.
   * @param description Optional description for the mint quote.
   * @param pubkey Optional public key to lock the quote to.
   * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
   *   specified amount and unit.
   */
  async createMintQuote(t, e) {
    const s = {
      unit: this._unit,
      amount: t,
      description: e
    }, r = await this.mint.createMintQuote(s);
    return { ...r, amount: r.amount || t, unit: r.unit || this.unit };
  }
  /**
   * Requests a mint quote from the mint that is locked to a public key.
   *
   * @param amount Amount requesting for mint.
   * @param pubkey Public key to lock the quote to.
   * @param description Optional description for the mint quote.
   * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
   *   specified amount and unit. The quote will be locked to the specified `pubkey`.
   */
  async createLockedMintQuote(t, e, s) {
    const { supported: r } = (await this.getMintInfo()).isSupported(20);
    if (!r)
      throw new Error("Mint does not support NUT-20");
    const o = {
      unit: this._unit,
      amount: t,
      description: s,
      pubkey: e
    }, i = await this.mint.createMintQuote(o);
    if (typeof i.pubkey != "string")
      throw new Error("Mint returned unlocked mint quote");
    {
      const a = i.pubkey;
      return { ...i, pubkey: a, amount: i.amount || t, unit: i.unit || this.unit };
    }
  }
  async checkMintQuote(t) {
    const e = typeof t == "string" ? t : t.quote, s = await this.mint.checkMintQuote(e);
    return typeof t == "string" ? s : { ...s, amount: s.amount || t.amount, unit: s.unit || t.unit };
  }
  async mintProofs(t, e, s) {
    let { outputAmounts: r } = s || {};
    const { counter: o, pubkey: i, p2pk: a, keysetId: c, proofsWeHave: u, outputData: h, privateKey: l } = s || {}, d = await this.getKeys(c);
    !r && u && (r = {
      keepAmounts: vt(u, t, d.keys, this._denominationTarget),
      sendAmounts: []
    });
    let m = [];
    if (h)
      if (mt(h)) {
        const k = K(t, d.keys, r?.keepAmounts);
        for (let E = 0; E < k.length; E++)
          m.push(h(k[E], d));
      } else
        m = h;
    else if (this._keepFactory) {
      const k = K(t, d.keys, r?.keepAmounts);
      for (let E = 0; E < k.length; E++)
        m.push(this._keepFactory(k[E], d));
    } else
      m = this.createOutputData(
        t,
        d,
        o,
        i,
        r?.keepAmounts,
        a
      );
    let b;
    if (typeof e != "string") {
      if (!l)
        throw new Error("Can not sign locked quote without private key");
      const k = m.map((q) => q.blindedMessage), E = Jt(l, e.quote, k);
      b = {
        outputs: k,
        quote: e.quote,
        signature: E
      };
    } else
      b = {
        outputs: m.map((k) => k.blindedMessage),
        quote: e
      };
    const { signatures: w } = await this.mint.mint(b);
    return m.map((k, E) => k.toProof(w[E], d));
  }
  /**
   * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order
   * to pay a Lightning invoice.
   *
   * @param invoice LN invoice that needs to get a fee estimate.
   * @returns The mint will create and return a melt quote for the invoice with an amount and fee
   *   reserve.
   */
  async createMeltQuote(t) {
    const e = {
      unit: this._unit,
      request: t
    }, s = await this.mint.createMeltQuote(e);
    return {
      ...s,
      unit: s.unit || this.unit,
      request: s.request || t
    };
  }
  /**
   * Requests a multi path melt quote from the mint.
   *
   * @param invoice LN invoice that needs to get a fee estimate.
   * @param partialAmount The partial amount of the invoice's total to be paid by this instance.
   * @returns The mint will create and return a melt quote for the invoice with an amount and fee
   *   reserve.
   */
  async createMultiPathMeltQuote(t, e) {
    const { supported: s, params: r } = (await this.lazyGetMintInfo()).isSupported(15);
    if (!s)
      throw new Error("Mint does not support NUT-15");
    if (!r?.some((u) => u.method === "bolt11" && u.unit === this.unit))
      throw new Error(`Mint does not support MPP for bolt11 and ${this.unit}`);
    const i = {
      mpp: {
        amount: e
      }
    }, a = {
      unit: this._unit,
      request: t,
      options: i
    };
    return { ...await this.mint.createMeltQuote(a), request: t, unit: this._unit };
  }
  async checkMeltQuote(t) {
    const e = typeof t == "string" ? t : t.quote, s = await this.mint.checkMeltQuote(e);
    return typeof t == "string" ? s : { ...s, request: t.request, unit: t.unit };
  }
  /**
   * Melt proofs for a melt quote. proofsToSend must be at least amount+fee_reserve form the melt
   * quote. This function does not perform coin selection!. Returns melt quote and change proofs.
   *
   * @param meltQuote ID of the melt quote.
   * @param proofsToSend Proofs to melt.
   * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof
   *   operation.
   * @returns
   */
  async meltProofs(t, e, s) {
    const { keysetId: r, counter: o, privkey: i } = s || {}, a = await this.getKeys(r), c = this.createBlankOutputs(
      H(e) - t.amount,
      a,
      o,
      this._keepFactory
    );
    i != null && (e = It(e, i)), e = ht(e), e = e.map((l) => {
      const d = l.witness && typeof l.witness != "string" ? JSON.stringify(l.witness) : l.witness;
      return { ...l, witness: d };
    });
    const u = {
      quote: t.quote,
      inputs: e,
      outputs: c.map((l) => l.blindedMessage)
    }, h = await this.mint.melt(u);
    return {
      quote: { ...h, unit: t.unit, request: t.request },
      change: h.change?.map((l, d) => c[d].toProof(l, a)) ?? []
    };
  }
  /**
   * Creates a split payload.
   *
   * @param amount Amount to send.
   * @param proofsToSend Proofs to split*
   * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
   * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
   *   must be initialized with seed phrase to take effect.
   * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
   *   set!
   * @param privkey? Will create a signature on the @param proofsToSend secrets if set.
   * @param customOutputData? Optionally specify your own OutputData (blinded messages)
   * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
   * @returns
   */
  async createSwapPayload(t, e, s, r, o, i, a, c, u, h, l) {
    const d = e.reduce((_, M) => _ + M.amount, 0);
    r && r.sendAmounts && !r.keepAmounts && (r.keepAmounts = K(
      d - t - this.getFeesForProofs(e),
      s.keys
    ));
    const m = d - t - this.getFeesForProofs(e);
    let b = [], w = [];
    if (c?.keep)
      if (mt(c.keep)) {
        const _ = c.keep;
        K(m, s.keys).forEach((S) => {
          b.push(_(S, s));
        });
      } else
        b = c.keep;
    else
      b = this.createOutputData(
        m,
        s,
        o,
        void 0,
        r?.keepAmounts,
        void 0,
        void 0,
        this._keepFactory
      );
    if (c?.send)
      if (mt(c.send)) {
        const _ = c.send;
        K(t, s.keys).forEach((S) => {
          w.push(_(S, s));
        });
      } else
        w = c.send;
    else
      w = this.createOutputData(
        t,
        s,
        o ? o + b.length : void 0,
        i,
        r?.sendAmounts,
        u,
        l
      );
    a ? e = It(e, a) : h && (e = await se(
      e,
      h.executable,
      h.programInput
    )), e = ht(e), e = e.map((_) => {
      const M = _.witness && typeof _.witness != "string" ? JSON.stringify(_.witness) : _.witness;
      return { ..._, witness: M };
    });
    const k = [...b, ...w], E = k.map((_, M) => M).sort(
      (_, M) => k[_].blindedMessage.amount - k[M].blindedMessage.amount
    ), q = [
      ...Array.from({ length: b.length }, () => !0),
      ...Array.from({ length: w.length }, () => !1)
    ], U = E.map((_) => k[_]), x = E.map((_) => q[_]);
    return {
      payload: {
        inputs: e,
        outputs: U.map((_) => _.blindedMessage)
      },
      outputData: U,
      keepVector: x,
      sortedIndices: E
    };
  }
  /**
   * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
   *
   * @param proofs (only the `secret` field is required)
   * @returns
   */
  async checkProofsStates(t) {
    const e = new TextEncoder(), s = t.map((i) => Pt(e.encode(i.secret)).toHex(!0)), r = 100, o = [];
    for (let i = 0; i < s.length; i += r) {
      const a = s.slice(i, i + r), { states: c } = await this.mint.check({
        Ys: a
      }), u = {};
      c.forEach((h) => {
        u[h.Y] = h;
      });
      for (let h = 0; h < a.length; h++) {
        const l = u[a[h]];
        if (!l)
          throw new Error("Could not find state for proof with Y: " + a[h]);
        o.push(l);
      }
    }
    return o;
  }
  /**
   * Register a callback to be called whenever a mint quote's state changes.
   *
   * @param quoteIds List of mint quote IDs that should be subscribed to.
   * @param callback Callback function that will be called whenever a mint quote state changes.
   * @param errorCallback
   * @returns
   */
  async onMintQuoteUpdates(t, e, s) {
    if (await this.mint.connectWebSocket(), !this.mint.webSocketConnection)
      throw new Error("failed to establish WebSocket connection.");
    const r = this.mint.webSocketConnection.createSubscription(
      { kind: "bolt11_mint_quote", filters: t },
      e,
      s
    );
    return () => {
      this.mint.webSocketConnection?.cancelSubscription(r, e);
    };
  }
  /**
   * Register a callback to be called whenever a melt quote's state changes.
   *
   * @param quoteIds List of melt quote IDs that should be subscribed to.
   * @param callback Callback function that will be called whenever a melt quote state changes.
   * @param errorCallback
   * @returns
   */
  async onMeltQuotePaid(t, e, s) {
    return this.onMeltQuoteUpdates(
      [t],
      (r) => {
        r.state === et.PAID && e(r);
      },
      s
    );
  }
  /**
   * Register a callback to be called when a single mint quote gets paid.
   *
   * @param quoteId Mint quote id that should be subscribed to.
   * @param callback Callback function that will be called when this mint quote gets paid.
   * @param errorCallback
   * @returns
   */
  async onMintQuotePaid(t, e, s) {
    return this.onMintQuoteUpdates(
      [t],
      (r) => {
        r.state === gt.PAID && e(r);
      },
      s
    );
  }
  /**
   * Register a callback to be called when a single melt quote gets paid.
   *
   * @param quoteId Melt quote id that should be subscribed to.
   * @param callback Callback function that will be called when this melt quote gets paid.
   * @param errorCallback
   * @returns
   */
  async onMeltQuoteUpdates(t, e, s) {
    if (await this.mint.connectWebSocket(), !this.mint.webSocketConnection)
      throw new Error("failed to establish WebSocket connection.");
    const r = this.mint.webSocketConnection.createSubscription(
      { kind: "bolt11_melt_quote", filters: t },
      e,
      s
    );
    return () => {
      this.mint.webSocketConnection?.cancelSubscription(r, e);
    };
  }
  /**
   * Register a callback to be called whenever a subscribed proof state changes.
   *
   * @param proofs List of proofs that should be subscribed to.
   * @param callback Callback function that will be called whenever a proof's state changes.
   * @param errorCallback
   * @returns
   */
  async onProofStateUpdates(t, e, s) {
    if (await this.mint.connectWebSocket(), !this.mint.webSocketConnection)
      throw new Error("failed to establish WebSocket connection.");
    const r = new TextEncoder(), o = {};
    for (let c = 0; c < t.length; c++) {
      const u = Pt(r.encode(t[c].secret)).toHex(!0);
      o[u] = t[c];
    }
    const i = Object.keys(o), a = this.mint.webSocketConnection.createSubscription(
      { kind: "proof_state", filters: i },
      (c) => {
        e({ ...c, proof: o[c.Y] });
      },
      s
    );
    return () => {
      this.mint.webSocketConnection?.cancelSubscription(a, e);
    };
  }
  /**
   * Creates blinded messages for a according to @param amounts.
   *
   * @param amount Array of amounts to create blinded messages for.
   * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
   *   must be initialized with seed phrase to take effect.
   * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
   *   set!
   * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
   * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
   * @param factory? Optionally specify a custom function that produces OutputData (blinded
   *   messages)
   * @returns Blinded messages, secrets, rs, and amounts.
   */
  createOutputData(t, e, s, r, o, i, a, c) {
    let u;
    if (r)
      u = L.createP2PKData({ pubkey: r }, t, e, o);
    else if (s || s === 0) {
      if (!this._seed)
        throw new Error("cannot create deterministic messages without seed");
      u = L.createDeterministicData(
        t,
        this._seed,
        s,
        e,
        o
      );
    } else i ? u = L.createP2PKData(i, t, e, o) : a ? u = L.createCairoData(a, t, e, o) : c ? u = K(t, e.keys).map((l) => c(l, e)) : u = L.createRandomData(t, e, o);
    return u;
  }
  /**
   * Creates NUT-08 blank outputs (fee returns) for a given fee reserve See:
   * https://github.com/cashubtc/nuts/blob/main/08.md.
   *
   * @param amount Amount to cover with blank outputs.
   * @param keysetId Mint keysetId.
   * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
   *   must be initialized with seed phrase to take effect.
   * @returns Blinded messages, secrets, and rs.
   */
  createBlankOutputs(t, e, s, r) {
    let o = Math.ceil(Math.log2(t)) || 1;
    o < 0 && (o = 0);
    const i = o ? Array(o).fill(1) : [];
    return this.createOutputData(
      i.length,
      e,
      s,
      void 0,
      i,
      void 0,
      void 0,
      r
    );
  }
}
class Z {
  /**
   * @param _mintUrl Requires mint URL to create this object.
   * @param _customRequest If passed, use custom request implementation for network communication
   *   with the mint.
   */
  constructor(t, e) {
    this._mintUrl = t, this._customRequest = e, this._mintUrl = jt(t), this._customRequest = e;
  }
  get mintUrl() {
    return this._mintUrl;
  }
  /**
   * Mints new Blinded Authentication tokens by requesting blind signatures on the provided outputs.
   *
   * @param mintUrl
   * @param mintPayload Payload containing the outputs to get blind signatures on.
   * @param clearAuthToken A NUT-21 clear auth token.
   * @param customRequest
   * @returns Serialized blinded signatures.
   */
  static async mint(t, e, s, r) {
    const o = r || D, i = {
      "Clear-auth": `${s}`
    }, a = await o({
      endpoint: T(t, "/v1/auth/blind/mint"),
      method: "POST",
      requestBody: e,
      headers: i
    });
    if (!C(a) || !Array.isArray(a?.signatures))
      throw new Error("bad response");
    return a;
  }
  /**
   * Mints new Blinded Authentication tokens by requesting blind signatures on the provided outputs.
   *
   * @param mintPayload Payload containing the outputs to get blind signatures on.
   * @param clearAuthToken A NUT-21 clear auth token.
   * @returns Serialized blinded signatures.
   */
  async mint(t, e) {
    return Z.mint(this._mintUrl, t, e, this._customRequest);
  }
  /**
   * Get the mints public NUT-22 keys.
   *
   * @param mintUrl
   * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
   *   keys from all active keysets are fetched.
   * @param customRequest
   * @returns
   */
  static async getKeys(t, e, s) {
    const o = await (s || D)({
      endpoint: e ? T(t, "/v1/auth/blind/keys", e) : T(t, "/v1/auth/blind/keys")
    });
    if (!C(o) || !Array.isArray(o.keysets))
      throw new Error("bad response");
    return o;
  }
  /**
   * Get the mints public NUT-22 keys.
   *
   * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
   *   keys from all active keysets are fetched.
   * @returns The mints public keys.
   */
  async getKeys(t, e) {
    return await Z.getKeys(
      e || this._mintUrl,
      t,
      this._customRequest
    );
  }
  /**
   * Get the mints NUT-22 keysets in no specific order.
   *
   * @param mintUrl
   * @param customRequest
   * @returns All the mints past and current keysets.
   */
  static async getKeySets(t, e) {
    return (e || D)({
      endpoint: T(t, "/v1/auth/blind/keysets")
    });
  }
  /**
   * Get the mints NUT-22 keysets in no specific order.
   *
   * @returns All the mints past and current keysets.
   */
  async getKeySets() {
    return Z.getKeySets(this._mintUrl, this._customRequest);
  }
}
class Ce {
  /**
   * @param mint NUT-22 auth mint instance.
   * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
   * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
   */
  constructor(t, e) {
    this._keys = /* @__PURE__ */ new Map(), this._keysets = [], this._unit = "auth", this.mint = t;
    let s = [];
    e?.keys && !Array.isArray(e.keys) ? s = [e.keys] : e?.keys && Array.isArray(e?.keys) && (s = e?.keys), s && s.forEach((r) => this._keys.set(r.id, r)), e?.keysets && (this._keysets = e.keysets);
  }
  get keys() {
    return this._keys;
  }
  get keysetId() {
    if (!this._keysetId)
      throw new Error("No keysetId set");
    return this._keysetId;
  }
  set keysetId(t) {
    this._keysetId = t;
  }
  get keysets() {
    return this._keysets;
  }
  /**
   * Load mint information, keysets and keys. This function can be called if no keysets are passed
   * in the constructor.
   */
  async loadMint() {
    await this.getKeySets(), await this.getKeys();
  }
  /**
   * Choose a keyset to activate based on the lowest input fee.
   *
   * Note: this function will filter out deprecated base64 keysets.
   *
   * @param keysets Keysets to choose from.
   * @returns Active keyset.
   */
  getActiveKeyset(t) {
    let e = t.filter((r) => r.active);
    e = e.filter((r) => r.id.startsWith("00"));
    const s = e.sort(
      (r, o) => (r.input_fee_ppk ?? 0) - (o.input_fee_ppk ?? 0)
    )[0];
    if (!s)
      throw new Error("No active keyset found");
    return s;
  }
  /**
   * Get keysets from the mint with the unit of the wallet.
   *
   * @returns Keysets with wallet's unit.
   */
  async getKeySets() {
    const e = (await this.mint.getKeySets()).keysets.filter((s) => s.unit === this._unit);
    return this._keysets = e, this._keysets;
  }
  /**
   * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet
   * keyset.
   *
   * @returns Keyset.
   */
  async getAllKeys() {
    const t = await this.mint.getKeys();
    return this._keys = new Map(t.keysets.map((e) => [e.id, e])), this.keysetId = this.getActiveKeyset(this._keysets).id, t.keysets;
  }
  /**
   * Get public keys from the mint. If keys were already fetched, it will return those.
   *
   * If `keysetId` is set, it will fetch and return that specific keyset. Otherwise, we select an
   * active keyset with the unit of the wallet.
   *
   * @param keysetId Optional keysetId to get keys for.
   * @param forceRefresh? If set to true, it will force refresh the keyset from the mint.
   * @returns Keyset.
   */
  async getKeys(t, e) {
    if ((!(this._keysets.length > 0) || e) && await this.getKeySets(), t || (t = this.getActiveKeyset(this._keysets).id), !this._keysets.find((s) => s.id === t) && (await this.getKeySets(), !this._keysets.find((s) => s.id === t)))
      throw new Error(`could not initialize keys. No keyset with id '${t}' found`);
    if (!this._keys.get(t)) {
      const s = await this.mint.getKeys(t);
      this._keys.set(t, s.keysets[0]);
    }
    return this.keysetId = t, this._keys.get(t);
  }
  /**
   * Mint proofs for a given mint quote.
   *
   * @param amount Amount to request.
   * @param clearAuthToken ClearAuthToken to mint.
   * @param options.keysetId? Optionally set keysetId for blank outputs for returned change.
   * @returns Proofs.
   */
  async mintProofs(t, e, s) {
    const r = await this.getKeys(s?.keysetId), o = L.createRandomData(t, r), i = {
      outputs: o.map((u) => u.blindedMessage)
    }, { signatures: a } = await this.mint.mint(i, e), c = o.map((u, h) => u.toProof(a[h], r));
    if (c.some((u) => !$t(u, r)))
      throw new Error("Mint returned auth proofs with invalid DLEQ");
    return c;
  }
}
function We(n) {
  const t = {
    id: n.id,
    secret: n.secret,
    C: n.C
  }, e = Ot(t);
  return "auth" + "A" + e;
}
async function cs(n, t, e) {
  const s = new Z(t);
  return (await new Ce(s).mintProofs(n, e)).map((i) => We(i));
}
export {
  Z as CashuAuthMint,
  Ce as CashuAuthWallet,
  O as CashuMint,
  as as CashuWallet,
  os as CheckStateEnum,
  Dt as ConsoleLogger,
  st as HttpResponseError,
  I as LogLevel,
  et as MeltQuoteState,
  At as MintOperationError,
  gt as MintQuoteState,
  Et as NetworkError,
  L as OutputData,
  _t as PaymentRequest,
  Oe as PaymentRequestTransportType,
  ee as createCairoSend,
  es as decodePaymentRequest,
  Me as deriveKeysetId,
  cs as getBlindedAuthToken,
  Pe as getDecodedToken,
  ns as getDecodedTokenBinary,
  We as getEncodedAuthToken,
  ts as getEncodedToken,
  ss as getEncodedTokenBinary,
  Se as getEncodedTokenV4,
  $t as hasValidDleq,
  rs as injectWebSocketImpl,
  is as setGlobalRequestOptions
};
//# sourceMappingURL=cashu-ts.es.js.map
