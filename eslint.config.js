import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
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
	// Rules below are very strict, and highlight deprecations.
	// We should try moving towards meeting these over time.
	// ...tseslint.configs.strictTypeChecked,
	prettierConfig,
	{
		plugins: {
			prettier
		},
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
			'prettier/prettier': ['error', {}, { usePrettierrc: true }],
			'@typescript-eslint/array-type': ['error', { default: 'generic' }],
			'@typescript-eslint/await-thenable': 'warn',
			'@typescript-eslint/consistent-type-exports': 'warn',
			'@typescript-eslint/no-empty-function': 'error',
			'no-else-return': 'warn',
			// Hopefully Temporary: if we move to space indentation
			'no-mixed-spaces-and-tabs': 'off'
		}
	}
);
