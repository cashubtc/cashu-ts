import { bytesToHex as u } from "@noble/curves/abstract/utils";
import { randomBytes as h } from "@noble/hashes/utils";
import { BLAKE2s as p } from "@noble/hashes/blake2";
import { parseSecret as w } from "../common/NUT10.es.js";
import { init as y, execute as x, containsPedersenBuiltin as E, prove as d } from "stwo-cairo";
const m = (1n << 251n) + 17n * (1n << 192n) + 1n;
class f {
  constructor(t) {
    this.v = t;
  }
  static fromHex(t) {
    let e = t.startsWith("-");
    e && (t = t.slice(1));
    let o = BigInt(t);
    e && (o = -o);
    const n = (o % m + m) % m;
    return new f(n);
  }
  // 32-byte little-endian
  toBytesLE(t = 32) {
    const e = new Uint8Array(t);
    let o = this.v;
    for (let n = 0; n < t; n++)
      e[n] = Number(o & 0xffn), o >>= 8n;
    return e;
  }
}
const L = (r, t) => {
  const o = JSON.parse(r).program.bytecode, n = u(B(o)), i = BigInt(t), l = new Uint8Array(32);
  let s = i;
  for (let a = 0; a < 32; a++)
    l[a] = Number(s & 0xffn), s >>= 8n;
  const c = u(g(l));
  return { programHash: n, outputHash: c };
}, O = (r) => {
  const t = [
    "Cairo",
    {
      nonce: u(h(32)),
      data: r
    }
  ];
  return JSON.stringify(t);
}, B = (r) => {
  const e = new Uint8Array(r.length * 32);
  return r.forEach((o, n) => {
    const i = f.fromHex(o).toBytesLE(32);
    e.set(i, n * 32);
  }), g(e);
}, g = (r) => {
  let t = new p();
  return r.forEach((e) => t.update(new Uint8Array([e]))), t.digest();
}, _ = async (r, t, e) => {
  console.log("Initializing cairo wasm workers..."), y(), console.log("Initialization complete.");
  let o = Date.now();
  console.log("Executing cairo program...");
  const n = await x(t, ...e);
  console.log("Execution complete in", Date.now() - o, "ms");
  const i = E(n);
  o = Date.now(), console.log("Proving cairo execution...");
  const l = await d(n);
  return console.log("Proving complete in", Date.now() - o, "ms"), r.forEach((s) => {
    try {
      if (console.log("adding cairo witness to proof with amount:", s.amount), w(s.secret)[0] !== "Cairo")
        throw new Error("not a Cairo secret");
      const a = {
        cairo_proof_json: l,
        with_pedersen: i,
        with_bootloader: !1
      };
      s.witness = JSON.stringify(a);
    } catch (c) {
      throw console.error("Failed to attach Cairo witness:", c), c;
    }
  }), r;
};
export {
  _ as cairoProveProofs,
  L as createCairoDataPayload,
  O as createCairoSecret,
  g as hashByteArray,
  B as hashExecutableBytecode
};
//# sourceMappingURL=NUTXX.es.js.map
