import { secp256k1 as f } from "@noble/curves/secp256k1";
import { sha256 as a } from "@noble/hashes/sha256";
import { hexToBytes as u, bytesToHex as m } from "@noble/curves/abstract/utils";
import { hexToNumber as y, bytesToNumber as x, encodeBase64toUint8 as g } from "./util.es.js";
import { Buffer as i } from "buffer";
const p = u("536563703235366b315f48617368546f43757276655f43617368755f");
function w(t) {
  const e = a(i.concat([p, t])), n = new Uint32Array(1), s = 2 ** 16;
  for (let o = 0; o < s; o++) {
    const h = new Uint8Array(n.buffer), r = a(i.concat([e, h]));
    try {
      return d(m(i.concat([new Uint8Array([2]), r])));
    } catch {
      n[0]++;
    }
  }
  throw new Error("No valid point found");
}
function H(t) {
  const n = t.map((o) => o.toHex(!1)).join("");
  return a(new TextEncoder().encode(n));
}
function K(t) {
  return f.ProjectivePoint.fromHex(m(t));
}
function d(t) {
  return f.ProjectivePoint.fromHex(t);
}
const S = (t) => {
  let e;
  return /^[a-fA-F0-9]+$/.test(t) ? e = y(t) % BigInt(2 ** 31 - 1) : e = x(g(t)) % BigInt(2 ** 31 - 1), e;
};
function v() {
  return f.utils.randomPrivateKey();
}
function l(t) {
  const e = {};
  return Object.keys(t).forEach((n) => {
    e[n] = m(t[n]);
  }), e;
}
function O(t) {
  const e = {};
  return Object.keys(t).forEach((n) => {
    e[n] = u(t[n]);
  }), e;
}
function P(t) {
  const n = (r) => [BigInt(r[0]), r[1]], s = Object.entries(l(t)).map(n).sort((r, c) => r[0] < c[0] ? -1 : r[0] > c[0] ? 1 : 0).map(([, r]) => u(r)).reduce((r, c) => I(r, c), new Uint8Array()), o = a(s);
  return "00" + i.from(o).toString("hex").slice(0, 14);
}
function I(t, e) {
  const n = new Uint8Array(t.length + e.length);
  return n.set(t), n.set(e, t.length), n;
}
export {
  v as createRandomPrivateKey,
  P as deriveKeysetId,
  O as deserializeMintKeys,
  S as getKeysetIdInt,
  w as hashToCurve,
  H as hash_e,
  K as pointFromBytes,
  d as pointFromHex,
  l as serializeMintKeys
};
//# sourceMappingURL=common.es.js.map
