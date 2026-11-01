import type { ConnectionResult, ConnectionTarget } from './bridge-types';
import { cliInfo } from './cli';
import type { SettingsStore } from './settings';

const OPENAI_DEFAULT = 'https://api.openai.com/v1';
const MISTRAL_DEFAULT = 'https://api.mistral.ai/v1';

async function listModels(baseUrl: string, apiKey: string | undefined): Promise<ConnectionResult> {
  if (!apiKey) return { ok: false, reason: 'missing_key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };
    const json = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
    return { ok: true, kind: 'api', models: Array.isArray(json?.data) ? json.data.length : 0 };
  } catch (e) {
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.message.slice(0, 200) : undefined };
  } finally {
    clearTimeout(timer);
  }
}

/** Checks the saved settings. API providers: list models. CLI providers: run `--version`. */
export async function testConnection(target: ConnectionTarget, store: SettingsStore, searchPath: string): Promise<ConnectionResult> {
  const s = store.settings;
  if (target === 'transcription') {
    if (s.transcribeProvider === 'mistral') {
      return listModels(MISTRAL_DEFAULT, store.secret('mistralApiKey'));
    }
    return listModels(s.openaiBaseUrl || OPENAI_DEFAULT, store.secret('openaiApiKey'));
  }

  if (s.textProvider === 'openai') {
    return listModels(s.textBaseUrl || s.openaiBaseUrl || OPENAI_DEFAULT, store.secret('textApiKey') ?? store.secret('openaiApiKey'));
  }
  const info =
    s.textProvider === 'claude-code' ? await cliInfo('claude', s.claudeCodePath, searchPath) : await cliInfo('codex', s.codexPath, searchPath);
  if (!info.found) return { ok: false, reason: info.path ? 'cli_failed' : 'cli_not_found', detail: info.error };
  return { ok: true, kind: 'cli', version: info.version ?? '' };
}
