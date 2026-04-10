import type { OutputData } from './OutputData';

class EphemeralEStore {
  private eStore = new WeakMap<OutputData, string>(); // one-shot
  setEphemeralE(target: OutputData, Ehex?: string) {
    if (Ehex) this.eStore.set(target, Ehex);
  }
  takeEphemeralE(target: OutputData): string | undefined {
    const e = this.eStore.get(target);
    if (!e) return;
    this.eStore.delete(target); // one-shot to avoid leakage
    return e;
  }
}

export const emphemeralEStore = new EphemeralEStore();
