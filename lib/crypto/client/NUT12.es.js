import { hash_e as l, hashToCurve as h } from "../common.es.js";
import { bytesToHex as p } from "@noble/curves/abstract/utils";
import { secp256k1 as u } from "@noble/curves/secp256k1";
import { bytesToNumber as c } from "../util.es.js";
function b(t, o) {
  if (t.length !== o.length) return !1;
  for (let r = 0; r < t.length; r++)
    if (t[r] !== o[r]) return !1;
  return !0;
}
const v = (t, o, r, e) => {
  const n = u.ProjectivePoint.fromPrivateKey(p(t.s)), i = e.multiply(c(t.e)), s = o.multiply(c(t.s)), f = r.multiply(c(t.e)), m = n.subtract(i), a = s.subtract(f), y = l([m, a, e, r]);
  return b(y, t.e);
}, d = (t, o, r, e) => {
  if (o.r === void 0) throw new Error("verifyDLEQProof_reblind: Undefined blinding factor");
  const n = h(t), i = r.add(e.multiply(o.r)), s = u.ProjectivePoint.fromPrivateKey(o.r), f = n.add(s);
  return v(o, f, i, e);
};
export {
  v as verifyDLEQProof,
  d as verifyDLEQProof_reblind
};
//# sourceMappingURL=NUT12.es.js.map
