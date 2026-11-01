#!/usr/bin/env node
/**
 * Development: bundles the Electron main/preload and starts Electron. In dev mode the main process
 * runs `next dev` itself (with the settings as environment), so code changes hot-reload.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);
const electron = require('electron'); // path to the Electron binary
const child = spawn(electron, [path.join(root, 'electron', 'app')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LBS_DESKTOP_DEV: '1', LBS_NODE_BIN: process.execPath },
});
child.on('exit', (code) => process.exit(code ?? 0));
