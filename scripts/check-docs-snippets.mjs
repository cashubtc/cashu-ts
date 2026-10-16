// Type-checks every ```ts fence in docs-src against the shipped lib/types/index.d.ts.
// Fences are fragments, so each page becomes one file: imports hoisted and merged, each fence
// wrapped in an async function, ambient names supplied by scripts/docs-snippet-prelude.d.ts.
// Tag a fence ```ts skip to leave it out. Run after `npm run compile`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const PKG = '@cashu/cashu-ts';
const dts = join(root, 'lib', 'types', 'index.d.ts');
if (!existsSync(dts)) {
  console.error('lib/types/index.d.ts not found: run `npm run compile` first');
  process.exit(1);
}

// Every fence gets every public export in scope, so fragments need not repeat their imports.
// A name a fence imports that does not exist still fails, since it is added to the same list.
const program = ts.createProgram([dts], {});
const checker = program.getTypeChecker();
const allExports = checker
  .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(dts)))
  .map((s) => s.name);
const outDir = join(root, 'temp', 'docs-check');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const pages = readdirSync(join(root, 'docs-src'), { recursive: true })
  .filter((f) => f.endsWith('.md'))
  .map((f) => join('docs-src', f))
  .sort();

// generated file -> generated line -> { page, line }
const lineMaps = new Map();
let fenceCount = 0;
let skipped = 0;

for (const page of pages) {
  const md = readFileSync(join(root, page), 'utf8').split('\n');
  const imports = new Map(); // module -> Set(names); passthrough imports keyed by full text
  const passthrough = new Set();
  const bodies = []; // { start, lines }
  let fence = null;
  for (let i = 0; i < md.length; i++) {
    const line = md[i];
    if (fence === null) {
      const m = /^```(ts|typescript)(\s+skip)?\s*$/.exec(line);
      if (m) {
        if (m[2]) skipped++;
        fence = m[2] ? 'skip' : { start: i + 2, lines: [] };
      }
      continue;
    }
    if (/^```\s*$/.test(line)) {
      if (fence !== 'skip') bodies.push(fence);
      fence = null;
      continue;
    }
    if (fence !== 'skip') fence.lines.push(line);
  }
  if (bodies.length === 0) continue;

  const gen = [];
  const map = [];
  const emit = (text, mdLine) => {
    gen.push(text);
    map.push(mdLine);
  };

  // Pull import statements (possibly multi-line) out of each fence body.
  for (const b of bodies) {
    const rest = [];
    for (let i = 0; i < b.lines.length; i++) {
      if (!/^import\b/.test(b.lines[i])) {
        rest.push([b.lines[i], b.start + i]);
        continue;
      }
      let stmt = b.lines[i];
      while (
        !/from\s+['"][^'"]+['"]\s*;?\s*$/.test(stmt) &&
        !/^import\s+['"]/.test(stmt) &&
        i + 1 < b.lines.length
      ) {
        stmt += '\n' + b.lines[++i];
      }
      const named = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/.exec(stmt);
      if (!named) {
        passthrough.add(stmt.replace(/\s*;?\s*$/, ';'));
        continue;
      }
      const set = imports.get(named[3]) ?? new Set();
      for (const n of named[2].split(',')) {
        const name = n.replace(/^\s*type\s+/, '').trim();
        if (name) set.add(name);
      }
      imports.set(named[3], set);
    }
    b.lines = rest;
  }

  const pkgNames = new Set([...allExports, ...(imports.get(PKG) ?? [])]);
  imports.delete(PKG);
  // A name the page imports from elsewhere (eg bytesToHex from noble) wins over the library's.
  for (const names of imports.values()) for (const n of names) pkgNames.delete(n);
  emit(`import { ${[...pkgNames].join(', ')} } from '${PKG}';`, 0);
  for (const [mod, names] of imports) emit(`import { ${[...names].join(', ')} } from '${mod}';`, 0);
  for (const stmt of passthrough) emit(stmt, 0);
  bodies.forEach((b, n) => {
    fenceCount++;
    emit(`export const fence${n + 1} = async () => {`, 0);
    for (const [text, mdLine] of b.lines) emit(text, mdLine);
    emit('};', 0);
  });

  const file = page
    .replace(/^docs-src\//, '')
    .replace(/\//g, '__')
    .replace(/\.md$/, '.ts');
  writeFileSync(join(outDir, file), gen.join('\n') + '\n');
  lineMaps.set(file, { page, map });
}

writeFileSync(
  join(outDir, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: {
        noEmit: true,
        declaration: false,
        emitDeclarationOnly: false,
        baseUrl: '.',
        paths: { '@cashu/cashu-ts': ['../../lib/types/index.d.ts'] },
      },
      include: ['./*.ts', '../../scripts/docs-snippet-prelude.d.ts'],
    },
    null,
    2,
  ),
);

let output = '';
try {
  execFileSync('npx', ['tsc', '-p', join(outDir, 'tsconfig.json'), '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  output = e.stdout ?? '';
}

let errors = 0;
for (const raw of output.split('\n')) {
  const m = /^(.*?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(raw);
  if (!m) continue;
  errors++;
  const file = relative(outDir, m[1]);
  const lm = lineMaps.get(file);
  const mdLine = lm?.map[Number(m[2]) - 1];
  console.log(mdLine ? `${lm.page}:${mdLine}:${m[3]} ${m[4]}` : raw);
}
console.log(`docs snippets: ${fenceCount} checked, ${skipped} skipped, ${errors} errors`);
process.exit(errors ? 1 : 0);
