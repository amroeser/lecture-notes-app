/**
 * Checks the Claude Code / Codex CLI text providers against fake binaries.
 * No real CLI, no network:
 *   node scripts/test-cli-providers.mjs
 * Each fake records its argv, cwd, stdin and environment, then answers like the real CLI would.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createTextClient,
  parseClaudeOutput,
  readTextConfig,
  TextConfigError,
  TextProviderError,
  textCacheTag,
} from '../src/app/api/_utils/textModel.ts';

const dir = mkdtempSync(path.join(os.tmpdir(), 'lbs-fake-cli-'));
const logFile = path.join(dir, 'calls.jsonl');

/** Fake CLI: behaviour is chosen by the FAKE_MODE environment variable of the server process. */
function fake(name, body) {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require('fs');
const mode = process.env.FAKE_MODE || 'ok';
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const started = Date.now();
  const call = { bin: ${JSON.stringify(name)}, argv: process.argv.slice(2), cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()), stdin: input,
    leakedSecrets: Object.keys(process.env).filter((k) => /^(OPENAI_|MISTRAL_|LBS_)/.test(k)) };
  ${body}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const fakeClaude = fake(
  'claude',
  `
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 5000));
  if (mode === 'overlap') await new Promise((r) => setTimeout(r, 300));
  call.started = started; call.ended = Date.now();
  fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(call) + '\\n');
  if (mode === 'auth') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })); process.exit(1); }
  if (mode === 'limit') { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm.' })); process.exit(1); }
  if (mode === 'garbage') { process.stdout.write('not json'); process.exit(0); }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '  # Kapitel: Fake\\n\\nOK  ', total_cost_usd: 0 }));
`,
);

const fakeCodex = fake(
  'codex',
  `
  fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(call) + '\\n');
  if (mode === 'auth') { process.stderr.write('Error: Not logged in. Run codex login.'); process.exit(1); }
  const o = process.argv.indexOf('--output-last-message');
  fs.writeFileSync(process.argv[o + 1], 'Codex sagt OK');
  process.stdout.write('progress noise that must be ignored');
`,
);

function calls() {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function resetCalls() {
  rmSync(logFile, { force: true });
}

const messages = [
  { role: 'system', content: 'SYSTEM-ANWEISUNG' },
  { role: 'user', content: 'USER-PROMPT mit "Anführungszeichen" und $(echo nicht-ausführen)' },
];
const req = { model: 'gpt-5.1-mini', messages };

const claudeCfg = (over = {}) => ({
  provider: 'claude-code',
  binary: fakeClaude,
  timeoutMs: 10_000,
  maxConcurrency: 2,
  ...over,
});
const codexCfg = { provider: 'codex', binary: fakeCodex, timeoutMs: 10_000, maxConcurrency: 2 };

async function expectFailure(p, reason) {
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof TextProviderError, `expected TextProviderError, got ${String(err)}`);
    assert.equal(err.reason, reason, err.message);
    return true;
  });
}

let passed = 0;
async function check(name, fn) {
  resetCalls();
  delete process.env.FAKE_MODE;
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Secrets in the server environment must never reach the CLI.
process.env.OPENAI_API_KEY = 'sk-should-not-leak';
process.env.MISTRAL_API_KEY = 'should-not-leak';
process.env.LBS_DESKTOP_TOKEN = 'should-not-leak';

await check('config: defaults and validation', () => {
  assert.equal(readTextConfig({ OPENAI_API_KEY: 'k' }).provider, 'openai');
  assert.throws(() => readTextConfig({}), TextConfigError);
  const c = readTextConfig({ TEXT_PROVIDER: 'claude-code', CLI_TEXT_MODEL: 'sonnet' });
  assert.deepEqual(
    { provider: c.provider, ...(c.provider === 'claude-code' && { binary: c.binary, model: c.model, timeoutMs: c.timeoutMs, max: c.maxConcurrency }) },
    { provider: 'claude-code', binary: 'claude', model: 'sonnet', timeoutMs: 600000, max: 2 },
  );
  // No OpenAI key needed for CLI providers.
  assert.equal(readTextConfig({ TEXT_PROVIDER: 'codex' }).provider, 'codex');
  assert.throws(() => readTextConfig({ TEXT_PROVIDER: 'gemini' }), TextConfigError);
  assert.deepEqual(textCacheTag(readTextConfig({ OPENAI_API_KEY: 'k' })), {});
  assert.deepEqual(textCacheTag(c), { textProvider: 'claude-code', cliModel: 'sonnet' });
});

await check('claude: argv, stdin prompt, empty temp cwd, no leaked secrets', async () => {
  const text = await createTextClient(claudeCfg({ model: 'sonnet' })).complete(req);
  assert.equal(text, '# Kapitel: Fake\n\nOK');
  const [c] = calls();
  assert.deepEqual(c.argv, [
    '-p',
    '--output-format',
    'json',
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--system-prompt',
    'SYSTEM-ANWEISUNG',
    '--model',
    'sonnet',
  ]);
  assert.equal(c.stdin, messages[1].content);
  assert.ok(path.basename(c.cwd).startsWith('lbs-cli-'), c.cwd);
  assert.deepEqual(c.cwdEntries, []);
  assert.ok(!existsSync(c.cwd), 'temp cwd is removed afterwards');
  assert.deepEqual(c.leakedSecrets, []);
});

await check('claude: not signed in', async () => {
  process.env.FAKE_MODE = 'auth';
  await expectFailure(createTextClient(claudeCfg()).complete(req), 'not_signed_in');
});

await check('claude: usage limit', async () => {
  process.env.FAKE_MODE = 'limit';
  await expectFailure(createTextClient(claudeCfg()).complete(req), 'limit');
});

await check('claude: unparsable output', async () => {
  process.env.FAKE_MODE = 'garbage';
  await expectFailure(createTextClient(claudeCfg()).complete(req), 'failed');
});

await check('claude: timeout kills the process', async () => {
  process.env.FAKE_MODE = 'slow';
  const t0 = Date.now();
  await expectFailure(createTextClient(claudeCfg({ timeoutMs: 400 })).complete(req), 'timeout');
  assert.ok(Date.now() - t0 < 3000);
});

await check('claude: request abort kills the process', async () => {
  process.env.FAKE_MODE = 'slow';
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  await expectFailure(createTextClient(claudeCfg(), { signal: ac.signal }).complete(req), 'aborted');
});

await check('binary not found', async () => {
  await expectFailure(createTextClient(claudeCfg({ binary: path.join(dir, 'does-not-exist') })).complete(req), 'not_found');
});

await check('at most 2 CLI runs at the same time', async () => {
  process.env.FAKE_MODE = 'overlap';
  const client = createTextClient(claudeCfg());
  await Promise.all(Array.from({ length: 5 }, () => client.complete(req)));
  const runs = calls();
  assert.equal(runs.length, 5);
  let maxOverlap = 0;
  for (const r of runs) {
    const overlap = runs.filter((o) => o.started < r.ended && o.ended > r.started).length;
    maxOverlap = Math.max(maxOverlap, overlap);
  }
  assert.ok(maxOverlap <= 2, `overlap ${maxOverlap}`);
});

await check('codex: argv, stdin with instructions first, last message file', async () => {
  const text = await createTextClient({ ...codexCfg, model: 'gpt-6.1' }).complete(req);
  assert.equal(text, 'Codex sagt OK');
  const [c] = calls();
  const o = c.argv.indexOf('--output-last-message');
  assert.deepEqual(c.argv.slice(0, o), ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only']);
  assert.equal(path.basename(path.dirname(c.argv[o + 1])), path.basename(c.cwd));
  assert.deepEqual(c.argv.slice(o + 2), ['--model', 'gpt-6.1', '-']);
  assert.equal(c.stdin, `SYSTEM-ANWEISUNG\n\n---\n\n${messages[1].content}`);
  assert.deepEqual(c.leakedSecrets, []);
});

await check('codex: not signed in', async () => {
  process.env.FAKE_MODE = 'auth';
  await expectFailure(createTextClient(codexCfg).complete(req), 'not_signed_in');
});

await check('parseClaudeOutput: success with empty result is null', () => {
  assert.equal(parseClaudeOutput({ code: 0, stdout: '{"is_error":false,"result":"  "}', stderr: '' }), null);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
