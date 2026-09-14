import './runtime-env.mjs';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { packagePages } from './package-pages.mjs';

const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.pages.config.ts'], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Pages output: ${await packagePages()}`);
// The framework emits a Workers deployment redirect; Pages uses its own config.
await rm('.wrangler/deploy/config.json', { force: true });
