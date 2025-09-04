import { schnorr as c } from "@noble/curves/secp256k1";
import { hexToBytes as i, bytesToHex as g } from "@noble/hashes/utils";
import { sha256 as m } from "@noble/hashes/sha256";
function u(s, n) {
  let e = s;
  for (const r of n)
    e += r.B_;
  const o = new TextEncoder().encode(e);
  return m(o);
}
function p(s, n, e) {
  const o = u(n, e), r = i(s), t = c.sign(o, r);
  return g(t);
}
function b(s, n, e, o) {
  const r = i(o);
  let t = i(s);
  if (t.length !== 33) return !1;
  t = t.slice(1);
  const f = u(n, e);
  return c.verify(r, f, t);
}
export {
  p as signMintQuote,
  b as verifyMintQuoteSignature
};
//# sourceMappingURL=NUT20.es.js.map
