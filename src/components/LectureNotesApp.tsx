'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type FileStatus = 'queued' | 'uploading' | 'done' | 'error';

interface ProcessedLecture {
  id: string;
  videoId: string;
  file: File;
  status: FileStatus;
  error?: string;
  transcript?: string;
  summary?: string;
  chapterTitle?: string;
  chapterMarkdown?: string;
}

export default function LectureNotesApp() {
  const [items, setItems] = useState<ProcessedLecture[]>([]);
  const [combinedLetter, setCombinedLetter] = useState('');
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesMarkdown, setSeriesMarkdown] = useState('');
  const [guardrailReport, setGuardrailReport] = useState<any>(null);
  const [isSeriesRunning, setIsSeriesRunning] = useState(false);
  const [autoGenerateSeries, setAutoGenerateSeries] = useState(true);
  const [autoStartBatch, setAutoStartBatch] = useState(true);
  const [autoDownloadSeries, setAutoDownloadSeries] = useState(true);
  const [autoDownloadPdf, setAutoDownloadPdf] = useState(true);
  const [parallelism, setParallelism] = useState(2);

  const [activeOutput, setActiveOutput] = useState<'series' | 'guardrails' | 'local'>('series');

  const itemsRef = useRef<ProcessedLecture[]>(items);
  const pendingAutoBatchRef = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!pendingAutoBatchRef.current) return;
    if (isBatchRunning) return;
    const hasQueued = itemsRef.current.some((i) => i.status === 'queued' || i.status === 'error');
    if (!hasQueued) return;
    pendingAutoBatchRef.current = false;
    runBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isBatchRunning]);

  const doneItems = useMemo(() => items.filter((i) => i.status === 'done'), [items]);
  const queuedCount = useMemo(() => items.filter((i) => i.status === 'queued').length, [items]);
  const uploadingCount = useMemo(() => items.filter((i) => i.status === 'uploading').length, [items]);
  const errorCount = useMemo(() => items.filter((i) => i.status === 'error').length, [items]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const mp4s = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.mp4'));
    const newItemsBase = mp4s.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
    }));

    setItems((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const deduped = newItemsBase.filter((n) => !existingIds.has(n.id));
      const combined = [...prev, ...deduped.map((d) => ({ ...d, status: 'queued' as const, videoId: '' }))];

      const withIds = combined.map((it, idx) => {
        const videoId = `V${String(idx + 1).padStart(2, '0')}`;
        return { ...it, videoId };
      });

      return withIds;
    });

    if (autoStartBatch && !isBatchRunning) {
      pendingAutoBatchRef.current = true;
    }
  };

  const processOne = async (item: ProcessedLecture) => {
    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading', error: undefined } : p)));

    try {
      const fd = new FormData();
      fd.append('file', item.file);

      const res = await fetch('/api/process-lecture', {
        method: 'POST',
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) {
        const step = typeof json?.step === 'string' ? json.step : '';
        const msg = json?.error || `Request failed (${res.status})`;
        throw new Error(step ? `${msg} (step: ${step})` : msg);
      }

      setItems((prev) =>
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
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Unknown error';
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: msg } : p)));
    }
  };

  const runBatch = async () => {
    if (isBatchRunning) return;
    setIsBatchRunning(true);
    try {
      const queue = itemsRef.current.filter((i) => i.status === 'queued' || i.status === 'error');
      const maxWorkers = Math.max(1, Math.min(6, Number(parallelism) || 1));
      let idx = 0;

      const worker = async () => {
        while (true) {
          const current = idx;
          idx += 1;
          const item = queue[current];
          if (!item) return;
          await processOne(item);
        }
      };

      await Promise.all(Array.from({ length: Math.min(maxWorkers, queue.length) }, () => worker()));
    } finally {
      setIsBatchRunning(false);
      if (autoGenerateSeries) {
        setActiveOutput('series');
        // Trigger series generation after batch completion
        setTimeout(() => {
          const hasDone = itemsRef.current.some((i) => i.status === 'done');
          if (hasDone) {
            generateSeries();
          }
        }, 0);
      }
    }
  };

  const generateCombinedLetter = () => {
    const joined = doneItems
      .map((i) => {
        const s = (i.chapterMarkdown || i.summary || '').trim();
        const title = i.chapterTitle || i.file.name;
        return `# ${title} <!--VID:${i.videoId}-->\n\n${s || '(keine Summary)'}\n`;
      })
      .join('\n');

    const letter = `Lernzusammenfassung (Batch)\nDatum: ${new Date().toLocaleDateString()}\n\n${joined}`.trim();
    setCombinedLetter(letter);
  };

  const exportText = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
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
        const msg = json?.error || `Request failed (${res.status})`;
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `series-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Unknown error';
      setSeriesMarkdown((prev) => `${prev}\n\n[PDF Export Error] ${msg}`.trim());
    }
  };

  const generateSeries = async () => {
    if (isSeriesRunning) return;
    setIsSeriesRunning(true);
    try {
      const currentDone = itemsRef.current.filter((i) => i.status === 'done');
      const chapters = currentDone.map((i) => ({
        videoId: i.videoId,
        fileName: i.file.name,
        transcriptText: i.transcript,
        chapterTitle: i.chapterTitle,
        chapterMarkdown: i.chapterMarkdown || i.summary || '',
      }));

      if (chapters.length === 0) {
        throw new Error('No chapters provided.');
      }

      const res = await fetch('/api/series-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesTitle, chapters }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      const md = json.seriesMarkdown || '';
      const report = json.guardrailReport || null;
      setSeriesMarkdown(md);
      setGuardrailReport(report);

      const missing: string[] = Array.isArray(report?.missingIds) ? report.missingIds : [];
      if (autoDownloadSeries && md && missing.length === 0) {
        exportText(`series-${new Date().toISOString().split('T')[0]}.md`, md);
      }
      if (autoDownloadPdf && md && missing.length === 0) {
        await exportPdf(md, seriesTitle);
      }
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Unknown error';
      setSeriesMarkdown(`Fehler beim Generieren der Serie: ${msg}`);
      setGuardrailReport(null);
    } finally {
      setIsSeriesRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Lecture Batch Summarizer</h1>
          <p className="text-gray-600">MP4 Batch Upload → Transkript → perfekte Lern-Zusammenfassung</p>
        </header>

        <div className="mb-6 bg-white rounded-lg shadow-lg p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-700">
              <span className="font-semibold">Status:</span>{' '}
              {items.length === 0 ? 'keine Dateien' : `${items.length} Dateien`}
              {items.length > 0 && (
                <span>
                  {' '}· fertig: <span className="font-semibold">{doneItems.length}</span>
                  {' '}· queued: <span className="font-semibold">{queuedCount}</span>
                  {' '}· läuft: <span className="font-semibold">{uploadingCount}</span>
                  {' '}· Fehler: <span className="font-semibold">{errorCount}</span>
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              Tipp: Erst <span className="font-semibold">Batch verarbeiten</span>, dann <span className="font-semibold">Server-Output + Guardrails</span>.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-1 text-gray-800">1) Upload & Verarbeitung</h2>
            <p className="text-sm text-gray-600 mb-4">Wähle alle Videos der Serie aus und starte danach die Verarbeitung.</p>

            <div className="space-y-4">
              <input
                value={seriesTitle}
                onChange={(e) => setSeriesTitle(e.target.value)}
                placeholder="Serientitel (optional)"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
              />

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={autoGenerateSeries}
                  onChange={(e) => setAutoGenerateSeries(e.target.checked)}
                  className="h-4 w-4"
                />
                Serie nach Batch automatisch generieren
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={autoStartBatch}
                  onChange={(e) => setAutoStartBatch(e.target.checked)}
                  disabled={isBatchRunning}
                  className="h-4 w-4 disabled:opacity-50"
                />
                Batch nach Dateiauswahl automatisch starten
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={autoDownloadSeries}
                  onChange={(e) => setAutoDownloadSeries(e.target.checked)}
                  className="h-4 w-4"
                />
                Finale Serie automatisch herunterladen (nur wenn Guardrails OK)
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={autoDownloadPdf}
                  onChange={(e) => setAutoDownloadPdf(e.target.checked)}
                  className="h-4 w-4"
                />
                Finale PDF automatisch herunterladen (nur wenn Guardrails OK)
              </label>

              <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
                <span>Parallelität (gleichzeitig verarbeiten)</span>
                <select
                  value={parallelism}
                  onChange={(e) => setParallelism(Number(e.target.value))}
                  disabled={isBatchRunning}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value={1}>1 (stabil)</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4 (schnell)</option>
                </select>
              </label>
              <input
                type="file"
                accept="video/mp4"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
              />

              <div className="flex gap-3">
                <button
                  onClick={runBatch}
                  disabled={items.length === 0 || isBatchRunning}
                  className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {isBatchRunning ? 'Batch läuft…' : 'Batch verarbeiten'}
                </button>
                <button
                  onClick={generateSeries}
                  disabled={doneItems.length === 0 || isBatchRunning || isSeriesRunning || uploadingCount > 0}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {isSeriesRunning ? 'Serie wird gebaut…' : 'Serie generieren'}
                </button>
                <button
                  onClick={() => setItems([])}
                  disabled={items.length === 0 || isBatchRunning}
                  className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Liste leeren
                </button>
              </div>

              <div className="text-sm text-gray-600">
                Hinweis: Server benötigt <span className="font-semibold">ffmpeg</span> und <span className="font-semibold">OPENAI_API_KEY</span>.
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-1 text-gray-800">2) Kapitel pro Video</h2>
            <p className="text-sm text-gray-600 mb-4">Nach der Verarbeitung hat jedes Video ein Kapitel im Lernlayout.</p>
            <div className="max-h-96 overflow-y-auto space-y-3">
              {items.length === 0 ? (
                <p className="text-gray-500 italic">Noch keine Dateien ausgewählt.</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 truncate">[{item.videoId}] {item.chapterTitle || item.file.name}</div>
                        <div className="text-xs text-gray-500">{Math.round(item.file.size / 1024 / 1024 * 10) / 10} MB</div>
                      </div>
                      <div className="shrink-0">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            item.status === 'queued'
                              ? 'bg-gray-200 text-gray-700'
                              : item.status === 'uploading'
                                ? 'bg-indigo-100 text-indigo-700'
                                : item.status === 'done'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </div>
                    {item.status === 'uploading' && (
                      <div className="mt-2 text-xs text-indigo-700">Transkribieren & Kapitel erstellen…</div>
                    )}
                    {item.error && <div className="mt-2 text-sm text-red-700">{item.error}</div>}
                    {item.status === 'done' && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => exportText(`${item.file.name}.transcript.txt`, item.transcript || '')}
                          className="px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Export Transcript
                        </button>
                        <button
                          onClick={() => exportText(`${item.file.name}.chapter.md`, item.chapterMarkdown || item.summary || '')}
                          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Export Kapitel
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-gray-800">3) Serien-Ausgabe</h2>
            <div className="space-x-3">
              <button
                onClick={generateCombinedLetter}
                disabled={doneItems.length === 0}
                className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Lokal zusammenfügen
              </button>
              <button
                onClick={generateSeries}
                disabled={doneItems.length === 0 || isSeriesRunning}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isSeriesRunning ? 'Server baut…' : 'Server-Output + Guardrails'}
              </button>
              {seriesMarkdown && (
                <button
                  onClick={() => exportText(`series-${new Date().toISOString().split('T')[0]}.md`, seriesMarkdown)}
                  className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                >
                  Export Serie
                </button>
              )}
              {seriesMarkdown && (
                <button
                  onClick={() => exportPdf(seriesMarkdown, seriesTitle)}
                  className="px-6 py-3 bg-gray-900 hover:bg-black text-white rounded-lg font-medium transition-colors"
                >
                  Export PDF
                </button>
              )}
              {guardrailReport && (
                <button
                  onClick={() => exportText(`series-guardrails-${new Date().toISOString().split('T')[0]}.json`, JSON.stringify(guardrailReport, null, 2))}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors"
                >
                  Export Guardrails
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => setActiveOutput('series')}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                activeOutput === 'series' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Serie (Markdown)
            </button>
            <button
              onClick={() => setActiveOutput('guardrails')}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                activeOutput === 'guardrails' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Guardrails (JSON)
            </button>
            <button
              onClick={() => setActiveOutput('local')}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                activeOutput === 'local' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Lokal (Fallback)
            </button>
          </div>

          {activeOutput === 'series' && (
            <div>
              {guardrailReport && Array.isArray(guardrailReport?.missingIds) && (
                <div
                  className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                    guardrailReport.missingIds.length === 0
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-900 border border-amber-200'
                  }`}
                >
                  {guardrailReport.missingIds.length === 0
                    ? 'Guardrails OK: alle Videos wurden berücksichtigt.'
                    : `Achtung: Es fehlen Videos in der Serie: ${guardrailReport.missingIds.join(', ')}`}
                </div>
              )}
              <textarea
                value={seriesMarkdown}
                onChange={(e) => setSeriesMarkdown(e.target.value)}
                className="w-full h-[28rem] p-4 border border-gray-300 rounded-lg font-mono text-sm"
                placeholder="Hier erscheint die serverseitig sortierte Serie inkl. Evidence/Guardrails..."
              />
            </div>
          )}

          {activeOutput === 'guardrails' && (
            <div>
              <textarea
                value={guardrailReport ? JSON.stringify(guardrailReport, null, 2) : ''}
                readOnly
                className="w-full h-[28rem] p-4 border border-gray-300 rounded-lg font-mono text-sm bg-gray-50"
                placeholder="Guardrail-Report (JSON) erscheint hier..."
              />
            </div>
          )}

          {activeOutput === 'local' && (
            <div>
              {combinedLetter ? (
                <textarea
                  value={combinedLetter}
                  onChange={(e) => setCombinedLetter(e.target.value)}
                  className="w-full h-[28rem] p-4 border border-gray-300 rounded-lg font-mono text-sm"
                  placeholder="Lokale Zusammenfügung erscheint hier..."
                />
              ) : (
                <div className="h-[28rem] p-4 border border-gray-300 rounded-lg bg-gray-50 flex items-center justify-center">
                  <p className="text-gray-500 italic">Optional: lokal zusammenfügen (ohne Sortierung/Guardrails).</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
