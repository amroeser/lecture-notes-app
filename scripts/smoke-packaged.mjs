#!/usr/bin/env node
/**
 * Smoke test for the packaged app in dist-desktop/release (after `npm run desktop:dist`):
 * launches it with a throw-away profile, waits for the local server, checks the start page,
 * the token gate, a full upload through the bundled ffmpeg, and that the bundled ffmpeg runs.
 * Usage: node scripts/smoke-packaged.mjs [path/to/sample.mp4]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'dist-desktop', 'release');
const arch = process.arch;
const candidates = {
  darwin: [path.join(release, `mac-${arch}`, 'Lecture Batch Summarizer.app', 'Contents', 'MacOS', 'Lecture Batch Summarizer'), path.join(release, 'mac', 'Lecture Batch Summarizer.app', 'Contents', 'MacOS', 'Lecture Batch Summarizer')],
  win32: [path.join(release, 'win-unpacked', 'Lecture Batch Summarizer.exe')],
  linux: [path.join(release, 'linux-unpacked', 'lecture-batch-summarizer')],
}[process.platform] ?? [];
const executablePath = candidates.find((c) => existsSync(c));
if (!executablePath) throw new Error(`No packaged app found in ${release}`);

const resources = process.platform === 'darwin' ? path.resolve(executablePath, '..', '..', 'Resources') : path.resolve(executablePath, '..', 'resources');
const ffmpeg = path.join(resources, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffVersion = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0];
console.log(`[smoke] bundled ${ffVersion}`);

const userData = mkdtempSync(path.join(os.tmpdir(), 'lbs-smoke-'));
const started = Date.now();
const app = await electron.launch({
  executablePath,
  env: { ...process.env, LBS_USER_DATA_DIR: userData, LBS_DISABLE_UPDATE_CHECK: '1', LBS_DISABLE_OPEN_EXTERNAL: '1' },
});
try {
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  console.log(`[smoke] server ready after ${((Date.now() - started) / 1000).toFixed(1)} s at ${new URL(page.url()).origin}`);
  const h1 = await page.locator('h1').first().textContent();
  if (!h1?.includes('Lecture Batch Summarizer')) throw new Error(`unexpected start page: ${h1}`);

  const origin = new URL(page.url()).origin;
  const anonymous = await fetch(`${origin}/api/series-pdf`, { method: 'POST', body: '{}' });
  if (anonymous.status !== 403) throw new Error(`token gate: expected 403, got ${anonymous.status}`);
  console.log('[smoke] API without token: 403');

  const sample = process.argv[2];
  if (sample) {
    // A fake key and an unreachable endpoint: the request must get through upload and ffmpeg
    // and fail only at the transcription step.
    await page.evaluate(() =>
      window.lbsDesktop.saveSettings({ settings: { openaiBaseUrl: 'http://127.0.0.1:9/v1' }, secrets: { openaiApiKey: 'sk-smoke' } }),
    );
    await page.waitForURL(/\/settings\?saved=1$/, { timeout: 60_000 });
    const bytes = readFileSync(sample).toString('base64');
    const result = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append('file', new Blob([bin], { type: 'video/mp4' }), 'smoke.mp4');
      const res = await fetch('/api/process-lecture', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json() };
    }, bytes);
    console.log(`[smoke] upload ${(readFileSync(sample).length / 1e6).toFixed(1)} MB: HTTP ${result.status}, step=${result.body.step}`);
    if (result.body.step !== 'transcribe') throw new Error(`expected to fail at transcribe, got ${JSON.stringify(result.body).slice(0, 300)}`);
  }
  console.log('[smoke] ok');
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
