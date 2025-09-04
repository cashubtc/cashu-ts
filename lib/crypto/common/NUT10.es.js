const e = (r) => {
  try {
    return r instanceof Uint8Array && (r = new TextDecoder().decode(r)), JSON.parse(r);
  } catch {
    throw new Error("can't parse secret:, " + r);
  }
};
export {
  e as parseSecret
};
//# sourceMappingURL=NUT10.es.js.map
