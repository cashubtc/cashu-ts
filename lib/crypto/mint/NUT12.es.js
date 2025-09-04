import { createRandomPrivateKey as _, hash_e as b } from "../common.es.js";
import { bytesToHex as c, numberToBytesBE as v } from "@noble/curves/abstract/utils";
import { secp256k1 as e } from "@noble/curves/secp256k1";
import { hexToNumber as m, bytesToNumber as r } from "../util.es.js";
const E = (n, o) => {
  const t = c(_()), i = e.ProjectivePoint.fromPrivateKey(t), p = n.multiply(m(t)), y = n.multiply(r(o)), P = e.ProjectivePoint.fromPrivateKey(c(o)), s = b([i, p, P, y]), f = m(t), a = r(s), u = r(o);
  return { s: v((f + a * u) % e.CURVE.n, 32), e: s };
};
export {
  E as createDLEQProof
};
//# sourceMappingURL=NUT12.es.js.map
