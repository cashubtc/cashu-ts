//
// IMPORTANT: Extension handling for build outputs
//
// - Source TS: import paths are extensionless (e.g. "./foo").
// - Emitted runtime ESM (.js): relative imports MUST include ".js" (Node ESM).
// - Emitted CJS (.cjs): extension doesn’t matter.
// - Emitted type declarations (.d.ts): NEVER rewrite to ".js". Keep extensionless.
//
// This script must not add ".js" inside declaration files. If you ever need to
// append ".js", only patch runtime JS files (lib/**/*.js).
//

import { replaceInFileSync } from 'replace-in-file';
import fs from 'fs';
import path from 'path';

try {
  // 1) Clean .d.ts files: ensure extensionless relative specifiers
  const stripInDts = replaceInFileSync({
    files: 'lib/types/**/*.d.ts',
    from: [
      // import … from './x.js'
      /(\bfrom\s+['"])(\.\/[^'"]+?)\.js(['"];?)/g,
      // export * from './x.js'
      /(\bexport\s+\*\s+from\s+['"])(\.\/[^'"]+?)\.js(['"];?)/g,
      // export { … } from './x.js'
      /(\bexport\s+{[^}]*}\s+from\s+['"])(\.\/[^'"]+?)\.js(['"];?)/g,
    ],
    to: '$1$2$3',
  });

  const changedDts = stripInDts.filter((r) => r.hasChanged).map((r) => r.file);
  if (changedDts.length) {
    console.log('Cleaned .d.ts specifiers (removed .js):', changedDts);
  }

  // ---------- Helpers ----------
  function ensureFile(p, content) {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, content, 'utf8'); // always overwrite to avoid stale stubs
    console.log('Wrote', p);
  }

  // ---------- 2) Rich root index.d.ts with explicit re-exports ----------
  const typesDir = path.resolve('lib/types');
  const rolledModule = './cashu-ts'; // TS resolves to cashu-ts.d.ts
  const rolledPath = path.join(typesDir, 'cashu-ts.d.ts');
  const rootIndex = path.join(typesDir, 'index.d.ts');

  let explicit = [];
  try {
    const src = fs.readFileSync(rolledPath, 'utf8');
    const names = new Set();

    // export declare class|function|const|enum|interface|type|namespace <Name>
    const declRe =
      /^\s*export\s+(?:declare\s+)?(?:class|function|const|enum|interface|type|namespace)\s+([A-Za-z0-9_$]+)/gm;
    for (let m; (m = declRe.exec(src)); ) names.add(m[1]);

    // export { A, B as C } (with or without "from")
    const braceRe = /^\s*export\s+(?:type\s+)?{\s*([^}]+)\s*}/gm;
    for (let m; (m = braceRe.exec(src)); ) {
      m[1].split(',').forEach((piece) => {
        const seg = piece.trim();
        if (!seg) return;
        const alias = seg.split(/\s+as\s+/i).map((s) => s.trim());
        names.add(alias[1] || alias[0]);
      });
    }

    // do not forward 'default'
    names.delete('default');

    if (names.size) {
      explicit = Array.from(names)
        .sort()
        .map((n) => `export { ${n} } from '${rolledModule}';`);
    }
  } catch (e) {
    console.warn('Could not read or parse rolled types for explicit re-exports:', e?.message || e);
  }

  // Fallback: if scraper found nothing, still ensure the two key v2 names are surfaced
  if (explicit.length === 0) {
    explicit = [
      `export { CashuWallet } from '${rolledModule}';`,
      `export { CashuMint } from '${rolledModule}';`,
    ];
  }

  ensureFile(
    rootIndex,
    [
      // keep the broad surface
      `export * from '${rolledModule}';`,
      // add explicit named re-exports so NodeNext cannot miss them
      ...explicit,
      // mark as a module
      `export {};`,
      ``,
    ].join('\n'),
  );

  // ---------- 3) Subpath type shims for v2 exports map ----------
  // These align with package.json "exports" so TypeScript can resolve subpaths under NodeNext.

  ensureFile(path.join(typesDir, 'crypto/client/index.d.ts'), `export * from '../client';\nexport {};\n`);
  ensureFile(path.join(typesDir, 'crypto/common/index.d.ts'), `export * from '../common';\nexport {};\n`);
  ensureFile(path.join(typesDir, 'crypto/mint/index.d.ts'), `export * from '../mint';\nexport {};\n`);

  // package.json currently points "./crypto/util" at "./lib/types/crypto/util/utils.d.ts"
  // but the build emits "lib/types/crypto/util.d.ts". Provide both shims:
  ensureFile(path.join(typesDir, 'crypto/util/index.d.ts'), `export * from '../util';\nexport {};\n`);
  ensureFile(path.join(typesDir, 'crypto/util/utils.d.ts'), `export * from '../../util';\nexport {};\n`);
} catch (error) {
  console.error('post-process-dts failed:', error);
}
