import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import OpenAI from 'openai';

/**
 * Text generation (chapters, ordering, compile, reduce, repair) behind one interface.
 *
 * - `openai`: any OpenAI-compatible Chat Completions API (default, unchanged behaviour).
 * - `claude-code`: the locally installed, unmodified Claude Code CLI (`claude -p`).
 * - `codex`: the locally installed OpenAI Codex CLI (`codex exec`).
 *
 * For the CLI providers the user signs in inside the CLI itself (`claude`, `codex login`).
 * This app never reads, stores or forwards subscription credentials or tokens; it only starts
 * the binary and passes the prompt on stdin. See
 * https://code.claude.com/docs/en/legal-and-compliance (authentication and credential use).
 */

export type TextProvider = 'openai' | 'claude-code' | 'codex';

export type TextMessage = { role: 'system' | 'user'; content: string };

/** What the routes pass in: the model name only matters for the `openai` provider. */
export type TextRequest = { model: string; messages: TextMessage[] };

export type TextConfig =
  | { provider: 'openai'; apiKey: string; baseURL?: string; temperature: number }
  | { provider: 'claude-code'; binary: string; model?: string; timeoutMs: number; maxConcurrency: number }
  | { provider: 'codex'; binary: string; model?: string; timeoutMs: number; maxConcurrency: number };

export class TextConfigError extends Error {}

/** A CLI run failed in a way the user can act on (not found, not signed in, limit reached, timeout). */
export type TextProviderFailure = 'not_found' | 'not_signed_in' | 'limit' | 'timeout' | 'aborted' | 'failed';

export class TextProviderError extends Error {
  readonly reason: TextProviderFailure;
  constructor(message: string, reason: TextProviderFailure) {
    super(message);
    this.reason = reason;
  }
}

const DEFAULT_CLI_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CLI_CONCURRENCY = 2;
/** Upper bound for what we keep from a CLI's stdout/stderr. */
const MAX_CLI_OUTPUT_BYTES = 8 * 1024 * 1024;

function positiveInt(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readTextConfig(env: NodeJS.ProcessEnv = process.env): TextConfig {
  const raw = (env.TEXT_PROVIDER || 'openai').trim().toLowerCase();
  const timeoutMs = positiveInt(env.CLI_TEXT_TIMEOUT_MS, DEFAULT_CLI_TIMEOUT_MS);
  const maxConcurrency = positiveInt(env.CLI_TEXT_MAX_CONCURRENCY, DEFAULT_CLI_CONCURRENCY);
  const model = env.CLI_TEXT_MODEL?.trim() || undefined;

  if (raw === 'openai') {
    const apiKey = env.OPENAI_TEXT_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new TextConfigError('Missing OPENAI_API_KEY (or OPENAI_TEXT_API_KEY) in environment for text generation.');
    }
    return {
      provider: 'openai',
      apiKey,
      baseURL: env.OPENAI_TEXT_BASE_URL || env.OPENAI_BASE_URL || undefined,
      temperature: Number(env.OPENAI_TEMPERATURE ?? '0.2'),
    };
  }
  if (raw === 'claude-code') {
    return { provider: 'claude-code', binary: env.CLAUDE_CODE_PATH?.trim() || 'claude', model, timeoutMs, maxConcurrency };
  }
  if (raw === 'codex') {
    return { provider: 'codex', binary: env.CODEX_PATH?.trim() || 'codex', model, timeoutMs, maxConcurrency };
  }
  throw new TextConfigError(`Unknown TEXT_PROVIDER "${raw}". Use "openai", "claude-code" or "codex".`);
}

/**
 * Extra cache-key fields. Empty for `openai`, so caches written before provider selection existed stay valid.
 */
export function textCacheTag(cfg: TextConfig): Record<string, string> {
  if (cfg.provider === 'openai') return {};
  return { textProvider: cfg.provider, cliModel: cfg.model ?? 'default' };
}

export interface TextClient {
  readonly config: TextConfig;
  /** Returns the model's text, or null when the provider returned no content. */
  complete(req: TextRequest): Promise<string | null>;
}

export function createTextClient(cfg: TextConfig, opts: { signal?: AbortSignal } = {}): TextClient {
  if (cfg.provider === 'openai') {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    return {
      config: cfg,
      async complete({ model, messages }) {
        const params: OpenAI.ChatCompletionCreateParamsNonStreaming = { model, messages };
        // gpt-5 models reject a custom temperature.
        if (!/^gpt-5/i.test(model)) params.temperature = cfg.temperature;
        const resp = await client.chat.completions.create(params, { signal: opts.signal });
        return resp.choices[0]?.message?.content ?? null;
      },
    };
  }

  return {
    config: cfg,
    complete: (req) => withCliSlot(cfg.maxConcurrency, () => runCliProvider(cfg, req, opts.signal)),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* CLI providers                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

type CliConfig = Extract<TextConfig, { provider: 'claude-code' | 'codex' }>;

// Per server process: a batch with parallel workers must not start one CLI per lecture.
let activeCliRuns = 0;
const cliWaiters: Array<() => void> = [];

async function withCliSlot<T>(max: number, fn: () => Promise<T>): Promise<T> {
  while (activeCliRuns >= max) {
    await new Promise<void>((resolve) => cliWaiters.push(resolve));
  }
  activeCliRuns += 1;
  try {
    return await fn();
  } finally {
    activeCliRuns -= 1;
    cliWaiters.shift()?.();
  }
}

function splitMessages(messages: TextMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  return { system, user };
}

const FALLBACK_SYSTEM = 'Antworte ausschließlich mit dem angeforderten Inhalt, ohne Vorrede.';

/**
 * Environment for the CLI: everything the user's shell provides, minus this app's own secrets and
 * Next.js internals. The CLI keeps using its own sign-in; we add nothing to it.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(OPENAI_|MISTRAL_|LBS_|NEXT_|__NEXT|TURBOPACK)/.test(key)) continue;
    if (key === 'NODE_OPTIONS' || key === 'NODE_ENV' || key === 'PORT' || key === 'HOSTNAME') continue;
    env[key] = value;
  }
  return env as NodeJS.ProcessEnv;
}

async function runCliProvider(cfg: CliConfig, req: TextRequest, signal?: AbortSignal): Promise<string | null> {
  const { system, user } = splitMessages(req.messages);
  // An empty working directory, so the CLI does not pick up any project context (CLAUDE.md, AGENTS.md, .mcp.json, git).
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'lbs-cli-'));
  try {
    if (cfg.provider === 'claude-code') {
      const args = [
        '-p',
        '--output-format',
        'json',
        // No tools at all: the model only writes text.
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--disable-slash-commands',
        // Skip user/project settings, so personal hooks or plugins cannot change the output.
        '--setting-sources',
        '',
        '--system-prompt',
        system || FALLBACK_SYSTEM,
        ...(cfg.model ? ['--model', cfg.model] : []),
      ];
      const out = await runCli(cfg, args, user, cwd, signal);
      return parseClaudeOutput(out);
    }

    const lastMessagePath = path.join(cwd, 'last-message.txt');
    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--output-last-message',
      lastMessagePath,
      ...(cfg.model ? ['--model', cfg.model] : []),
      // Read the prompt from stdin.
      '-',
    ];
    // Codex exec has no system-prompt flag, so the instructions lead the prompt.
    const prompt = system ? `${system}\n\n---\n\n${user}` : user;
    const out = await runCli(cfg, args, prompt, cwd, signal);
    if (out.code !== 0) throw codexError(cfg, out);
    const last = await fs.readFile(lastMessagePath, 'utf8').catch(() => '');
    const text = (last || out.stdout).trim();
    return text || null;
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

type CliOutput = { code: number | null; stdout: string; stderr: string };

function runCli(cfg: CliConfig, args: string[], input: string, cwd: string, signal?: AbortSignal): Promise<CliOutput> {
  const label = cfg.provider === 'claude-code' ? 'Claude Code' : 'Codex CLI';
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new TextProviderError(`${label}: request aborted.`, 'aborted'));

    // No shell: arguments go to the binary as they are.
    const child = spawn(cfg.binary, args, { cwd, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const kill = () => {
      if (child.exitCode === null) child.kill('SIGTERM');
    };
    const timer = setTimeout(() => {
      kill();
      finish(() => reject(new TextProviderError(`${label} did not answer within ${Math.round(cfg.timeoutMs / 1000)} s.`, 'timeout')));
    }, cfg.timeoutMs);
    const onAbort = () => {
      kill();
      finish(() => reject(new TextProviderError(`${label}: request aborted.`, 'aborted')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_CLI_OUTPUT_BYTES) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_CLI_OUTPUT_BYTES) stderr += d.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        cfg.provider === 'claude-code'
          ? 'Install Claude Code and sign in once with `claude`, or set CLAUDE_CODE_PATH.'
          : 'Install the Codex CLI and sign in once with `codex login`, or set CODEX_PATH.';
      finish(() =>
        reject(
          err.code === 'ENOENT'
            ? new TextProviderError(`${label} not found (${cfg.binary}). ${hint}`, 'not_found')
            : new TextProviderError(`${label} could not be started: ${err.message}`, 'failed'),
        ),
      );
    });
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));

    // A closed pipe (CLI exited early) must not crash the server.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

const NOT_SIGNED_IN = /not logged in|please run .*login|\/login|invalid api key|authentication|unauthori[sz]ed|\b401\b|oauth token/i;
const LIMIT = /usage limit|rate limit|limit reached|quota|\b429\b/i;

function classify(text: string): 'not_signed_in' | 'limit' | 'failed' {
  if (NOT_SIGNED_IN.test(text)) return 'not_signed_in';
  if (LIMIT.test(text)) return 'limit';
  return 'failed';
}

function tail(text: string, n = 400) {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

type ClaudeJsonResult = { type?: unknown; subtype?: unknown; is_error?: unknown; result?: unknown };

/** `claude -p --output-format json` prints one JSON object; failures inside the run are reported in it too. */
export function parseClaudeOutput(out: CliOutput): string | null {
  let parsed: ClaudeJsonResult | null = null;
  try {
    parsed = JSON.parse(out.stdout.trim()) as ClaudeJsonResult;
  } catch {
    parsed = null;
  }

  const resultText = typeof parsed?.result === 'string' ? parsed.result : '';
  const failed = out.code !== 0 || !parsed || parsed.is_error === true;
  if (!failed) return resultText.trim() || null;

  const detail = resultText || out.stderr || out.stdout;
  const reason = classify(detail);
  const message =
    reason === 'not_signed_in'
      ? 'Claude Code is not signed in. Run `claude` in a terminal once and sign in with your Claude account.'
      : reason === 'limit'
        ? `Claude Code reports a usage limit: ${tail(detail, 200)}`
        : `Claude Code failed (exit ${out.code ?? 'signal'}): ${tail(detail)}`;
  throw new TextProviderError(message, reason);
}

function codexError(cfg: CliConfig, out: CliOutput) {
  const detail = out.stderr || out.stdout;
  const reason = classify(detail);
  const message =
    reason === 'not_signed_in'
      ? 'Codex CLI is not signed in. Run `codex login` in a terminal once.'
      : reason === 'limit'
        ? `Codex CLI reports a usage limit: ${tail(detail, 200)}`
        : `Codex CLI failed (exit ${out.code ?? 'signal'}, ${cfg.binary}): ${tail(detail)}`;
  return new TextProviderError(message, reason);
}
