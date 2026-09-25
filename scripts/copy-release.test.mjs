import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyRelease, releaseFileName } from './copy-release.mjs';

test('puts the version and arch in the filename', () => {
  assert.equal(
    releaseFileName('/bundle/dmg/Active Local Servers_0.1.0_aarch64.dmg', '0.1.0', 'Active Local Servers'),
    'Active-Local-Servers-0.1.0-aarch64.dmg',
  );
  assert.equal(
    releaseFileName('/target/universal-apple-darwin/release/bundle/macos/Active Local Servers.app', '0.2.0', 'Active Local Servers'),
    'Active-Local-Servers-0.2.0-universal.app',
  );
  assert.equal(
    releaseFileName('/bundle/deb/active-local-servers_0.1.0_amd64.deb', '0.1.0', 'Active Local Servers'),
    'Active-Local-Servers-0.1.0-amd64.deb',
  );
});

test('copies the newest bundles into releases and drops the previous version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'als-release-'));
  const targetDir = join(root, 'target');
  const outDir = join(root, 'releases');
  const dmg = join(targetDir, 'release', 'bundle', 'dmg', 'Active Local Servers_0.1.0_aarch64.dmg');
  const app = join(targetDir, 'release', 'bundle', 'macos', 'Active Local Servers.app');
  const older = join(targetDir, 'release', 'bundle', 'dmg', 'Active Local Servers_0.0.9_aarch64.dmg');

  await mkdir(join(app, 'Contents'), { recursive: true });
  await writeFile(join(app, 'Contents', 'Info.plist'), 'app');
  await mkdir(join(targetDir, 'release', 'bundle', 'dmg'), { recursive: true });
  await writeFile(older, 'old');
  await writeFile(dmg, 'new');
  const oldTime = new Date('2020-01-01T00:00:00Z');
  const newTime = new Date('2024-01-01T00:00:00Z');
  await utimes(older, oldTime, oldTime);
  await utimes(dmg, newTime, newTime);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, '.gitkeep'), '');
  await writeFile(join(outDir, 'Active-Local-Servers-0.0.9-aarch64.dmg'), 'stale');
  await writeFile(join(outDir, 'Active-Local-Servers-0.0.9-amd64.deb'), 'keep-linux');

  try {
    const copied = await copyRelease({
      root,
      targetDir,
      outDir,
      version: '0.1.0',
      product: 'Active Local Servers',
    });
    const dmgName = releaseFileName(dmg, '0.1.0', 'Active Local Servers');
    const appName = releaseFileName(app, '0.1.0', 'Active Local Servers');

    assert.deepEqual(
      copied.map((file) => file.slice(outDir.length + 1)),
      [appName, dmgName].sort(),
    );
    assert.equal(await readFile(join(outDir, dmgName), 'utf8'), 'new');
    assert.equal(await readFile(join(outDir, appName, 'Contents', 'Info.plist'), 'utf8'), 'app');
    await assert.rejects(readFile(join(outDir, 'Active-Local-Servers-0.0.9-aarch64.dmg')));
    assert.equal(await readFile(join(outDir, 'Active-Local-Servers-0.0.9-amd64.deb'), 'utf8'), 'keep-linux');
    assert.equal(await readFile(join(outDir, '.gitkeep'), 'utf8'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
