#!/usr/bin/env node
/**
 * Starts the Next.js standalone server (output: 'standalone') the same way the desktop app does.
 * `next start` does not support standalone output. The standalone folder needs the static assets
 * and public/ copied next to it, which `next build` does not do.
 * Usage: PORT=3000 node scripts/start-standalone.mjs   (after `npm run build`)
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');
if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('.next/standalone/server.js is missing. Run `npm run build` first.');
  process.exit(1);
}
cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
if (existsSync(path.join(root, 'public'))) cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });

process.env.HOSTNAME ||= '127.0.0.1';
process.env.PORT ||= '3000';
process.chdir(standalone);
await import(path.join(standalone, 'server.js'));
