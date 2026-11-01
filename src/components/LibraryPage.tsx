'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppHeader } from './AppHeader';
import { Button, Card, ConfirmDialog, Icon, cx } from './ui';
import { useLocale } from '@/i18n/useLocale';
import type { Locale, Messages } from '@/i18n/messages';
import { library } from '@/lib/library/client';
import { MAX_TITLE_LENGTH, type CourseSummary } from '@/lib/library/types';

function relativeTime(iso: string, locale: Locale) {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Infinity],
  ];
  let value = diffSec;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

export default function LibraryPage() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<CourseSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    library
      .list()
      .then((list) => {
        if (!cancelled) setCourses(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await library.remove(toDelete.id);
      setCourses((prev) => prev?.filter((c) => c.id !== toDelete.id) ?? null);
      setToDelete(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const onRenamed = (updated: CourseSummary) => setCourses((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);

  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-8">
        <AppHeader
          title={t.libraryTitle}
          description={t.libraryTagline}
          actions={
            courses && courses.length > 0 && !creating ? (
              <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-course">
                <Icon.Plus /> {t.newCourse}
              </Button>
            ) : null
          }
        />

        {loadError && (
          <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <Icon.Alert className="mt-0.5" /> {t.libraryError(loadError)}
          </div>
        )}

        {creating && (
          <NewCourseForm
            t={t}
            onCancel={() => setCreating(false)}
            onCreated={(id) => router.push(`/course/${id}`)}
          />
        )}

        {courses === null && !loadError && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t.loading}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-line bg-surface" />
            ))}
          </div>
        )}

        {courses && courses.length === 0 && !creating && <EmptyLibrary t={t} onCreate={() => setCreating(true)} />}

        {courses && courses.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t.coursesList}>
            {courses.map((c, i) => (
              <CourseCard key={c.id} index={i} course={c} t={t} locale={locale} onRenamed={onRenamed} onDelete={() => setToDelete(c)} />
            ))}
          </ul>
        )}

        <footer className="mt-12 text-center text-xs text-muted">{t.footer}</footer>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete ? t.deleteTitle(toDelete.title) : ''}
        body={t.deleteBody}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function NewCourseForm({ t, onCancel, onCreated }: { t: Messages; onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t.titleRequired);
      return;
    }
    setBusy(true);
    try {
      const course = await library.create(title);
      onCreated(course.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 p-5 sm:p-6">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="new-course-form">
        <div className="min-w-0 flex-1">
          <label htmlFor="new-course-title" className="mb-1.5 block text-sm font-medium">
            {t.courseTitleLabel}
          </label>
          <input
            id="new-course-title"
            autoFocus
            maxLength={MAX_TITLE_LENGTH}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
            placeholder={t.seriesTitlePlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'new-course-error' : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy} className="flex-1 sm:flex-none">
            <Icon.Plus /> {t.create}
          </Button>
          <Button onClick={onCancel} className="flex-1 sm:flex-none">
            {t.cancel}
          </Button>
        </div>
      </form>
      {error && (
        <p id="new-course-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

function EmptyLibrary({ t, onCreate }: { t: Messages; onCreate: () => void }) {
  return (
    <Card className="px-6 py-12 text-center sm:py-16" data-testid="library-empty">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon.Book className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{t.emptyLibraryTitle}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t.emptyLibraryHint}</p>
      <ol className="mx-auto mt-6 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
        {t.emptySteps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <Button variant="primary" className="mt-8" onClick={onCreate} data-testid="new-course">
        <Icon.Plus /> {t.newCourse}
      </Button>
    </Card>
  );
}

function CourseCard({
  index,
  course,
  t,
  locale,
  onRenamed,
  onDelete,
}: {
  index: number;
  course: CourseSummary;
  t: Messages;
  locale: Locale;
  onRenamed: (c: CourseSummary) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(course.title);
  const [error, setError] = useState('');
  const progress = course.lectureCount === 0 ? 0 : Math.round((course.doneCount / course.lectureCount) * 100);

  const save = async () => {
    const title = draft.trim();
    if (!title) {
      setError(t.titleRequired);
      return;
    }
    if (title === course.title) {
      setEditing(false);
      return;
    }
    try {
      const updated = await library.rename(course.id, title);
      onRenamed({ ...course, title: updated.title, updatedAt: updated.updatedAt });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li data-testid="course-card" className="rise group relative" style={{ '--i': index } as React.CSSProperties}>
      <Card className="flex h-full flex-col p-5 transition-shadow duration-200 ease-out focus-within:ring-2 focus-within:ring-accent/30 hover:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.16)]">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="space-y-2"
          >
            <label htmlFor={`rename-${course.id}`} className="sr-only">
              {t.courseTitleLabel}
            </label>
            <input
              id={`rename-${course.id}`}
              autoFocus
              maxLength={MAX_TITLE_LENGTH}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft(course.title);
                  setEditing(false);
                }
              }}
              className={inputClass}
            />
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary">
                {t.save}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setDraft(course.title);
                  setEditing(false);
                }}
              >
                {t.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <h2 className="pr-16 text-base font-semibold leading-snug tracking-tight">
            <Link
              href={`/course/${course.id}`}
              className="break-words after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
              data-testid="course-link"
            >
              {course.title}
            </Link>
          </h2>
        )}

        <div className="mt-auto pt-6">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">{t.courseProgress(course.doneCount, course.lectureCount)}</span>
            {course.hasSeries && (
              <span
                className={cx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
                  course.guardrailsOk === false ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success',
                )}
              >
                {course.guardrailsOk === false ? <Icon.Alert className="h-3 w-3" /> : <Icon.Check className="h-3 w-3" />}
                {course.guardrailsOk === false ? t.seriesGaps : t.seriesReady}
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted" suppressHydrationWarning>
            {t.updated(relativeTime(course.updatedAt, locale))}
          </p>
        </div>
      </Card>

      {!editing && (
        <div className="absolute right-3 top-3 z-10 flex gap-0.5" role="group" aria-label={t.courseActions(course.title)}>
          <button
            type="button"
            onClick={() => {
              setDraft(course.title);
              setEditing(true);
            }}
            aria-label={`${t.rename}: ${course.title}`}
            title={t.rename}
            data-testid="rename-course"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon.Pencil />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${t.delete}: ${course.title}`}
            title={t.delete}
            data-testid="delete-course"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon.Trash />
          </button>
        </div>
      )}
    </li>
  );
}
