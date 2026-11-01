'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppHeader } from './AppHeader';
import { Button, Card, CardHeader, Icon, Segmented, Stat, StatusPill, Toggle, cx, type FileStatus } from './ui';
import { useLocale } from '@/i18n/useLocale';
import type { Messages } from '@/i18n/messages';
import { isNotFound, library } from '@/lib/library/client';
import { MAX_TITLE_LENGTH, formatVideoId, videoNumber, type Course, type GuardrailReport, type StoredLecture } from '@/lib/library/types';

interface ProcessedLecture {
  id: string;
  videoId: string;
  /** Present only for files picked in this session; stored lectures have no File. */
  file?: File;
  fileName: string;
  sizeBytes: number;
  status: FileStatus;
  /** True once the result is in the course library. */
  persisted: boolean;
  error?: string;
  transcript?: string;
  summary?: string;
  chapterTitle?: string;
  chapterMarkdown?: string;
}

type OutputTab = 'preview' | 'markdown' | 'guardrails' | 'local';
type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

const today = () => new Date().toISOString().split('T')[0];

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function exportText(fileName: string, content: string) {
  downloadBlob(fileName, new Blob([content], { type: 'text/plain' }));
}

/** Hide the internal <!--VID:Vxx--> markers and page-break divs in the rendered preview. */
function toPreviewMarkdown(md: string) {
  return md.replace(/<!--VID:V\d+-->/g, '').replace(/<div class="page-break"><\/div>/g, '\n---\n');
}

function fromStored(l: StoredLecture): ProcessedLecture {
  return {
    id: `stored-${l.videoId}`,
    videoId: l.videoId,
    fileName: l.fileName,
    sizeBytes: l.sizeBytes,
    status: l.status,
    persisted: true,
    error: l.error,
    transcript: l.transcript,
    summary: l.chapterMarkdown,
    chapterTitle: l.chapterTitle,
    chapterMarkdown: l.chapterMarkdown,
  };
}

function toStored(i: ProcessedLecture): Omit<StoredLecture, 'updatedAt'> {
  return {
    videoId: i.videoId,
    fileName: i.fileName,
    sizeBytes: i.sizeBytes,
    status: i.status === 'done' ? 'done' : 'error',
    chapterTitle: i.chapterTitle,
    chapterMarkdown: i.chapterMarkdown,
    transcript: i.transcript,
    error: i.error,
  };
}

export default function LectureNotesApp({ courseId }: { courseId: string }) {
  const { locale, t } = useLocale();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<ProcessedLecture[]>([]);
  const [combinedLetter, setCombinedLetter] = useState('');
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [seriesMarkdown, setSeriesMarkdown] = useState('');
  const [seriesError, setSeriesError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [guardrailReport, setGuardrailReport] = useState<GuardrailReport | null>(null);
  const [isSeriesRunning, setIsSeriesRunning] = useState(false);
  const [autoGenerateSeries, setAutoGenerateSeries] = useState(true);
  const [autoStartBatch, setAutoStartBatch] = useState(true);
  const [autoDownloadSeries, setAutoDownloadSeries] = useState(true);
  const [autoDownloadPdf, setAutoDownloadPdf] = useState(true);
  const [parallelism, setParallelism] = useState(2);
  const [activeOutput, setActiveOutput] = useState<OutputTab>('preview');
  const [isDragging, setIsDragging] = useState(false);

  // Source of truth for async workers; state mirrors it for rendering.
  const itemsRef = useRef<ProcessedLecture[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Markdown as last saved, so blur only writes real edits.
  const savedSeriesRef = useRef('');

  const updateItems = (fn: (prev: ProcessedLecture[]) => ProcessedLecture[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  };

  useEffect(() => {
    let cancelled = false;
    library
      .get(courseId)
      .then((course: Course) => {
        if (cancelled) return;
        itemsRef.current = course.lectures.map(fromStored);
        setItems(itemsRef.current);
        setCourseTitle(course.title);
        setTitleDraft(course.title);
        setSeriesMarkdown(course.seriesMarkdown);
        savedSeriesRef.current = course.seriesMarkdown;
        setGuardrailReport(course.guardrailReport);
        setLoadState('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isNotFound(e) || (e as { status?: number })?.status === 400) {
          setLoadState('notfound');
        } else {
          setLoadError(e instanceof Error ? e.message : String(e));
          setLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const doneItems = useMemo(() => items.filter((i) => i.status === 'done'), [items]);
  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const uploadingCount = items.filter((i) => i.status === 'uploading').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const clearableCount = items.filter((i) => i.status === 'queued' || (i.status === 'error' && !i.persisted)).length;
  const progress = items.length === 0 ? 0 : Math.round(((doneItems.length + errorCount) / items.length) * 100);
  const missingIds = Array.isArray(guardrailReport?.missingIds) ? guardrailReport.missingIds : null;

  const persist = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setSaveError('');
      return true;
    } catch (e) {
      setSaveError(t.saveError(errorMessage(e, t.unknownError)));
      return false;
    }
  };

  const persistSeries = async (md: string, report: GuardrailReport | null) => {
    if (await persist(() => library.saveSeries(courseId, md, report))) savedSeriesRef.current = md;
  };

  const saveTitle = async () => {
    const title = titleDraft.replace(/\s+/g, ' ').trim();
    if (!title || title === courseTitle) {
      setTitleDraft(courseTitle);
      return;
    }
    if (await persist(() => library.rename(courseId, title))) setCourseTitle(title);
  };

  const exportPdf = async (md: string, title: string) => {
    if (!md.trim()) return;
    try {
      const res = await fetch('/api/series-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesTitle: title, seriesMarkdown: md }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      downloadBlob(`series-${today()}.pdf`, await res.blob());
    } catch (e) {
      setSeriesError(t.pdfError(errorMessage(e, t.unknownError)));
    }
  };

  const generateSeries = async () => {
    if (isSeriesRunning) return;
    setIsSeriesRunning(true);
    setSeriesError('');
    try {
      const chapters = itemsRef.current
        .filter((i) => i.status === 'done')
        .map((i) => ({
          videoId: i.videoId,
          fileName: i.fileName,
          transcriptText: i.transcript,
          chapterTitle: i.chapterTitle,
          chapterMarkdown: i.chapterMarkdown || i.summary || '',
        }));
      if (chapters.length === 0) throw new Error(t.noChapters);

      const res = await fetch('/api/series-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesTitle: courseTitle, chapters }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

      const md: string = json.seriesMarkdown || '';
      const report: GuardrailReport | null = json.guardrailReport || null;
      setSeriesMarkdown(md);
      setGuardrailReport(report);
      setActiveOutput('preview');
      await persistSeries(md, report);

      const ok = md && Array.isArray(report?.missingIds) && report.missingIds.length === 0;
      if (ok && autoDownloadSeries) exportText(`series-${today()}.md`, md);
      if (ok && autoDownloadPdf) await exportPdf(md, courseTitle);
    } catch (e) {
      setSeriesError(t.seriesError(errorMessage(e, t.unknownError)));
    } finally {
      setIsSeriesRunning(false);
    }
  };

  const processOne = async (item: ProcessedLecture) => {
    const file = item.file;
    if (!file) return;
    updateItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading', error: undefined } : p)));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/process-lecture', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        const step = typeof json?.step === 'string' ? json.step : '';
        const msg = json?.error || `Request failed (${res.status})`;
        throw new Error(step ? `${msg} (step: ${step})` : msg);
      }
      updateItems((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? {
                ...p,
                status: 'done',
                transcript: json.transcript,
                summary: json.summary,
                chapterTitle: json.chapterTitle,
                chapterMarkdown: json.chapterMarkdown,
              }
            : p,
        ),
      );
    } catch (e) {
      updateItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: errorMessage(e, t.unknownError) } : p)));
    }
    const result = itemsRef.current.find((p) => p.id === item.id);
    if (result && (result.status === 'done' || result.status === 'error')) {
      if (await persist(() => library.saveLecture(courseId, toStored(result)))) {
        updateItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, persisted: true } : p)));
      }
    }
  };

  const runBatch = async () => {
    if (isBatchRunning) return;
    setIsBatchRunning(true);
    try {
      // Failed items are retried once per batch; files added while the batch runs are picked up too.
      // Stored lectures without a File cannot be re-sent; they need a fresh upload.
      const retry = new Set(itemsRef.current.filter((i) => i.status === 'error' && i.file).map((i) => i.id));
      const claimed = new Set<string>();
      const next = () =>
        itemsRef.current.find(
          (i) => i.file && !claimed.has(i.id) && (i.status === 'queued' || (i.status === 'error' && retry.has(i.id))),
        );
      const pending = itemsRef.current.filter((i) => i.file && (i.status === 'queued' || i.status === 'error')).length;
      const maxWorkers = Math.max(1, Math.min(6, Number(parallelism) || 1));
      const worker = async () => {
        for (let item = next(); item; item = next()) {
          claimed.add(item.id);
          await processOne(item);
        }
      };
      await Promise.all(Array.from({ length: Math.min(maxWorkers, Math.max(1, pending)) }, () => worker()));
    } finally {
      setIsBatchRunning(false);
    }
    if (autoGenerateSeries && itemsRef.current.some((i) => i.status === 'done')) {
      await generateSeries();
    }
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const mp4s = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.mp4'));
    if (mp4s.length === 0) return;

    updateItems((prev) => {
      const next = [...prev];
      let maxNumber = next.reduce((m, i) => Math.max(m, videoNumber(i.videoId)), 0);
      for (const file of mp4s) {
        // A stored lecture that failed earlier is picked up again when the same file is re-uploaded.
        const failed = next.findIndex((i) => i.status === 'error' && !i.file && i.fileName === file.name);
        if (failed >= 0) {
          next[failed] = { ...next[failed], file, sizeBytes: file.size, status: 'queued', error: undefined };
          continue;
        }
        const duplicate = next.some((i) => i.fileName === file.name && i.sizeBytes === file.size && i.status !== 'error');
        if (duplicate) continue;
        maxNumber += 1;
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          videoId: formatVideoId(maxNumber),
          file,
          fileName: file.name,
          sizeBytes: file.size,
          status: 'queued',
          persisted: false,
        });
      }
      return next;
    });

    if (autoStartBatch && !isBatchRunning) void runBatch();
  };

  const generateCombinedLetter = () => {
    const joined = doneItems
      .map((i) => {
        const s = (i.chapterMarkdown || i.summary || '').trim();
        return `# ${i.chapterTitle || i.fileName} <!--VID:${i.videoId}-->\n\n${s || t.noSummary}\n`;
      })
      .join('\n');
    setCombinedLetter(`${t.localDocTitle}\n${t.localDocDate}: ${new Date().toLocaleDateString(locale)}\n\n${joined}`.trim());
    setActiveOutput('local');
  };

  const clearQueue = () => updateItems((prev) => prev.filter((i) => !(i.status === 'queued' || (i.status === 'error' && !i.persisted))));

  const tabs: Array<{ id: OutputTab; label: string }> = [
    { id: 'preview', label: t.tabPreview },
    { id: 'markdown', label: t.tabMarkdown },
    { id: 'guardrails', label: t.tabGuardrails },
    { id: 'local', label: t.tabLocal },
  ];

  if (loadState !== 'ready') {
    return <CourseFallback state={loadState} error={loadError} t={t} />;
  }

  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-8">
        <AppHeader back title={courseTitle} description={t.tagline} />

        {saveError && (
          <div role="alert" data-testid="save-error" className="mb-6 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <Icon.Alert className="mt-0.5" /> {saveError}
          </div>
        )}

        {/* ---------- Stats ---------- */}
        <Card className="mb-6 px-5 py-4 sm:px-6" aria-label={t.statusRegion}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t.statVideos} value={items.length} />
            <Stat label={t.statDone} value={doneItems.length} tone="success" />
            <Stat label={t.statActive} value={uploadingCount + queuedCount} tone="accent" />
            <Stat label={t.statErrors} value={errorCount} tone="danger" />
          </div>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label={t.progress}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${progress / 100})` }} />
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* ---------- 1) Upload ---------- */}
          <Card className="lg:col-span-2">
            <CardHeader step={1} title={t.uploadTitle} description={t.uploadDescription} />
            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <label htmlFor="series-title" className="mb-1.5 block text-sm font-medium">
                  {t.seriesTitleLabel}
                </label>
                <input
                  id="series-title"
                  maxLength={MAX_TITLE_LENGTH}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  placeholder={t.seriesTitlePlaceholder}
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={cx(
                  'relative rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
                  isDragging ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/50 hover:bg-surface-muted/60',
                )}
              >
                <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
                  <Icon.Upload className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">{t.dropHere}</p>
                <p className="mt-1 text-xs text-muted">{t.or}</p>
                <Button size="sm" className="mt-2" onClick={() => fileInputRef.current?.click()}>
                  {t.chooseFiles}
                </Button>
                <input
                  ref={fileInputRef}
                  data-testid="file-input"
                  type="file"
                  accept="video/mp4"
                  multiple
                  aria-label={t.chooseFilesAria}
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="sr-only"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="primary"
                  className="sm:flex-1"
                  onClick={() => void runBatch()}
                  disabled={!items.some((i) => i.file && (i.status === 'queued' || i.status === 'error')) || isBatchRunning}
                >
                  <Icon.Play />
                  {isBatchRunning ? t.batchRunning : t.runBatch}
                </Button>
                <Button onClick={() => void generateSeries()} disabled={doneItems.length === 0 || isBatchRunning || isSeriesRunning || uploadingCount > 0}>
                  <Icon.Sparkles />
                  {isSeriesRunning ? t.seriesRunning : t.generateSeries}
                </Button>
              </div>

              <details className="group rounded-xl border border-line px-4 open:pb-2">
                <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {t.automation}
                  <span className="text-muted transition-transform duration-200 ease-out group-open:rotate-180">⌄</span>
                </summary>
                <div className="divide-y divide-line">
                  <Toggle label={t.autoStartLabel} hint={t.autoStartHint} checked={autoStartBatch} onChange={setAutoStartBatch} disabled={isBatchRunning} />
                  <Toggle label={t.autoSeriesLabel} hint={t.autoSeriesHint} checked={autoGenerateSeries} onChange={setAutoGenerateSeries} />
                  <Toggle label={t.autoMarkdownLabel} hint={t.onlyIfGuardrailsOk} checked={autoDownloadSeries} onChange={setAutoDownloadSeries} />
                  <Toggle label={t.autoPdfLabel} hint={t.onlyIfGuardrailsOk} checked={autoDownloadPdf} onChange={setAutoDownloadPdf} />
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <span>
                      <span className="block text-sm font-medium">{t.parallelism}</span>
                      <span className="block text-xs text-muted">{t.parallelismHint}</span>
                    </span>
                    <Segmented
                      label={t.parallelism}
                      value={parallelism}
                      onChange={setParallelism}
                      disabled={isBatchRunning}
                      options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
                    />
                  </div>
                </div>
              </details>

              <p className="flex items-start gap-2 text-xs text-muted">
                <Icon.Alert className="mt-px h-3.5 w-3.5" />
                <span>
                  {t.serverNeedsPrefix} <code className="font-mono">ffmpeg</code> {t.and} <code className="font-mono">OPENAI_API_KEY</code>.
                </span>
              </p>
            </div>
          </Card>

          {/* ---------- 2) Chapters ---------- */}
          <Card className="flex flex-col lg:col-span-3">
            <CardHeader
              step={2}
              title={t.chaptersTitle}
              description={t.chaptersDescription}
              actions={
                clearableCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearQueue} disabled={isBatchRunning}>
                    <Icon.Trash /> {t.clearList}
                  </Button>
                )
              }
            />
            <div className="flex-1 p-3 sm:p-4">
              {items.length === 0 ? (
                <div className="grid h-full min-h-60 place-items-center rounded-xl border border-dashed border-line text-center">
                  <div className="px-6">
                    <Icon.Video className="mx-auto mb-3 h-6 w-6 text-muted" />
                    <p className="text-sm font-medium">{t.noVideos}</p>
                    <p className="mt-1 text-xs text-muted">{t.noVideosHint}</p>
                  </div>
                </div>
              ) : (
                <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" aria-label={t.videosList} tabIndex={0}>
                  {items.map((item) => (
                    <li key={item.id} data-testid="lecture-item" className="enter rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">{item.videoId}</span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.chapterTitle || item.fileName}</div>
                            <div className="mt-0.5 truncate text-xs text-muted">
                              {item.chapterTitle ? `${item.fileName} · ` : ''}
                              {Math.round((item.sizeBytes / 1024 / 1024) * 10) / 10} MB
                            </div>
                          </div>
                        </div>
                        <StatusPill status={item.status} label={t.status[item.status]} />
                      </div>
                      {item.status === 'uploading' && (
                        <div className="mt-3">
                          <div className="shimmer relative h-1 overflow-hidden rounded-full bg-accent-soft" />
                          <p className="mt-1.5 text-xs text-muted">{t.processing}</p>
                        </div>
                      )}
                      {item.error && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{item.error}</p>}
                      {item.status === 'error' && !item.file && <p className="mt-1.5 text-xs text-muted">{t.reuploadHint}</p>}
                      {item.status === 'done' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => exportText(`${item.fileName}.transcript.txt`, item.transcript || '')}>
                            <Icon.File /> {t.transcript}
                          </Button>
                          <Button size="sm" onClick={() => exportText(`${item.fileName}.chapter.md`, item.chapterMarkdown || item.summary || '')}>
                            <Icon.Download /> {t.chapter}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* ---------- 3) Series output ---------- */}
        <Card className="mt-6">
          <CardHeader
            step={3}
            title={t.outputTitle}
            description={t.outputDescription}
            actions={
              <>
                <Button size="sm" onClick={generateCombinedLetter} disabled={doneItems.length === 0}>
                  <Icon.Layers /> {t.mergeLocally}
                </Button>
                {seriesMarkdown && (
                  <>
                    <Button size="sm" onClick={() => exportText(`series-${today()}.md`, seriesMarkdown)}>
                      <Icon.Download /> Markdown
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void exportPdf(seriesMarkdown, courseTitle)}>
                      <Icon.Download /> PDF
                    </Button>
                  </>
                )}
                {guardrailReport && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => exportText(`series-guardrails-${today()}.json`, JSON.stringify(guardrailReport, null, 2))}
                  >
                    <Icon.Shield /> {t.report}
                  </Button>
                )}
              </>
            }
          />

          <div className="p-5 sm:p-6">
            <div role="tablist" aria-label={t.outputTabs} className="mb-4 flex gap-0.5 border-b border-line sm:gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeOutput === tab.id}
                  onClick={() => setActiveOutput(tab.id)}
                  className={cx(
                    '-mb-px whitespace-nowrap border-b-2 px-2 pb-2.5 text-[13px] font-medium sm:px-3 sm:text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                    activeOutput === tab.id ? 'border-accent text-foreground' : 'border-transparent text-muted hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {seriesError && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <Icon.Alert className="mt-0.5" /> {seriesError}
              </div>
            )}

            {missingIds && (activeOutput === 'preview' || activeOutput === 'markdown') && (
              <div
                role="status"
                data-testid="guardrail-banner"
                className={cx(
                  'enter mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm',
                  missingIds.length === 0 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
                )}
              >
                {missingIds.length === 0 ? <Icon.Shield className="mt-0.5" /> : <Icon.Alert className="mt-0.5" />}
                {missingIds.length === 0 ? t.guardrailsOk : t.guardrailsMissing(missingIds.join(', '))}
              </div>
            )}

            {activeOutput === 'preview' &&
              (seriesMarkdown ? (
                <article
                  data-testid="series-preview"
                  tabIndex={0}
                  aria-label={t.seriesPreviewLabel}
                  className="enter prose prose-zinc max-h-[36rem] max-w-none overflow-y-auto rounded-xl border border-line bg-surface px-5 py-4 dark:prose-invert prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-lg prose-table:text-sm sm:px-8 sm:py-6"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{toPreviewMarkdown(seriesMarkdown)}</ReactMarkdown>
                </article>
              ) : (
                <EmptyOutput busy={isSeriesRunning} t={t} />
              ))}

            {activeOutput === 'markdown' && (
              <textarea
                aria-label={t.markdownAria}
                value={seriesMarkdown}
                onChange={(e) => setSeriesMarkdown(e.target.value)}
                onBlur={() => {
                  if (seriesMarkdown !== savedSeriesRef.current) void persistSeries(seriesMarkdown, guardrailReport);
                }}
                className="h-[28rem] w-full rounded-xl border border-line bg-surface p-4 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder={t.markdownPlaceholder}
              />
            )}

            {activeOutput === 'guardrails' && (
              <pre
                data-testid="guardrail-json"
                tabIndex={0}
                className="h-[28rem] overflow-auto rounded-xl border border-line bg-surface-muted p-4 font-mono text-[13px] leading-relaxed"
              >
                {guardrailReport ? JSON.stringify(guardrailReport, null, 2) : t.guardrailsEmpty}
              </pre>
            )}

            {activeOutput === 'local' &&
              (combinedLetter ? (
                <textarea
                  aria-label={t.localAria}
                  value={combinedLetter}
                  onChange={(e) => setCombinedLetter(e.target.value)}
                  className="h-[28rem] w-full rounded-xl border border-line bg-surface p-4 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              ) : (
                <div className="grid h-60 place-items-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-muted">
                  {t.localEmpty}
                </div>
              ))}
          </div>
        </Card>

        <footer className="mt-10 text-center text-xs text-muted">{t.footer}</footer>
      </div>
    </div>
  );
}

function CourseFallback({ state, error, t }: { state: Exclude<LoadState, 'ready'>; error: string; t: Messages }) {
  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-8">
        <AppHeader back title={state === 'loading' ? t.loading : state === 'notfound' ? t.courseNotFound : t.libraryError(error)} />
        {state === 'loading' ? (
          <div className="space-y-6" aria-busy="true">
            <div className="h-28 animate-pulse rounded-2xl border border-line bg-surface" />
            <div className="h-96 animate-pulse rounded-2xl border border-line bg-surface" />
          </div>
        ) : (
          <Card className="px-6 py-12 text-center" data-testid="course-not-found">
            <Icon.Alert className="mx-auto mb-3 h-6 w-6 text-muted" />
            <p className="text-sm text-muted">{state === 'notfound' ? t.courseNotFoundHint : error}</p>
            <Link
              href="/"
              className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong dark:text-zinc-950"
            >
              <Icon.ArrowLeft /> {t.backToLibrary}
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}

function EmptyOutput({ busy, t }: { busy: boolean; t: Messages }) {
  return (
    <div className="grid h-60 place-items-center rounded-xl border border-dashed border-line px-6 text-center">
      <div>
        <Icon.Sparkles className={cx('mx-auto mb-3 h-6 w-6', busy ? 'animate-pulse text-accent' : 'text-muted')} />
        <p className="text-sm font-medium">{busy ? t.seriesRunning : t.emptySeries}</p>
        <p className="mt-1 text-xs text-muted">{busy ? t.buildingHint : t.emptySeriesHint}</p>
      </div>
    </div>
  );
}
