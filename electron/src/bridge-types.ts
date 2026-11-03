/**
 * Types shared by the Electron main process, the preload script and the web UI (window.lbsDesktop).
 * Secrets never travel to the renderer: it only learns whether a secret is set.
 */

export type TranscribeProvider = 'openai' | 'mistral';
export type TextProvider = 'openai' | 'claude-code' | 'codex';

export interface DesktopSettings {
  transcribeProvider: TranscribeProvider;
  /** OPENAI_BASE_URL – OpenAI or an OpenAI-compatible gateway. Empty = api.openai.com */
  openaiBaseUrl: string;
  openaiTranscribeModel: string;
  mistralTranscribeModel: string;
  textProvider: TextProvider;
  /** OPENAI_TEXT_BASE_URL – separate endpoint for chapter/series models. Empty = openaiBaseUrl */
  textBaseUrl: string;
  summaryModel: string;
  seriesModel: string;
  /** Override for the `claude` binary. Empty = look it up in PATH. */
  claudeCodePath: string;
  /** Override for the `codex` binary. Empty = look it up in PATH. */
  codexPath: string;
  cliTextModel: string;
}

export type SecretName = 'openaiApiKey' | 'mistralApiKey' | 'textApiKey';

export interface SettingsView {
  settings: DesktopSettings;
  secretsSet: Record<SecretName, boolean>;
  encryptionAvailable: boolean;
}

export interface SettingsPatch {
  settings?: Partial<DesktopSettings>;
  /** string = set, null = remove, missing = keep */
  secrets?: Partial<Record<SecretName, string | null>>;
}

export interface CliInfo {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface CliStatus {
  claudeCode: CliInfo;
  codex: CliInfo;
}

export type ConnectionTarget = 'transcription' | 'text';

export type ConnectionResult =
  | { ok: true; kind: 'api'; models: number }
  | { ok: true; kind: 'cli'; version: string }
  | { ok: false; reason: 'missing_key' | 'http' | 'network' | 'cli_not_found' | 'cli_failed'; status?: number; detail?: string };

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

export interface LbsDesktopBridge {
  readonly isDesktop: true;
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<SettingsView>;
  /** Saves, restarts the local server and reloads the window. */
  saveSettings(patch: SettingsPatch): Promise<SettingsView>;
  testConnection(target: ConnectionTarget): Promise<ConnectionResult>;
  getCliStatus(): Promise<CliStatus>;
}

export const IPC = {
  appInfo: 'lbs:app-info',
  getSettings: 'lbs:get-settings',
  saveSettings: 'lbs:save-settings',
  testConnection: 'lbs:test-connection',
  cliStatus: 'lbs:cli-status',
} as const;
