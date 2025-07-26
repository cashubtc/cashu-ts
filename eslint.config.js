import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'test/**',
			'coverage/**',
			'.jest/**',
			'jest.config.ts',
			'lib/**',
			'*.d.ts',
			'examples/**',
			'vite.config.ts',
			'vitest.workspace.ts',
			'eslint.config.js'
		]
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	prettierConfig, // removes rules that conflict with prettier
	// Config below adds strict rules, and highlights deprecations.
	// We should try moving towards enabling this over time.
	// ...tseslint.configs.strictTypeChecked,
	{
		plugins: {},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.es2021
			},
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			// Extra rules and overrides to recommended
			'@typescript-eslint/array-type': ['error', { default: 'generic' }],
			'@typescript-eslint/await-thenable': 'warn',
			'@typescript-eslint/consistent-type-exports': 'warn',
			'@typescript-eslint/no-empty-function': 'error',
			'no-else-return': 'warn'
		}
	}
);
