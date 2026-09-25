import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BUNDLE_EXT = /\.(dmg|deb|AppImage)$/;

export function releaseFileName(src, version, product) {
  const slug = product.trim().replace(/\s+/g, '-');
  const base = basename(src);
  const ext = base.endsWith('.app') ? '.app' : base.slice(base.lastIndexOf('.'));
  const arch = archFrom(src);
  return `${slug}-${version}${arch ? `-${arch}` : ''}${ext}`;
}

function archFrom(src) {
  const normalized = src.replaceAll('\\', '/');
  if (normalized.includes('/universal-apple-darwin/')) return 'universal';

  const tagged = basename(src).match(/_([^_]+)\.(dmg|deb|AppImage)$/);
  if (tagged && !/^\d/.test(tagged[1])) return tagged[1];

  if (basename(src).endsWith('.app')) {
    if (process.arch === 'arm64') return 'aarch64';
    if (process.arch === 'x64') return 'x64';
  }

  return null;
}

function readTauriConfig(root) {
  return JSON.parse(readFileSync(join(root, 'packages/desktop/src-tauri/tauri.conf.json'), 'utf8'));
}

async function bundleRoots(targetDir) {
  const roots = [];
  const add = async (dir) => {
    try {
      if ((await stat(dir)).isDirectory()) roots.push(dir);
    } catch {
      // This target has not been built.
    }
  };

  await add(join(targetDir, 'release', 'bundle'));

  let entries = [];
  try {
    entries = await readdir(targetDir, { withFileTypes: true });
  } catch {
    return roots;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'release' || entry.name === 'debug') continue;
    await add(join(targetDir, entry.name, 'release', 'bundle'));
  }

  return roots;
}

async function findBundles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app')) found.push(path);
      else found.push(...(await findBundles(path)));
    } else if (BUNDLE_EXT.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function kindOf(path) {
  if (path.endsWith('.app')) return '.app';
  const dot = path.lastIndexOf('.');
  return path.slice(dot);
}

async function newestByKind(files) {
  const newest = new Map();
  for (const file of files) {
    const info = await stat(file);
    const kind = kindOf(file);
    const current = newest.get(kind);
    if (!current || info.mtimeMs > current.mtimeMs) {
      newest.set(kind, { path: file, mtimeMs: info.mtimeMs });
    }
  }
  return newest;
}

async function clearKind(outDir, kind) {
  let entries = [];
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.name !== '.gitkeep' && entry.name.endsWith(kind))
      .map((entry) => rm(join(outDir, entry.name), { recursive: true, force: true })),
  );
}

export async function copyRelease(options = {}) {
  const root = options.root ?? repoRoot;
  const config = options.version && options.product ? null : readTauriConfig(root);
  const version = options.version ?? config.version;
  const product = options.product ?? config.productName;
  const targetDir = options.targetDir ?? join(root, 'packages/desktop/src-tauri/target');
  const outDir = options.outDir ?? join(root, 'releases');

  const files = [];
  for (const bundleRoot of await bundleRoots(targetDir)) {
    files.push(...(await findBundles(bundleRoot)));
  }

  const newest = await newestByKind(files);
  if (newest.size === 0) {
    throw new Error(`No desktop bundles found under ${targetDir}.`);
  }

  await mkdir(outDir, { recursive: true });

  const copied = [];
  for (const { path } of newest.values()) {
    const name = releaseFileName(path, version, product);
    const dest = join(outDir, name);
    await clearKind(outDir, kindOf(path));
    await cp(path, dest, { recursive: true });
    copied.push(dest);
  }

  return copied.sort();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  copyRelease()
    .then((copied) => {
      console.log('Latest release:');
      for (const file of copied) console.log(`  ${file}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
