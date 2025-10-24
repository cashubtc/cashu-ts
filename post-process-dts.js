//
// IMPORTANT: Extension handling for build outputs
//
// - Source TS: import paths are extensionless (e.g. "./foo").
// - Emitted runtime ESM (.js): relative imports MUST include ".js" (Node ESM).
// - Emitted CJS (.cjs): extension doesn’t matter.
// - Emitted type declarations (.d.ts): NEVER rewrite to ".js". Keep extensionless.
//
// This script MUST NOT touch "lib/types/**/*.d.ts".
// If you need to append ".js", only patch runtime JS files (lib/**/*.js).
//

// post-process-dts.js
import { replaceInFileSync } from 'replace-in-file';

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

	// 2) (Optional) If you ever need to add .js to *runtime* ESM files,
	// do it here and EXCLUDE lib/types/**.d.ts. Most bundlers already emit .js.
	// const patchJs = replaceInFileSync({
	//   files: ['lib/**/*.js', '!lib/**/*.cjs', '!lib/types/**/*.d.ts'],
	//   from: /(\bfrom\s+['"])(\.\/[^'"]+?)(['"];?)/g,
	//   to: '$1$2.js$3',
	// });
	// const changedJs = patchJs.filter(r => r.hasChanged).map(r => r.file);
	// if (changedJs.length) {
	//   console.log('Added .js extensions in runtime JS:', changedJs);
	// }
} catch (error) {
	console.error('post-process-dts failed:', error);
}
