#!/usr/bin/env node
/**
 * Prepares everything the Electron app needs:
 *   dist-desktop/server   Next.js standalone server + static assets + public/
 *   dist-desktop/ffmpeg   ffmpeg binary for this platform/arch (from ffmpeg-static) + licence
 *   electron/app          bundled main.js + preload.js + a minimal package.json (the app's asar root)
 * Usage: node scripts/build-desktop.mjs [--skip-next] [--electron-only]
 *   --electron-only  only bundle main/preload (used by desktop:dev, which runs `next dev`)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-desktop');
const appDir = path.join(root, 'electron', 'app');
const electronOnly = process.argv.includes('--electron-only');
const skipNext = electronOnly || process.argv.includes('--skip-next');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function step(msg) {
  console.log(`[build-desktop] ${msg}`);
}

if (!skipNext) {
  step('next build');
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
}

async function bundleElectron() {
  step('bundle electron main + preload');
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  await build({
    entryPoints: {
      main: path.join(root, 'electron', 'src', 'main.ts'),
      preload: path.join(root, 'electron', 'src', 'preload.ts'),
    },
    outdir: appDir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        productName: 'Lecture Batch Summarizer',
        version: pkg.version,
        description: pkg.description,
        author: pkg.author,
        license: pkg.license,
        main: 'main.js',
      },
      null,
      2,
    ),
  );
}

if (electronOnly) {
  await bundleElectron();
  step('done (electron only)');
  process.exit(0);
}

const standalone = path.join(root, '.next', 'standalone');
if (!existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('.next/standalone/server.js is missing. Is output: "standalone" set in next.config.ts?');
}

step('assemble server');
const serverDir = path.join(dist, 'server');
rmSync(serverDir, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(standalone, serverDir, { recursive: true });
cpSync(path.join(root, '.next', 'static'), path.join(serverDir, '.next', 'static'), { recursive: true });
if (existsSync(path.join(root, 'public'))) cpSync(path.join(root, 'public'), path.join(serverDir, 'public'), { recursive: true });

// Never ship local secrets or caches that the standalone trace may have picked up.
for (const name of readdirSync(serverDir)) {
  if (name.startsWith('.env') || name === '.cache' || name === '.data') {
    rmSync(path.join(serverDir, name), { recursive: true, force: true });
    step(`removed ${name} from server bundle`);
  }
}
const nextCache = path.join(serverDir, '.next', 'cache');
if (existsSync(nextCache)) rmSync(nextCache, { recursive: true, force: true });

step('copy ffmpeg');
const ffDir = path.join(dist, 'ffmpeg');
rmSync(ffDir, { recursive: true, force: true });
mkdirSync(ffDir, { recursive: true });
const ffStatic = path.join(root, 'node_modules', 'ffmpeg-static');
const ffName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
if (!existsSync(path.join(ffStatic, ffName))) {
  throw new Error(`ffmpeg-static has no binary for ${process.platform}/${process.arch}. Run npm ci on the target platform.`);
}
cpSync(path.join(ffStatic, ffName), path.join(ffDir, ffName));
for (const f of ['ffmpeg.LICENSE', 'ffmpeg.README', 'LICENSE']) {
  if (existsSync(path.join(ffStatic, f))) cpSync(path.join(ffStatic, f), path.join(ffDir, f === 'LICENSE' ? 'ffmpeg-static.LICENSE' : f));
}

await bundleElectron();

step('done');
