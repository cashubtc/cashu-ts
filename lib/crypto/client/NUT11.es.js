import { bytesToHex as P, hexToBytes as K } from "@noble/curves/abstract/utils";
import { sha256 as f } from "@noble/hashes/sha256";
import { schnorr as u } from "@noble/curves/secp256k1";
import { randomBytes as y } from "@noble/hashes/utils";
import { parseSecret as g } from "../common/NUT10.es.js";
const x = (t) => {
  const n = [
    "P2PK",
    {
      nonce: P(y(32)),
      data: t
    }
  ];
  return JSON.stringify(n);
}, p = (t, n) => {
  const r = f(t), e = u.sign(r, n);
  return P(e);
}, k = (t, n) => {
  const r = f(t), e = u.sign(r, n);
  return P(e);
}, h = (t, n, r) => {
  try {
    const e = f(n), s = r.length === 66 ? r.slice(2) : r;
    if (u.verify(t, e, K(s)))
      return !0;
  } catch (e) {
    console.error("verifyP2PKsecret error:", e);
  }
  return !1;
}, F = (t, n) => n.witness ? m(n.witness).some((e) => {
  try {
    return h(e, n.secret, t);
  } catch {
    return !1;
  }
}) : !1;
function d(t) {
  try {
    const n = typeof t == "string" ? g(t) : t;
    if (n[0] !== "P2PK")
      throw new Error('Invalid P2PK secret: must start with "P2PK"');
    const r = Math.floor(Date.now() / 1e3);
    return w(n) > r ? E(n) : I(n);
  } catch {
  }
  return [];
}
function E(t) {
  const n = typeof t == "string" ? g(t) : t;
  if (n[0] !== "P2PK")
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  const { data: r, tags: e } = n[1], s = e && e.find((o) => o[0] === "pubkeys"), i = s && s.length > 1 ? s.slice(1) : [];
  return [r, ...i].filter(Boolean);
}
function I(t) {
  const n = typeof t == "string" ? g(t) : t;
  if (n[0] !== "P2PK")
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  const { tags: r } = n[1], e = r && r.find((s) => s[0] === "refund");
  return e && e.length > 1 ? e.slice(1).filter(Boolean) : [];
}
function w(t) {
  const n = typeof t == "string" ? g(t) : t;
  if (n[0] !== "P2PK")
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  const { tags: r } = n[1], e = r && r.find((s) => s[0] === "locktime");
  return e && e.length > 1 ? parseInt(e[1], 10) : 1 / 0;
}
function N(t) {
  const n = typeof t == "string" ? g(t) : t;
  if (n[0] !== "P2PK")
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  if (!d(n).length)
    return 0;
  const { tags: e } = n[1], s = Math.floor(Date.now() / 1e3);
  if (w(n) > s) {
    const c = e && e.find((a) => a[0] === "n_sigs");
    return c && c.length > 1 ? parseInt(c[1], 10) : 1;
  }
  const o = e && e.find((c) => c[0] === "n_sigs_refund");
  return o && o.length > 1 ? parseInt(o[1], 10) : 1;
}
function O(t) {
  const n = typeof t == "string" ? g(t) : t;
  if (n[0] !== "P2PK")
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  const { tags: r } = n[1], e = r && r.find((s) => s[0] === "sigflag");
  return e && e.length > 1 ? e[1] : "SIG_INPUTS";
}
const m = (t) => {
  if (!t) return [];
  if (typeof t == "string")
    try {
      return JSON.parse(t).signatures || [];
    } catch (n) {
      return console.error("Failed to parse witness string:", n), [];
    }
  return t.signatures || [];
}, W = (t, n, r = !1) => {
  const e = Array.isArray(n) ? n : [n];
  return t.map((s, i) => {
    let o = s;
    for (const c of e)
      try {
        o = T(o, c);
      } catch (a) {
        const l = a instanceof Error ? a.message : "Unknown error";
        if (r)
          throw new Error(`Failed signing proof #${i + 1}: ${l}`);
        console.warn(`Proof #${i + 1}: ${l}`);
      }
    return o;
  });
}, T = (t, n) => {
  const r = g(t.secret);
  if (r[0] !== "P2PK")
    throw new Error("not a P2PK secret");
  const e = P(u.getPublicKey(n)), s = d(r);
  if (!s.length || !s.some((a) => a.includes(e)))
    throw new Error(`Signature not required from [02|03]${e}`);
  const i = m(t.witness);
  if (i.some((a) => {
    try {
      return h(a, t.secret, e);
    } catch {
      return !1;
    }
  }))
    throw new Error(`Proof already signed by [02|03]${e}`);
  const c = p(t.secret, n);
  return i.push(c), { ...t, witness: { signatures: i } };
}, _ = (t, n) => {
  const r = t.B_.toHex(!0), e = k(r, n);
  return t.witness = { signatures: [e] }, t;
}, H = (t, n) => t.map((r) => _(r, n));
export {
  x as createP2PKsecret,
  d as getP2PKExpectedKWitnessPubkeys,
  w as getP2PKLocktime,
  N as getP2PKNSigs,
  O as getP2PKSigFlag,
  E as getP2PKWitnessPubkeys,
  I as getP2PKWitnessRefundkeys,
  m as getP2PKWitnessSignatures,
  _ as getSignedOutput,
  H as getSignedOutputs,
  F as hasP2PKSignedProof,
  k as signBlindedMessage,
  T as signP2PKProof,
  W as signP2PKProofs,
  p as signP2PKSecret,
  h as verifyP2PKSecretSignature
};
//# sourceMappingURL=NUT11.es.js.map
