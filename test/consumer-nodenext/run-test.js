import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import tmp from 'tmp-promise';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..'); // From test/consumer-nodenext/ to root

async function runNodeNextTest() {
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

		// Step 3: Copy fixture files (from nested dir)
		const fixtureDir = path.resolve(__dirname, '.'); // Current dir for fixtures
		await fs.cp(fixtureDir, tempDir, {
			recursive: true,
			filter: (src) => !src.endsWith('run-test.js'),
		}); // Exclude script itself

		// Step 4: chdir to tempDir
		process.chdir(tempDir);

		// Step 5: Init and install deps
		execSync('npm init -y', { stdio: 'inherit' });
		execSync('npm i typescript --save-dev', { stdio: 'inherit' });

		// Step 6: Install the packed package
		execSync(`npm i ${tgzPath}`, { stdio: 'inherit' });

		// Step 7: Run tsc validation
		execSync('npx tsc --noEmit', { stdio: 'inherit' });
		console.log('NodeNext test passed!');
	} catch (error) {
		console.error('NodeNext test failed:', error);
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

runNodeNextTest();
