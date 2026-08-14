#!/usr/bin/env node
// Loads .env.test.local (gitignored, never committed) and runs the live-hub
// integration test suite with those values merged into the child process's
// environment. This script is the only thing that ever reads the file's
// contents — it never logs them, and nothing here writes them anywhere else.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const envFile = path.resolve(process.cwd(), '.env.test.local');

if (!existsSync(envFile)) {
	console.error(
		[
			'.env.test.local not found.',
			'',
			'Create it in the project root (it is gitignored) with:',
			'',
			'  NODEFLEX_TEST_API_KEY=your-key-here',
			'',
			'See docs/testing.md section 0.4 for details.',
		].join('\n'),
	);
	process.exit(1);
}

function parseEnvFile(contents) {
	const result = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separatorIndex = line.indexOf('=');
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		let value = line.slice(separatorIndex + 1).trim();
		const isQuoted =
			(value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
		if (isQuoted) value = value.slice(1, -1);
		result[key] = value;
	}
	return result;
}

const parsedEnv = parseEnvFile(readFileSync(envFile, 'utf8'));

// Resolve vitest's own CLI script and run it with `node` directly — avoids
// relying on npx/npx.cmd shell shims, which spawn unreliably cross-platform.
// vitest's package.json "exports" doesn't expose ./vitest.mjs directly, so
// resolve the package root (which is exported) and join its "bin" path.
const vitestPkgPath = require.resolve('vitest/package.json');
const vitestPkg = JSON.parse(readFileSync(vitestPkgPath, 'utf8'));
const vitestBin = path.join(path.dirname(vitestPkgPath), vitestPkg.bin.vitest);

const child = spawn(process.execPath, [vitestBin, 'run', '--config', 'vitest.integration.config.mts'], {
	stdio: 'inherit',
	env: { ...process.env, ...parsedEnv },
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
	console.error('Failed to launch vitest:', err.message);
	process.exit(1);
});
