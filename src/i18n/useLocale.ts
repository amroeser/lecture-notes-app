'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { messages, type Locale, type Messages } from './messages';

const STORAGE_KEY = 'lbs.locale';
const CHANGE_EVENT = 'lbs:localechange';

// Fallback when localStorage is unavailable, so a manual choice still holds until reload.
let memoryLocale: Locale | null = null;

function readStored(): Locale | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'de' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** First preferred system language decides: German → 'de', anything else → 'en'. */
export function detectSystemLocale(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs[0]?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

function getSnapshot(): Locale {
  return readStored() ?? memoryLocale ?? detectSystemLocale();
}

// The server cannot know the visitor's language; React hydrates with this value
// and then re-renders with the client snapshot, so no hydration mismatch occurs.
function getServerSnapshot(): Locale {
  return 'de';
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('languagechange', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('languagechange', onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function setLocale(locale: Locale) {
  memoryLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private mode etc.): memoryLocale keeps the choice until reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLocale(): { locale: Locale; t: Messages; setLocale: (l: Locale) => void } {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return { locale, t: messages[locale], setLocale };
}
