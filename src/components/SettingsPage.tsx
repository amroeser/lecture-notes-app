'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type {
  AppInfo,
  CliInfo,
  CliStatus,
  ConnectionResult,
  ConnectionTarget,
  DesktopSettings,
  SecretName,
  SettingsView,
  TextProvider,
} from '../../electron/src/bridge-types';
import { useLocale } from '@/i18n/useLocale';
import { locales, type Locale } from '@/i18n/messages';
import { settingsMessages, type SettingsMessages } from '@/i18n/settings-messages';
import { Button, Card, CardHeader, Icon, Segmented, cx } from './ui';

const DEFAULTS = {
  openaiTranscribeModel: 'gpt-4o-mini-transcribe',
  mistralTranscribeModel: 'voxtral-small-transcribe-3',
  summaryModel: 'gpt-5.1-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
};

const noopSubscribe = () => () => undefined;
const useIsDesktop = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => Boolean(window.lbsDesktop?.isDesktop),
    () => false,
  );

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function TextInput({ id, value, onChange, placeholder, type = 'text' }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

function SecretField({
  name,
  label,
  hint,
  isSet,
  draft,
  onChange,
  t,
}: {
  name: SecretName;
  label: string;
  hint?: string;
  isSet: boolean;
  draft: string | null | undefined;
  onChange: (v: string | null | undefined) => void;
  t: SettingsMessages;
}) {
  const id = `secret-${name}`;
  const removing = draft === null;
  return (
    <Field id={id} label={label} hint={removing ? t.willRemove : hint}>
      <div className="flex gap-2">
        <input
          id={id}
          data-testid={`${id}-input`}
          type="password"
          value={typeof draft === 'string' ? draft : ''}
          placeholder={isSet && !removing ? t.secretPlaceholderSet : t.secretPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={cx(inputClass, 'font-mono')}
        />
        {isSet && (
          <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={() => onChange(removing ? undefined : null)}>
            {removing ? '↺' : t.removeSecret}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-xs">
        <span
          data-testid={`${id}-status`}
          className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', isSet ? 'bg-success-soft text-success' : 'bg-surface-muted text-muted')}
        >
          {isSet ? t.secretSet : t.secretNotSet}
        </span>
      </p>
    </Field>
  );
}

function CliCard({ which, info, t }: { which: 'claude' | 'codex'; info: CliInfo | undefined; t: SettingsMessages }) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted/50 px-4 py-3 text-sm">
      <div className="mb-1 text-xs font-medium text-muted">{which === 'claude' ? 'Claude Code' : 'Codex CLI'}</div>
      <div data-testid={`cli-${which}-status`} className="flex items-center gap-2 font-medium">
        <span className={cx('h-2 w-2 rounded-full', !info ? 'bg-muted' : info.found ? 'bg-success' : 'bg-danger')} />
        {!info ? t.cliChecking : info.found ? t.cliFound(info.version || which) : t.cliNotFound}
      </div>
      {info?.path && (
        <div className="mt-1 truncate text-xs text-muted">
          {t.cliPath}: <code data-testid={`cli-${which}-path`} className="font-mono">{info.path}</code>
        </div>
      )}
    </div>
  );
}

function TestResult({ result, t }: { result: ConnectionResult | undefined; t: SettingsMessages }) {
  if (!result) return null;
  let text: string;
  if (result.ok) text = result.kind === 'api' ? t.testOkApi(result.models) : t.testOkCli(result.version);
  else if (result.reason === 'missing_key') text = t.testMissingKey;
  else if (result.reason === 'http') text = t.testHttp(result.status ?? 0);
  else if (result.reason === 'network') text = t.testNetwork;
  else if (result.reason === 'cli_not_found') text = t.testCliNotFound;
  else text = t.testCliFailed;
  return (
    <span role="status" className={cx('inline-flex items-center gap-1.5 text-sm', result.ok ? 'text-success' : 'text-danger')}>
      {result.ok ? <Icon.Check /> : <Icon.Alert />}
      {text}
    </span>
  );
}

function ProviderOption({
  value,
  current,
  onSelect,
  title,
  hint,
}: {
  value: TextProvider;
  current: TextProvider;
  onSelect: (v: TextProvider) => void;
  title: string;
  hint: string;
}) {
  const active = value === current;
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        active ? 'border-accent bg-accent-soft/60' : 'border-line hover:bg-surface-muted/60',
      )}
    >
      <input type="radio" name="text-provider" value={value} checked={active} onChange={() => onSelect(value)} className="mt-1 accent-[var(--accent)]" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function WebModeNotice({ t }: { t: SettingsMessages }) {
  const vars = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'TRANSCRIBE_PROVIDER',
    'MISTRAL_API_KEY',
    'TEXT_PROVIDER',
    'CLAUDE_CODE_PATH',
    'CODEX_PATH',
    'OPENAI_SUMMARY_MODEL',
  ];
  return (
    <Card data-testid="settings-web-mode">
      <div className="space-y-4 p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-tight">{t.webTitle}</h2>
        <p className="text-sm text-muted">{t.webBody}</p>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{t.webVars}</p>
          <ul className="flex flex-wrap gap-1.5">
            {vars.map((v) => (
              <li key={v}>
                <code className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs">{v}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { locale, setLocale } = useLocale();
  const t = settingsMessages[locale];
  const isDesktop = useIsDesktop();

  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<DesktopSettings | null>(null);
  const [secrets, setSecrets] = useState<Partial<Record<SecretName, string | null>>>({});
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<ConnectionTarget | null>(null);
  const [results, setResults] = useState<Partial<Record<ConnectionTarget, ConnectionResult>>>({});

  useEffect(() => {
    const bridge = window.lbsDesktop;
    if (!bridge) return;
    let cancelled = false;
    void Promise.all([bridge.getSettings(), bridge.getCliStatus(), bridge.getAppInfo()]).then(([v, c, a]) => {
      if (cancelled) return;
      setView(v);
      setDraft(v.settings);
      setCli(c);
      setInfo(a);
      setSaved(new URLSearchParams(window.location.search).get('saved') === '1');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
    setResults({});
  };
  const updateSecret = (name: SecretName, value: string | null | undefined) => {
    setSecrets((s) => {
      const next = { ...s };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
    setSaved(false);
    setResults({});
  };

  const dirty = Boolean(view && draft && (JSON.stringify(view.settings) !== JSON.stringify(draft) || Object.keys(secrets).length > 0));

  const save = async () => {
    const bridge = window.lbsDesktop;
    if (!bridge || !draft) return;
    setSaving(true);
    setError('');
    try {
      // The main process answers, then restarts the server and reloads this page with ?saved=1.
      const v = await bridge.saveSettings({ settings: draft, secrets });
      setView(v);
      setSecrets({});
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      setSaving(false);
    }
  };

  const runTest = async (target: ConnectionTarget) => {
    const bridge = window.lbsDesktop;
    if (!bridge) return;
    setTesting(target);
    try {
      const r = await bridge.testConnection(target);
      setResults((prev) => ({ ...prev, [target]: r }));
    } finally {
      setTesting(null);
    }
  };

  const header = (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground">
          <span aria-hidden="true">←</span> {t.back}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-2 max-w-xl text-pretty text-muted">{t.subtitle}</p>
      </div>
      <div className="self-start sm:self-auto">
        <Segmented<Locale> label="Language" value={locale} onChange={setLocale} options={locales.map((l) => ({ value: l, label: l.toUpperCase() }))} />
      </div>
    </header>
  );

  let body: ReactNode;
  if (!isDesktop) {
    body = <WebModeNotice t={t} />;
  } else if (!view || !draft) {
    body = <p className="text-sm text-muted">{t.loading}</p>;
  } else {
    const s = draft;
    const testButton = (target: ConnectionTarget) => (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void runTest(target)} disabled={dirty || testing !== null} data-testid={`test-${target}`}>
          <Icon.Shield /> {testing === target ? t.testing : t.test}
        </Button>
        {dirty ? <span className="text-xs text-muted">{t.saveFirst}</span> : <TestResult result={results[target]} t={t} />}
      </div>
    );
    const transcribeUsesOpenai = s.transcribeProvider === 'openai';
    const openaiKeyAvailable = view.secretsSet.openaiApiKey || typeof secrets.openaiApiKey === 'string';

    body = (
      <div className="space-y-6">
        {saved && (
          <div data-testid="settings-saved" role="status" className="flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2.5 text-sm text-success">
            <Icon.Check className="mt-0.5" /> {t.saved}
          </div>
        )}
        {!view.encryptionAvailable && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
            <Icon.Alert className="mt-0.5" /> {t.noEncryption}
          </div>
        )}

        <Card>
          <CardHeader step={1} title={t.transcriptionTitle} description={t.transcriptionDescription} />
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{t.provider}</span>
              <Segmented
                label={t.provider}
                value={s.transcribeProvider}
                onChange={(v) => update('transcribeProvider', v)}
                options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'mistral', label: 'Mistral Voxtral' },
                ]}
              />
            </div>
            {transcribeUsesOpenai ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SecretField name="openaiApiKey" label={`OpenAI ${t.apiKey}`} isSet={view.secretsSet.openaiApiKey} draft={secrets.openaiApiKey} onChange={(v) => updateSecret('openaiApiKey', v)} t={t} />
                </div>
                <Field id="openai-base-url" label={t.baseUrl} hint={t.baseUrlHint}>
                  <TextInput id="openai-base-url" value={s.openaiBaseUrl} onChange={(v) => update('openaiBaseUrl', v)} placeholder={DEFAULTS.openaiBaseUrl} />
                </Field>
                <Field id="openai-transcribe-model" label={t.model}>
                  <TextInput id="openai-transcribe-model" value={s.openaiTranscribeModel} onChange={(v) => update('openaiTranscribeModel', v)} placeholder={t.defaultPlaceholder(DEFAULTS.openaiTranscribeModel)} />
                </Field>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SecretField name="mistralApiKey" label={`Mistral ${t.apiKey}`} isSet={view.secretsSet.mistralApiKey} draft={secrets.mistralApiKey} onChange={(v) => updateSecret('mistralApiKey', v)} t={t} />
                </div>
                <Field id="mistral-model" label={t.model}>
                  <TextInput id="mistral-model" value={s.mistralTranscribeModel} onChange={(v) => update('mistralTranscribeModel', v)} placeholder={t.defaultPlaceholder(DEFAULTS.mistralTranscribeModel)} />
                </Field>
              </div>
            )}
            {testButton('transcription')}
          </div>
        </Card>

        <Card>
          <CardHeader step={2} title={t.textTitle} description={t.textDescription} />
          <div className="space-y-5 p-5 sm:p-6">
            <fieldset className="grid gap-2" aria-label={t.provider}>
              <ProviderOption value="openai" current={s.textProvider} onSelect={(v) => update('textProvider', v)} title={t.textOpenai} hint={t.textOpenaiHint} />
              <ProviderOption value="claude-code" current={s.textProvider} onSelect={(v) => update('textProvider', v)} title={t.textClaude} hint={t.textClaudeHint} />
              <ProviderOption value="codex" current={s.textProvider} onSelect={(v) => update('textProvider', v)} title={t.textCodex} hint={t.textCodexHint} />
            </fieldset>

            {s.textProvider === 'openai' && (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SecretField name="textApiKey" label={t.textApiKey} hint={t.textApiKeyHint} isSet={view.secretsSet.textApiKey} draft={secrets.textApiKey} onChange={(v) => updateSecret('textApiKey', v)} t={t} />
                </div>
                <Field id="text-base-url" label={t.baseUrl} hint={t.textBaseUrlHint}>
                  <TextInput id="text-base-url" value={s.textBaseUrl} onChange={(v) => update('textBaseUrl', v)} placeholder={s.openaiBaseUrl || DEFAULTS.openaiBaseUrl} />
                </Field>
                <div className="hidden sm:block" />
                <Field id="summary-model" label={t.summaryModel}>
                  <TextInput id="summary-model" value={s.summaryModel} onChange={(v) => update('summaryModel', v)} placeholder={t.defaultPlaceholder(DEFAULTS.summaryModel)} />
                </Field>
                <Field id="series-model" label={t.seriesModel}>
                  <TextInput id="series-model" value={s.seriesModel} onChange={(v) => update('seriesModel', v)} placeholder={t.defaultPlaceholder(s.summaryModel || DEFAULTS.summaryModel)} />
                </Field>
                {!openaiKeyAvailable && !view.secretsSet.textApiKey && typeof secrets.textApiKey !== 'string' && (
                  <p className="flex items-start gap-2 text-xs text-warning sm:col-span-2">
                    <Icon.Alert className="mt-px h-3.5 w-3.5" /> {t.textNeedsKey}
                  </p>
                )}
              </div>
            )}

            {(s.textProvider === 'claude-code' || s.textProvider === 'codex') && (
              <div className="space-y-5">
                <CliCard which={s.textProvider === 'claude-code' ? 'claude' : 'codex'} info={s.textProvider === 'claude-code' ? cli?.claudeCode : cli?.codex} t={t} />
                <p className="text-xs text-muted">{t.cliLoginHint(s.textProvider === 'claude-code' ? 'claude' : 'codex login')}</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="cli-path" label={t.cliPathOverride} hint={t.cliPathHint}>
                    <TextInput
                      id="cli-path"
                      value={s.textProvider === 'claude-code' ? s.claudeCodePath : s.codexPath}
                      onChange={(v) => update(s.textProvider === 'claude-code' ? 'claudeCodePath' : 'codexPath', v)}
                    />
                  </Field>
                  <Field id="cli-model" label={t.model} hint={t.cliModelHint}>
                    <TextInput id="cli-model" value={s.cliTextModel} onChange={(v) => update('cliTextModel', v)} />
                  </Field>
                </div>
                <p className="flex items-start gap-2 text-xs text-muted">
                  <Icon.Alert className="mt-px h-3.5 w-3.5" /> {t.transcriptionStillNeeded}
                </p>
              </div>
            )}

            {/* Status of both CLIs stays visible for reference, also when the API is selected. */}
            {s.textProvider === 'openai' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <CliCard which="claude" info={cli?.claudeCode} t={t} />
                <CliCard which="codex" info={cli?.codex} t={t} />
              </div>
            )}
            {testButton('text')}
          </div>
        </Card>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <Icon.Alert className="mt-0.5" /> {error}
          </div>
        )}

        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/90 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-xs text-muted">{dirty ? t.unsaved : info ? t.version(info.version) : ''}</span>
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving} data-testid="settings-save">
            {saving ? t.saving : t.save}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        {header}
        {body}
      </div>
    </div>
  );
}
