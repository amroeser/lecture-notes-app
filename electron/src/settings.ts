import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { DesktopSettings, SecretName, SettingsPatch, SettingsView, TextProvider, TranscribeProvider } from './bridge-types';

const SECRET_NAMES: SecretName[] = ['openaiApiKey', 'mistralApiKey', 'textApiKey'];

export const DEFAULT_SETTINGS: DesktopSettings = {
  transcribeProvider: 'openai',
  openaiBaseUrl: '',
  openaiTranscribeModel: '',
  mistralTranscribeModel: '',
  textProvider: 'openai',
  textBaseUrl: '',
  summaryModel: '',
  seriesModel: '',
  claudeCodePath: '',
  codexPath: '',
  cliTextModel: '',
};

interface StoredFile {
  version: 1;
  settings: DesktopSettings;
  /** base64 of safeStorage-encrypted UTF-8 */
  secrets: Partial<Record<SecretName, string>>;
}

const TRANSCRIBE: TranscribeProvider[] = ['openai', 'mistral'];
const TEXT: TextProvider[] = ['openai', 'claude-code', 'codex'];
const MAX_FIELD = 2048;

function cleanString(v: unknown) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_FIELD) : undefined;
}

/** Accepts only known keys with valid values; everything else is dropped. */
export function sanitizeSettings(input: unknown, base: DesktopSettings = DEFAULT_SETTINGS): DesktopSettings {
  const out: DesktopSettings = { ...base };
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof DesktopSettings>) {
    if (!(key in src)) continue;
    const v = src[key];
    if (key === 'transcribeProvider') {
      if (TRANSCRIBE.includes(v as TranscribeProvider)) out.transcribeProvider = v as TranscribeProvider;
    } else if (key === 'textProvider') {
      if (TEXT.includes(v as TextProvider)) out.textProvider = v as TextProvider;
    } else {
      const s = cleanString(v);
      if (s !== undefined) out[key] = s;
    }
  }
  for (const urlKey of ['openaiBaseUrl', 'textBaseUrl'] as const) {
    if (out[urlKey] && !/^https?:\/\//i.test(out[urlKey])) out[urlKey] = '';
  }
  return out;
}

export class SettingsStore {
  private data: StoredFile = { version: 1, settings: { ...DEFAULT_SETTINGS }, secrets: {} };

  constructor(private readonly file: string) {}

  static encryptionAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<StoredFile>;
      const secrets: StoredFile['secrets'] = {};
      for (const name of SECRET_NAMES) {
        const v = raw.secrets?.[name];
        if (typeof v === 'string' && v) secrets[name] = v;
      }
      this.data = { version: 1, settings: sanitizeSettings(raw.settings), secrets };
    } catch {
      // Missing or unreadable file: start with defaults.
    }
  }

  private async persist() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  get settings(): DesktopSettings {
    return { ...this.data.settings };
  }

  view(): SettingsView {
    const secretsSet = Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(this.data.secrets[n])])) as Record<SecretName, boolean>;
    return { settings: this.settings, secretsSet, encryptionAvailable: SettingsStore.encryptionAvailable() };
  }

  secret(name: SecretName): string | undefined {
    const enc = this.data.secrets[name];
    if (!enc) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return undefined;
    }
  }

  async apply(patch: unknown): Promise<SettingsView> {
    const p = (patch && typeof patch === 'object' ? patch : {}) as SettingsPatch;
    this.data.settings = sanitizeSettings(p.settings, this.data.settings);
    if (p.secrets && typeof p.secrets === 'object') {
      for (const name of SECRET_NAMES) {
        if (!(name in p.secrets)) continue;
        const v = p.secrets[name];
        if (v === null || v === '') {
          delete this.data.secrets[name];
        } else if (typeof v === 'string') {
          if (!SettingsStore.encryptionAvailable()) {
            throw new Error('Secure storage is not available on this system; keys cannot be saved.');
          }
          const trimmed = v.trim().slice(0, MAX_FIELD);
          this.data.secrets[name] = safeStorage.encryptString(trimmed).toString('base64');
        }
      }
    }
    await this.persist();
    return this.view();
  }

  /** Maps the settings to the environment variables the API routes already read. */
  toEnv(): Record<string, string> {
    const s = this.data.settings;
    const env: Record<string, string> = {
      TRANSCRIBE_PROVIDER: s.transcribeProvider,
      TEXT_PROVIDER: s.textProvider,
    };
    const set = (key: string, value: string | undefined) => {
      if (value) env[key] = value;
    };
    set('OPENAI_API_KEY', this.secret('openaiApiKey'));
    set('MISTRAL_API_KEY', this.secret('mistralApiKey'));
    set('OPENAI_TEXT_API_KEY', this.secret('textApiKey'));
    set('OPENAI_BASE_URL', s.openaiBaseUrl);
    set('OPENAI_TEXT_BASE_URL', s.textBaseUrl);
    set('OPENAI_TRANSCRIBE_MODEL', s.openaiTranscribeModel);
    set('MISTRAL_TRANSCRIBE_MODEL', s.mistralTranscribeModel);
    set('OPENAI_SUMMARY_MODEL', s.summaryModel);
    set('OPENAI_SERIES_MODEL', s.seriesModel);
    set('CLAUDE_CODE_PATH', s.claudeCodePath);
    set('CODEX_PATH', s.codexPath);
    set('CLI_TEXT_MODEL', s.cliTextModel);
    return env;
  }
}
