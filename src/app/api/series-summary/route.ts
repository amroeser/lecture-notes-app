import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { readJsonCache, sha256Hex, writeJsonCache } from '../_utils/fsCache';

export const runtime = 'nodejs';

type ChapterInput = {
  videoId: string;
  fileName: string;
  transcriptText?: string;
  chapterTitle?: string;
  chapterMarkdown: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function isPermutation(order: string[], all: string[]) {
  const a = uniq(order);
  const b = uniq(all);
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) {
    if (!set.has(id)) return false;
  }
  return true;
}

function vidMarker(videoId: string) {
  return `<!--VID:${videoId}-->`;
}

function hasVidMarker(text: string, videoId: string) {
  return text.includes(vidMarker(videoId));
}

function hasChapterHeading(md: string, videoId: string) {
  const marker = vidMarker(videoId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^#\\s+.*${marker}\\s*$`, 'm');
  return re.test(md);
}

function stripEvidenceSections(md: string) {
  const lines = md.split('\n');
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (/^##\s*Evidence\b/i.test(line)) {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (/^#\s+/.test(line) || /^##\s+/.test(line)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }

    out.push(line);
  }

  return out.join('\n').trim();
}

function insertPageBreaksBetweenChapters(md: string) {
  // Ensure each chapter (H1 that includes a VID marker) starts on a new page
  const lines = md.split('\n');
  const out: string[] = [];
  let seenFirstChapter = false;

  for (const line of lines) {
    const isChapter = /^#\s+.*<!--VID:V\d{2}-->\s*$/m.test(line);
    if (isChapter) {
      if (seenFirstChapter) {
        out.push('');
        out.push('<div class="page-break"></div>');
        out.push('');
      }
      seenFirstChapter = true;
    }
    out.push(line);
  }

  return out.join('\n').trim();
}

function maxSeriesCompileChars() {
  const raw = process.env.MAX_SERIES_COMPILE_CHARS;
  const n = raw ? Number(raw) : 60000;
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

function seriesChunkSize() {
  const raw = process.env.SERIES_CHUNK_SIZE;
  const n = raw ? Number(raw) : 4;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function ensureTaggedHeader(md: string, videoId: string) {
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      const marker = vidMarker(videoId);
      if (!lines[i].includes(marker)) {
        lines[i] = `${lines[i]} ${marker}`;
      }
      break;
    }
  }
  return lines.join('\n');
}

function hasEvidence(md: string) {
  const evidenceHeader = /^##\s*Evidence\b/m;
  if (!evidenceHeader.test(md)) return false;
  const after = md.split(/##\s*Evidence\b/i)[1] || '';
  return /-\s*".+"/.test(after);
}

function extractTitle(md: string) {
  const m = md.match(/^#\s*Kapitel:\s*(.+)\s*(?:\[[^\]]+\])?\s*$/m);
  return m?.[1]?.trim();
}

function withOptionalTemperature(req: any, model: string, temperature: number) {
  if (!/^gpt-5/i.test(model)) {
    req.temperature = temperature;
  }
  return req;
}

async function orderChapters(client: OpenAI, model: string, chapters: ChapterInput[]) {
  const items = chapters.map((c) => ({
    videoId: c.videoId,
    fileName: c.fileName,
    chapterTitle: c.chapterTitle || extractTitle(c.chapterMarkdown) || c.fileName,
  }));

  const req: any = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Du sortierst Kapitel einer Vorlesungsserie nach Lernprogression (Grundlagen → fortgeschritten). Gib ausschließlich gültiges JSON zurück.',
      },
      {
        role: 'user',
        content:
          `Hier sind Kapitel (videoId, title). Sortiere sie in die beste Lernreihenfolge. Antworte als JSON der Form {"order":["V01","V02",...]}.\n\n${JSON.stringify(items, null, 2)}`,
      },
    ],
  };

  const temperature = Number(process.env.OPENAI_TEMPERATURE ?? '0.2');
  const resp = await client.chat.completions.create(withOptionalTemperature(req, model, temperature));

  const content = resp.choices[0]?.message?.content ?? '';
  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  const slice = jsonStart >= 0 && jsonEnd >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;

  let parsed: any;
  try {
    parsed = JSON.parse(slice);
  } catch {
    parsed = null;
  }

  const order = Array.isArray(parsed?.order) ? parsed.order.map(String) : [];
  return { order, items };
}

function buildBaseMarkdown(seriesTitle: string, ordered: ChapterInput[]) {
  const toc = ordered
    .map((c, idx) => {
      const title = c.chapterTitle || extractTitle(c.chapterMarkdown) || c.fileName;
      return `- ${idx + 1}. ${title} ${vidMarker(c.videoId)}`;
    })
    .join('\n');

  const sep = `\n\n<div class="page-break"></div>\n\n---\n\n`;
  const chaptersText = ordered
    .map((c) => {
      const tagged = ensureTaggedHeader(c.chapterMarkdown, c.videoId);
      return tagged;
    })
    .join(sep);

  return `# ${seriesTitle || 'Vorlesungsserie – Lernskript'}\n\n## Inhaltsverzeichnis\n${toc}\n${chaptersText}`.trim();
}

async function compileSeries(client: OpenAI, model: string, seriesTitle: string, ordered: ChapterInput[]) {
  const baseMarkdown = buildBaseMarkdown(seriesTitle, ordered);

  const req: any = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Du bist ein Lernassistent. Du bekommst ein Serien-Lernskript als Markdown. Aufgabe: Glätte Sprache, entferne Dopplungen, verbessere Struktur und Lernfluss. Entferne keine Kapitel. Jedes Kapitel muss als eigener Abschnitt mit einer Überschrift der Form "# ... <!--VID:Vxx-->" enthalten bleiben. Die Marker <!--VID:Vxx--> sind Pflicht und dürfen nicht geändert/entfernt werden. Antworte ausschließlich mit dem finalen Markdown.',
      },
      {
        role: 'user',
        content: baseMarkdown,
      },
    ],
  };

  const temperature = Number(process.env.OPENAI_TEMPERATURE ?? '0.2');
  const resp = await client.chat.completions.create(withOptionalTemperature(req, model, temperature));

  const seriesMarkdown = resp.choices[0]?.message?.content ?? baseMarkdown;
  return { seriesMarkdown, baseMarkdown };
}

async function reduceChunksToFinal(
  client: OpenAI,
  finalModel: string,
  seriesTitle: string,
  chunkMarkdowns: string[],
  requiredVideoIds: string[],
) {
  const joined = chunkMarkdowns
    .map((c, i) => `\n\n---\n\n# Chunk ${i + 1}\n\n${c}`)
    .join('')
    .trim();

  const req: any = {
    model: finalModel,
    messages: [
      {
        role: 'system',
        content:
          'Du kombinierst mehrere Markdown-Teile zu einem einzigen finalen Lernskript. Entferne keine Kapitel. Jede Kapitel-Überschrift muss die Form "# ... <!--VID:Vxx-->" behalten. Sorge für ein einziges Inhaltsverzeichnis am Anfang. Füge zwischen Kapiteln einen Seitenumbruch ein: <div class="page-break"></div>. Antworte ausschließlich mit Markdown.',
      },
      {
        role: 'user',
        content:
          `Serientitel: ${seriesTitle || 'Vorlesungsserie – Lernskript'}\n\nErwartete Video-IDs: ${requiredVideoIds.join(', ')}\n\nHier sind die Chunk-Markdowns:\n\n${joined}`,
      },
    ],
  };

  const temperature = Number(process.env.OPENAI_TEMPERATURE ?? '0.2');
  const resp = await client.chat.completions.create(withOptionalTemperature(req, finalModel, temperature));
  return resp.choices[0]?.message?.content ?? '';
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY in environment.' }, { status: 500 });
  }

  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const textApiKey = process.env.OPENAI_TEXT_API_KEY || apiKey;
  const textBaseURL = process.env.OPENAI_TEXT_BASE_URL || baseURL;

  const seriesModel = process.env.OPENAI_SERIES_MODEL || process.env.OPENAI_SUMMARY_MODEL || 'gpt-5.1-mini';
  const seriesFinalModel = process.env.OPENAI_SERIES_FINAL_MODEL || seriesModel;

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON body.' }, { status: 400 });
  }

  const seriesTitle = typeof payload?.seriesTitle === 'string' ? payload.seriesTitle : '';
  const chapters = Array.isArray(payload?.chapters) ? (payload.chapters as ChapterInput[]) : [];

  if (chapters.length === 0) {
    return NextResponse.json({ error: 'No chapters provided.' }, { status: 400 });
  }

  const allIds = chapters.map((c) => String(c.videoId));
  const uniqueIds = uniq(allIds);
  if (uniqueIds.length !== chapters.length) {
    return NextResponse.json({ error: 'videoId must be unique per chapter.' }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: textApiKey, baseURL: textBaseURL });

  try {
    const fallbackOrder: string[] = chapters.map((c) => String(c.videoId));
    let finalOrder: string[] = fallbackOrder;

    if (chapters.length > 1) {
      const { order } = await orderChapters(client, seriesModel, chapters);
      finalOrder = isPermutation(order, fallbackOrder) ? order : fallbackOrder;
    }

    const orderedChapters: ChapterInput[] = finalOrder.map((id: string) => {
      const found = chapters.find((c) => c.videoId === id);
      return found as ChapterInput;
    });

    for (const c of orderedChapters) {
      c.chapterTitle = c.chapterTitle || extractTitle(c.chapterMarkdown) || c.fileName;
      c.chapterMarkdown = ensureTaggedHeader(c.chapterMarkdown, c.videoId);
    }

    const baseMarkdown = buildBaseMarkdown(seriesTitle, orderedChapters);
    const promptVersion = 'series-v4-mapreduce';
    const chunkSize = seriesChunkSize();
    const chapterHashes = orderedChapters.map((c) => ({
      videoId: c.videoId,
      chapterHash: sha256Hex(c.chapterMarkdown || ''),
    }));
    const seriesCacheKey = sha256Hex(
      JSON.stringify({
        seriesTitle,
        chapterHashes,
        seriesModel,
        seriesFinalModel,
        chunkSize,
        promptVersion,
      }),
    );

    const cached = await readJsonCache<any>('series-summary', seriesCacheKey);
    if (cached?.seriesMarkdown && cached?.guardrailReport) {
      return NextResponse.json({
        orderedChapters: orderedChapters.map((c) => ({
          videoId: c.videoId,
          fileName: c.fileName,
          chapterTitle: c.chapterTitle,
        })),
        seriesMarkdown: cached.seriesMarkdown,
        guardrailReport: cached.guardrailReport,
        cached: true,
      });
    }

    const compileLimit = maxSeriesCompileChars();
    const shouldSkipLLMCompile = baseMarkdown.length > compileLimit;

    let seriesMarkdown = baseMarkdown;
    let usedSizeFallback = false;
    let usedMapReduce = false;

    if (shouldSkipLLMCompile) {
      usedSizeFallback = true;
    } else {
      const chunks = chunkArray(orderedChapters, chunkSize);
      if (chunks.length <= 1) {
        ({ seriesMarkdown } = await compileSeries(client, seriesModel, seriesTitle, orderedChapters));
      } else {
        usedMapReduce = true;
        const compiledChunks: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkTitle = `${seriesTitle || 'Vorlesungsserie – Lernskript'} (Teil ${i + 1}/${chunks.length})`;
          const { seriesMarkdown: chunkMd } = await compileSeries(client, seriesModel, chunkTitle, chunks[i]);
          compiledChunks.push(chunkMd);
        }

        const reduced = await reduceChunksToFinal(
          client,
          seriesFinalModel,
          seriesTitle,
          compiledChunks,
          uniqueIds,
        );
        seriesMarkdown = reduced || compiledChunks.join('\n\n');
      }
    }

    seriesMarkdown = insertPageBreaksBetweenChapters(seriesMarkdown);

    const missingIds = uniqueIds.filter((id: string) => !hasChapterHeading(seriesMarkdown, id));

    if (!usedSizeFallback && missingIds.length > 0) {
      const req: any = {
        model: seriesModel,
        messages: [
          {
            role: 'system',
            content:
              'Du reparierst ein Markdown-Lernskript. Stelle sicher, dass jedes geforderte Kapitel als eigener Abschnitt mit einer Überschrift der Form "# ... <!--VID:Vxx-->" vorkommt. Entferne keine Kapitel. Die Marker <!--VID:Vxx--> sind Pflicht und dürfen nicht geändert/entfernt werden. Antworte ausschließlich mit Markdown.',
          },
          {
            role: 'user',
            content: `Fehlende Kapitel-IDs (als Kapitel-Überschrift mit Marker erforderlich): ${missingIds.join(', ')}\n\nDu bekommst zusätzlich die vollständige Basis-Version (enthält alle Kapitel, aber evtl. ohne perfekte Evidence). Nutze sie als Referenz und gib das reparierte finale Markdown zurück.\n\n---\n\nBASIS:\n\n${baseMarkdown}\n\n---\n\nAKTUELL:\n\n${seriesMarkdown}`,
          },
        ],
      };
      const temperature = Number(process.env.OPENAI_TEMPERATURE ?? '0.2');
      const repair = await client.chat.completions.create(withOptionalTemperature(req, seriesModel, temperature));
      seriesMarkdown = repair.choices[0]?.message?.content ?? seriesMarkdown;
    }

    const finalMissingIds = uniqueIds.filter((id: string) => !hasChapterHeading(seriesMarkdown, id));

    if (finalMissingIds.length > 0) {
      seriesMarkdown = baseMarkdown;
      usedSizeFallback = true;
    }

    const publicSeriesMarkdown = stripEvidenceSections(seriesMarkdown);

    const guardrailReport = {
      inputCount: chapters.length,
      orderedCount: orderedChapters.length,
      order: orderedChapters.map((c) => c.videoId),
      missingIds: finalMissingIds,
      usedSizeFallback,
      usedMapReduce,
      baseMarkdownChars: baseMarkdown.length,
      maxCompileChars: compileLimit,
      chunkSize,
      seriesModel,
      seriesFinalModel,
      perChapter: orderedChapters.map((c) => ({
        videoId: c.videoId,
        chapterTitle: c.chapterTitle,
        evidencePresentInChapterMarkdown: hasEvidence(c.chapterMarkdown),
        referencedInSeriesMarkdown: hasChapterHeading(seriesMarkdown, c.videoId),
      })),
    };

    await writeJsonCache('series-summary', seriesCacheKey, {
      seriesMarkdown: publicSeriesMarkdown,
      guardrailReport,
      createdAt: new Date().toISOString(),
      promptVersion,
    });

    return NextResponse.json({
      orderedChapters: orderedChapters.map((c) => ({
        videoId: c.videoId,
        fileName: c.fileName,
        chapterTitle: c.chapterTitle,
      })),
      seriesMarkdown: publicSeriesMarkdown,
      guardrailReport,
    });
  } catch (err: any) {
    const message = typeof err?.message === 'string' ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
