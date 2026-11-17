import { describe, expect, it } from 'vitest';

import { JSONInt, Mint } from '../../../src';
import { expand, replaceAt } from '../arbitraries';

import { apply, expectModel, expectSound, newWallet, newWorld, type Op } from './harness';
import { mintUrl, type Exchange } from './mint';

// Fields the NUTs mark optional or nullable, by the object that carries them.
const optional: Array<{ route: RegExp; at: string[]; keys: string[] }> = [
  {
    route: /info$/,
    at: [],
    keys: [
      'name',
      'pubkey',
      'version',
      'description',
      'description_long',
      'contact',
      'motd',
      'icon_url',
      'urls',
      'time',
      'tos_url',
    ],
  },
  {
    route: /info$/,
    at: ['nuts', '4', 'methods', '*'],
    keys: ['min_amount', 'max_amount', 'method_name', 'options', 'description'],
  },
  {
    route: /info$/,
    at: ['nuts', '5', 'methods', '*'],
    keys: ['min_amount', 'max_amount', 'method_name', 'options'],
  },
  { route: /keysets$/, at: ['keysets', '*'], keys: ['input_fee_ppk', 'final_expiry'] },
  { route: /keys(\/.*)?$/, at: ['keysets', '*'], keys: ['input_fee_ppk', 'final_expiry'] },
  {
    route: /mint\/quote\//,
    at: [],
    keys: ['expiry', 'pubkey', 'updated_at', 'amount_paid', 'amount_issued'],
  },
  { route: /(mint\/bolt11|swap|restore)$/, at: ['signatures', '*'], keys: ['dleq'] },
  {
    route: /melt\/(quote\/)?bolt11/,
    at: [],
    keys: ['payment_preimage', 'change'],
  },
  { route: /melt\/(quote\/)?bolt11/, at: ['change', '*'], keys: ['dleq'] },
  { route: /checkstate$/, at: ['states', '*'], keys: ['witness'] },
];

/**
 * Every listed optional field of a response, as paths, with the route it belongs to.
 */
function optionalPaths(route: string, response: unknown): Array<Array<string | number>> {
  return optional
    .filter((o) => o.route.test(route))
    .flatMap((o) => expand(response, o.at).flatMap((parent) => o.keys.map((k) => [...parent, k])));
}

function get(tree: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((t, k) => (t as Record<string | number, unknown>)?.[k], tree);
}

/**
 * Every optional field of a response written as null where the mint left it out.
 */
function withNulls(route: string, response: unknown): unknown {
  return optionalPaths(route, response)
    .filter((path) => get(response, path) === undefined)
    .reduce((out, path) => replaceAt(out, path, null), response);
}

function call(mint: Mint, ex: Exchange): Promise<unknown> {
  const id = ex.path.split('/').pop() as string;
  const r = `${ex.method} ${ex.path}`;
  if (r === 'GET /v1/info') return mint.getInfo();
  if (r === 'GET /v1/keysets') return mint.getKeySets();
  if (r.startsWith('GET /v1/keys')) return mint.getKeys(r === 'GET /v1/keys' ? undefined : id);
  if (r === 'POST /v1/mint/quote/bolt11') return mint.createMintQuoteBolt11(ex.body as never);
  if (r.startsWith('GET /v1/mint/quote/bolt11/')) return mint.checkMintQuoteBolt11(id);
  if (r === 'POST /v1/mint/bolt11') return mint.mintBolt11(ex.body as never);
  if (r === 'POST /v1/swap') return mint.swap(ex.body as never);
  if (r === 'POST /v1/melt/quote/bolt11') return mint.createMeltQuoteBolt11(ex.body as never);
  if (r.startsWith('GET /v1/melt/quote/bolt11/')) return mint.checkMeltQuoteBolt11(id);
  if (r === 'POST /v1/melt/bolt11') return mint.meltBolt11(ex.body as never);
  if (r === 'POST /v1/checkstate') return mint.check(ex.body as never);
  if (r === 'POST /v1/restore') return mint.restore(ex.body as never);
  throw new Error(`no call for ${r}`);
}

const flow: Op[] = [
  { kind: 'mint', amount: 8, byId: false },
  { kind: 'send', amount: 3, includeFees: true },
  { kind: 'receive', pick: 0 },
  { kind: 'melt', amount: 1 },
  { kind: 'mint', amount: 2, byId: true },
  { kind: 'restore' },
];

/**
 * Interop rule: a mint may write an unset optional field as `null` instead of leaving it out. The
 * response types allow `null` in places, so the check here is that nothing is rejected and the
 * wallet stays sound.
 */
describe('null means absent in mint responses', () => {
  it('at the Mint class', async () => {
    const world = await newWorld(200, true);
    for (const op of flow) await apply(world, op);
    await world.wallet.checkProofsStates(world.held);
    let checked = 0;
    for (const ex of world.mint.log) {
      if (ex.status !== 200) continue;
      const route = `${ex.method} ${ex.path}`;
      const tree = JSONInt.parse(JSONInt.stringify(ex.response) as string);
      for (const path of optionalPaths(route, tree)) {
        const mint = new Mint(mintUrl, {
          requestFetch: () =>
            Promise.resolve(new Response(JSONInt.stringify(replaceAt(tree, path, null)))),
        });
        await expect(call(mint, ex), `${route}: ${path.join('.')}`).resolves.toBeDefined();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it.each([true, false])(
    'at the wallet, for a mint that writes unset fields as null (dleq %s)',
    async (dleq) => {
      const world = await newWorld(200, dleq);
      world.mint.tamper = (ex) => withNulls(`${ex.method} ${ex.path}`, ex.response);
      world.wallet = await newWallet(world.mint, world.seed);
      for (const op of flow) {
        await apply(world, op);
        expectSound(world);
        if (op.kind !== 'restore') expectModel(world);
      }
      await world.wallet.checkProofsStates(world.held);
    },
  );
});
