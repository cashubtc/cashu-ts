import * as fc from 'fast-check';

import { JSONInt } from '../../../src';
import { mutated, pathsOf, replaceAt } from '../arbitraries';

import type { Exchange, InMemoryMint } from './mint';

export const faultKinds = [
  'mutate',
  'replay',
  'swap element',
  'reorder',
  'shorten',
  'lengthen',
  'move amounts',
] as const;
export type FaultKind = (typeof faultKinds)[number];

type Tree = Record<string, unknown> | unknown[];
type Path = Array<string | number>;

/**
 * A response body as the wallet would parse it off the wire.
 */
function wire(value: unknown): unknown {
  return JSONInt.parse(JSONInt.stringify(value) ?? 'null');
}

function getAt(tree: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (node, key) => (node as Record<string | number, unknown> | null | undefined)?.[key],
    tree,
  );
}

function route(ex: Exchange): string {
  return `${ex.method} ${ex.path.replace(/\/[a-z0-9]+-quote-\d+$/, '/:id')}`;
}

/**
 * Alters one response body in the way `kind` names, or returns undefined where it does not apply.
 *
 * @remarks
 * "Swap element" and "replay" draw on earlier honest responses, so the substitute is well formed
 * but answers a different request.
 */
export function alter(
  kind: FaultKind,
  ex: Exchange,
  history: Exchange[],
  g: fc.GeneratorValue,
): unknown {
  const body: unknown = wire(ex.response);
  const pick = (n: number) => g(fc.nat, n - 1);
  if (kind === 'mutate') return g(mutated, body);
  if (kind === 'replay') {
    const others = history.filter((h) => h !== ex && h.status === 200 && route(h) === route(ex));
    const other = others[others.length > 0 ? pick(others.length) : -1];
    return other && wire(other.response);
  }
  const arrays = pathsOf(body).filter((p) => {
    const v = getAt(body, p);
    return Array.isArray(v) && v.length > 0;
  });
  if (arrays.length === 0) return undefined;
  const path = arrays[pick(arrays.length)];
  const items = [...(getAt(body, path) as unknown[])];
  const i = pick(items.length);
  switch (kind) {
    case 'swap element': {
      const key = path[path.length - 1];
      const seen = new Set(items.map((x) => JSONInt.stringify(x)));
      const others = history
        .flatMap((h) => {
          const v = h.status === 200 && h !== ex ? getAt(wire(h.response), path) : undefined;
          return Array.isArray(v) && typeof key === 'string' ? v : [];
        })
        .filter((x) => !seen.has(JSONInt.stringify(x)));
      if (others.length === 0) return undefined;
      items[i] = others[pick(others.length)];
      break;
    }
    case 'reorder': {
      if (items.length < 2) return undefined;
      const by = 1 + g(fc.nat, items.length - 2);
      return replaceAt(body, path, [...items.slice(by), ...items.slice(0, by)]);
    }
    case 'shorten':
      items.splice(i, 1);
      break;
    case 'lengthen':
      items.splice(pick(items.length + 1), 0, items[i]);
      break;
    case 'move amounts': {
      const j = items.findIndex((x, k) => k !== i && amountOf(x) !== amountOf(items[i]));
      if (amountOf(items[i]) === undefined || j < 0 || amountOf(items[j]) === undefined) {
        return undefined;
      }
      const [a, b] = [items[i] as Tree, items[j] as Tree];
      items[i] = { ...a, amount: amountOf(b) };
      items[j] = { ...b, amount: amountOf(a) };
      break;
    }
  }
  return replaceAt(body, path, items);
}

function encodable(v: unknown): boolean {
  try {
    JSONInt.stringify(v);
    return true;
  } catch {
    return false;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSONInt.stringify(a) === JSONInt.stringify(b);
}

function amountOf(x: unknown): unknown {
  return typeof x === 'object' && x !== null && 'amount' in x ? x.amount : undefined;
}

/**
 * Makes the mint alter one response, the first applicable one from the `at`-th exchange on.
 *
 * @returns A record of the fault once it has fired.
 */
export function faultOnce(
  mint: InMemoryMint,
  kind: FaultKind,
  at: number,
  g: fc.GeneratorValue,
): { fired?: { route: string; body: unknown } } {
  const state: { fired?: { route: string; body: unknown } } = {};
  let seen = 0;
  mint.tamper = (ex) => {
    if (state.fired || seen++ < at) return ex.response;
    const body = alter(kind, ex, mint.log, g);
    if (body === undefined || !encodable(body) || sameJson(body, ex.response)) return ex.response;
    state.fired = { route: route(ex), body };
    return body;
  };
  return state;
}
