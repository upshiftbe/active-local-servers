import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRelease } from './copy-release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);

const build = spawnSync('pnpm', ['-F', '@als/desktop', 'tauri', 'build', ...extra], {
  cwd: root,
  stdio: 'inherit',
});

if (build.status !== 0) process.exit(build.status ?? 1);

const copied = await copyRelease({ root });
console.log('Latest release:');
for (const file of copied) console.log(`  ${file}`);
