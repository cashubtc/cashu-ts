import { secp256k1 as s } from "@noble/curves/secp256k1";
import { randomBytes as d } from "@noble/hashes/utils";
import { bytesToNumber as u } from "./util.es.js";
import { hashToCurve as c, pointFromHex as m } from "./common.es.js";
import { getSignedOutput as a } from "./client/NUT11.es.js";
function y(t) {
  return l(
    d(32),
    u(s.utils.randomPrivateKey()),
    t
  );
}
function l(t, e, n) {
  const i = c(t);
  e || (e = u(s.utils.randomPrivateKey()));
  const o = s.ProjectivePoint.BASE.multiply(e), r = i.add(o);
  return n !== void 0 ? a({ B_: r, r: e, secret: t }, n) : { B_: r, r: e, secret: t };
}
function C(t, e, n) {
  return t.subtract(n.multiply(e));
}
function b(t, e, n, i) {
  const o = i, r = C(t.C_, e, o);
  return {
    id: t.id,
    amount: t.amount,
    secret: n,
    C: r
  };
}
const v = (t) => ({
  amount: t.amount,
  C: t.C.toHex(!0),
  id: t.id,
  secret: new TextDecoder().decode(t.secret),
  witness: JSON.stringify(t.witness)
}), S = (t) => ({
  amount: t.amount,
  C: m(t.C),
  id: t.id,
  secret: new TextEncoder().encode(t.secret),
  witness: t.witness ? JSON.parse(t.witness) : void 0
}), T = (t, e) => ({
  B_: t.B_.toHex(!0),
  amount: e
});
export {
  l as blindMessage,
  b as constructProofFromPromise,
  y as createRandomBlindedMessage,
  S as deserializeProof,
  T as serializeBlindedMessage,
  v as serializeProof,
  C as unblindSignature
};
//# sourceMappingURL=client.es.js.map
