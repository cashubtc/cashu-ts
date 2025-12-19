import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import tmp from 'tmp-promise';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..'); // From test/consumer-reactnative/ to root

async function runReactNativeTest() {
	let tgzPath = null;
	let cleanupTemp = null; // For explicit temp dir cleanup
	try {
		// Step 1: Build and pack the package (in root)
		process.chdir(projectRoot);
		execSync('npm run compile', { stdio: 'inherit' });
		const packOutput = execSync('npm pack').toString();
		const tgzFile = packOutput.match(/cashu-cashu-ts-.*\.tgz/)?.[0];
		if (!tgzFile) throw new Error('Failed to find packed .tgz');
		console.log('Packed file:', tgzFile);

		tgzPath = path.resolve(projectRoot, tgzFile);

		// Step 2: Create temp consumer dir (capture cleanup function)
		const { path: tempDir, cleanup } = await tmp.dir({ unsafeCleanup: true });
		cleanupTemp = cleanup; // Assign for finally block

		// Step 3: Init a React Native project in tempDir
		process.chdir(tempDir);
		execSync(
			'npx @react-native-community/cli init TestApp --version 0.75.3 --skip-install --skip-git-init true',
			{ stdio: 'inherit' },
		);
		const rnProjectDir = path.join(tempDir, 'TestApp');
		process.chdir(rnProjectDir);

		// Step 4: Install TypeScript deps and Jest for TS support in RN/Jest
		execSync(
			'npm i --save-dev typescript @tsconfig/react-native @types/jest @types/react @types/react-native @types/react-test-renderer jest babel-jest @babel/preset-env @babel/preset-typescript react-native',
			{ stdio: 'inherit' },
		);

		// Step 5: Copy fixture files into the RN project (e.g., tsconfig.json and __tests__/cashu.test.ts)
		const fixtureDir = path.resolve(__dirname, '.'); // Current dir for fixtures (excluding run-test.js)
		await fs.cp(fixtureDir, rnProjectDir, {
			recursive: true,
			filter: (src) => !src.endsWith('run-test.js'),
		});

		// Step 6: Install all dependencies (including Jest from React Native)
		execSync('npm install', { stdio: 'inherit' });

		// Step 7: Install the packed package
		execSync(`npm i ${tgzPath}`, { stdio: 'inherit' });

		// Step 8: Run RN tests (Jest will pick up __tests__/cashu.test.ts and compile TS)
		execSync('npm test', { stdio: 'inherit' });
		console.log('React Native test passed!');
	} catch (error) {
		console.error('React Native test failed:', error);
		process.exit(1);
	} finally {
		process.chdir(projectRoot); // Reset cwd
		// Cleanup: Delete the .tgz file if it was created
		if (
			tgzPath &&
			(await fs
				.access(tgzPath)
				.then(() => true)
				.catch(() => false))
		) {
			await fs.unlink(tgzPath);
		}
		if (cleanupTemp) {
			try {
				await cleanupTemp(); // Explicitly clean up the temp dir
			} catch (cleanupError) {
				console.warn('Failed to clean up temp dir:', cleanupError);
			}
		}
	}
}

runReactNativeTest();
