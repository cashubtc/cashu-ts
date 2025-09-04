import { secp256k1 as a } from "@noble/curves/secp256k1";
import { bytesToNumber as m } from "./util.es.js";
import { createRandomPrivateKey as f, deriveKeysetId as l, hashToCurve as K } from "./common.es.js";
import { HDKey as p } from "@scure/bip32";
const u = "m/0'/0'/0'";
function g(e, r, t, o) {
  return { C_: e.multiply(m(r)), amount: t, id: o };
}
function v(e) {
  return a.getPublicKey(e, !0);
}
function h(e, r) {
  let t = 0n;
  const o = {}, n = {};
  let s;
  for (r && (s = p.fromMasterSeed(r)); t < e; ) {
    const i = (2n ** t).toString();
    if (s) {
      const c = s.derive(`${u}/${t}`).privateKey;
      if (c)
        n[i] = c;
      else
        throw new Error(`Could not derive Private key from: ${u}/${t}`);
    } else
      n[i] = f();
    o[i] = v(n[i]), t++;
  }
  const y = l(o);
  return { pubKeys: o, privKeys: n, keysetId: y };
}
function k(e, r) {
  return K(e.secret).multiply(m(r)).equals(e.C);
}
export {
  g as createBlindSignature,
  h as createNewMintKeys,
  v as getPubKeyFromPrivKey,
  k as verifyProof
};
//# sourceMappingURL=mint.es.js.map
