import { bytesToHex as m } from "@noble/curves/abstract/utils";
import { randomBytes as p } from "@noble/hashes/utils";
import { BLAKE2s as g } from "@noble/hashes/blake2";
import { parseSecret as w } from "../common/NUT10.es.js";
import { init as y, execute as x, containsPedersenBuiltin as E, prove as d } from "stwo-cairo";
const u = (1n << 251n) + 17n * (1n << 192n) + 1n;
class f {
  constructor(t) {
    this.v = t;
  }
  static fromHex(t) {
    let e = t.startsWith("-");
    e && (t = t.slice(1));
    let o = BigInt(t);
    e && (o = -o);
    const r = (o % u + u) % u;
    return new f(r);
  }
  // 32-byte little-endian
  toBytesLE(t = 32) {
    const e = new Uint8Array(t);
    let o = this.v;
    for (let r = 0; r < t; r++)
      e[r] = Number(o & 0xffn), o >>= 8n;
    return e;
  }
}
const L = (n, t) => {
  const o = JSON.parse(n).program.bytecode, r = m(B(o)), c = BigInt(t), l = new Uint8Array(32);
  let s = c;
  for (let i = 0; i < 32; i++)
    l[i] = Number(s & 0xffn), s >>= 8n;
  const a = m(h(l));
  return { programHash: r, outputHash: a };
}, O = (n) => {
  const t = [
    "Cairo",
    {
      nonce: m(p(32)),
      data: n
    }
  ];
  return JSON.stringify(t);
}, B = (n) => {
  const e = new Uint8Array(n.length * 32);
  return n.forEach((o, r) => {
    const c = f.fromHex(o).toBytesLE(32);
    e.set(c, r * 32);
  }), h(e);
}, h = (n) => {
  let t = new g();
  return n.forEach((e) => t.update(new Uint8Array([e]))), t.digest();
}, _ = async (n, t, e) => {
  y();
  let o = Date.now();
  console.log("Executing cairo program...");
  const r = await x(t, ...e);
  console.log("Execution complete in", Date.now() - o, "ms");
  const c = E(r);
  o = Date.now(), console.log("Proving cairo execution...");
  const l = await d(r);
  return console.log("Proving complete in", Date.now() - o, "ms"), n.forEach((s) => {
    try {
      if (console.log("adding cairo witness to proof with amount:", s.amount), w(s.secret)[0] !== "Cairo")
        throw new Error("not a Cairo secret");
      const i = {
        cairo_proof_json: l,
        with_pedersen: c,
        with_bootloader: !1
      };
      s.witness = JSON.stringify(i);
    } catch (a) {
      throw console.error("Failed to attach Cairo witness:", a), a;
    }
  }), n;
};
export {
  _ as cairoProveProofs,
  L as createCairoDataPayload,
  O as createCairoSecret,
  h as hashByteArray,
  B as hashExecutableBytecode
};
//# sourceMappingURL=NUTXX.es.js.map
