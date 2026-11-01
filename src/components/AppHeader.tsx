'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, Segmented } from './ui';
import { useLocale } from '@/i18n/useLocale';
import { locales, type Locale } from '@/i18n/messages';

/** Top bar shared by the library and the course workspace, followed by the page title block. */
export function AppHeader({ title, description, back, actions }: { title: ReactNode; description?: ReactNode; back?: boolean; actions?: ReactNode }) {
  const { locale, t, setLocale } = useLocale();

  return (
    <header className="mb-8 sm:mb-10">
      <nav className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:mb-10" aria-label="Lecture Batch Summarizer">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={24} height={24} className="h-6 w-6" />
          Lecture Batch Summarizer
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Segmented<Locale>
            label={t.languageLabel}
            value={locale}
            onChange={setLocale}
            options={locales.map((l) => ({ value: l, label: l.toUpperCase() }))}
          />
          <Link
            href="/settings"
            data-testid="settings-link"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon.Settings />
            <span className="hidden sm:inline">{t.settings}</span>
            <span className="sr-only sm:hidden">{t.settings}</span>
          </Link>
          <a
            href="https://github.com/amroeser/lecture-notes-app"
            className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent sm:inline-flex"
          >
            <Icon.Github />
            GitHub
          </a>
        </div>
      </nav>

      {back && (
        <Link
          href="/"
          data-testid="back-to-library"
          className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon.ArrowLeft /> {t.backToLibrary}
        </Link>
      )}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            OpenAI · Voxtral · PDF
          </div>
          <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-pretty text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
