import { runSmokeTest } from '../utils.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

runSmokeTest({
	testName: 'CommonJS',
	fixtureDir: path.resolve(__dirname, '.'), // Local for CJS-specific index.ts
	installDepsCommand: 'npm i typescript @types/node --save-dev',
	preValidationSteps: ['npm pkg set type=commonjs'],
	validationCommands: ['npx tsc', 'node index.js'],
});
