import { bytesToHex as h } from "@noble/curves/abstract/utils";
import { randomBytes as w } from "@noble/hashes/utils";
import { BLAKE2s as u } from "@noble/hashes/blake2";
import { parseSecret as g } from "../common/NUT10.es.js";
import { execute as p, containsPedersenBuiltin as y, prove as E } from "stwo-cairo";
const a = (1n << 251n) + 17n * (1n << 192n) + 1n;
class l {
  constructor(t) {
    this.v = t;
  }
  static fromHex(t) {
    let o = t.startsWith("-");
    o && (t = t.slice(1));
    let e = BigInt(t);
    o && (e = -e);
    const r = (e % a + a) % a;
    return new l(r);
  }
  // 32-byte little-endian
  toBytesLE(t = 32) {
    const o = new Uint8Array(t);
    let e = this.v;
    for (let r = 0; r < t; r++)
      o[r] = Number(e & 0xffn), e >>= 8n;
    return o;
  }
}
const L = (n) => {
  const t = [
    "Cairo",
    {
      nonce: h(w(32)),
      data: n
    }
  ];
  return JSON.stringify(t);
}, N = (n) => {
  const o = new Uint8Array(n.length * 32);
  return n.forEach((e, r) => {
    const s = l.fromHex(e).toBytesLE(32);
    o.set(s, r * 32);
  }), x(o);
}, x = (n) => {
  let t = new u();
  return n.forEach((o) => t.update(new Uint8Array([o]))), t.digest();
}, _ = async (n, t, o) => {
  let e = Date.now();
  console.log("Executing cairo program...");
  const r = await p(t, ...o);
  console.log("Execution complete in", Date.now() - e, "ms");
  const s = y(r);
  e = Date.now(), console.log("Proving cairo execution...");
  const f = await E(r);
  return console.log("Proving complete in", Date.now() - e, "ms"), n.forEach((i) => {
    try {
      if (console.log("adding cairo witness to proof with amount:", i.amount), g(i.secret)[0] !== "Cairo")
        throw new Error("not a Cairo secret");
      const m = {
        cairo_proof_json: f,
        with_pedersen: s,
        with_bootloader: !1
      };
      i.witness = JSON.stringify(m);
    } catch (c) {
      throw console.error("Failed to attach Cairo witness:", c), c;
    }
  }), n;
};
export {
  _ as cairoProveProofs,
  L as createCairoSecret,
  x as hashByteArray,
  N as hashExecutableBytecode
};
//# sourceMappingURL=NUTXX.es.js.map
