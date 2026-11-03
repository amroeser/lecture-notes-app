import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { readJsonCache, sha256Hex, writeJsonCache } from '../_utils/fsCache';
import { readTranscribeConfig, transcribeAudio, TranscribeConfigError, type TranscribeConfig } from '../_utils/transcribe';

export const runtime = 'nodejs';

function runFfmpegExtractAudio(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const primaryCmd = process.env.FFMPEG_PATH || 'ffmpeg';
    const fallbackCmd = '/opt/homebrew/bin/ffmpeg';

    let triedFallback = false;

    const spawnWith = (cmd: string) => {
      const proc = spawn(cmd, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err?.code === 'ENOENT') {
          if (!triedFallback && cmd !== fallbackCmd) {
            triedFallback = true;
            spawnWith(fallbackCmd);
            return;
          }
          reject(Object.assign(new Error(`ffmpeg not found (${cmd}). Install it (macOS): brew install ffmpeg`), { code: 'FFMPEG_ENOENT' }));
          return;
        }
        reject(err);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`ffmpeg exited with code ${code}. ${stderr}`));
        }
      });
    };

    spawnWith(primaryCmd);
  });
}

function sanitizeChapterMarkdown(md: string) {
  const lines = md.split('\n');
  const out = lines.map((line) => {
    let s = line;

    // Remove trailing bracketed video ids like [V01] from headings/labels
    s = s.replace(/\s*\[V\d{2}\]\s*$/, '');

    // Remove meta counters in parentheses at line end, e.g. (5-8 Sätze), (3-7), (10-25)
    s = s.replace(/\s*\(\s*\d+\s*(?:-|–)\s*\d+[^)]*\)\s*$/, '');
    s = s.replace(/\s*\(\s*\d+\s*(?:Satz|Sätze)\s*\)\s*$/, '');

    return s;
  });
  return out.join('\n').trim();
}

function extractChapterTitle(md: string) {
  const m = md.match(/^#\s*Kapitel:\s*(.+?)\s*$/m);
  return m?.[1]?.trim();
}

export async function POST(req: Request) {
  let transcribeConfig: TranscribeConfig;
  try {
    transcribeConfig = readTranscribeConfig();
  } catch (err: unknown) {
    const message = err instanceof TranscribeConfigError ? err.message : 'Invalid transcription configuration.';
    return NextResponse.json({ error: message, step: 'config' }, { status: 500 });
  }

  // Chapter generation always uses the OpenAI-compatible text client, independent of the transcription provider.
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const textApiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY;
  const textBaseURL = process.env.OPENAI_TEXT_BASE_URL || baseURL;
  if (!textApiKey) {
    return NextResponse.json(
      { error: 'Missing OPENAI_API_KEY (or OPENAI_TEXT_API_KEY) in environment for chapter generation.', step: 'config' },
      { status: 500 },
    );
  }

  const transcribeProvider = transcribeConfig.provider;
  const transcribeModel = transcribeConfig.model;
  const summaryModel = process.env.OPENAI_SUMMARY_MODEL || 'gpt-5.1-mini';
  const temperature = Number(process.env.OPENAI_TEMPERATURE ?? '0.2');

  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Expected multipart form-data with field "file".' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.mp4')) {
    return NextResponse.json({ error: 'Only .mp4 files are supported.' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = sha256Hex(bytes);
  const jobId = randomUUID();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lecture-'));

  const inputPath = path.join(tmpDir, `${jobId}.mp4`);
  const audioPath = path.join(tmpDir, `${jobId}.wav`);
  let step: 'write_input' | 'extract_audio' | 'split_audio' | 'transcribe' | 'chapter' = 'write_input';

  try {
    step = 'write_input';
    await fs.writeFile(inputPath, bytes);

    step = 'extract_audio';
    await runFfmpegExtractAudio([
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      audioPath,
    ]);

    const textClient = new OpenAI({ apiKey: textApiKey, baseURL: textBaseURL });

    const promptVersion = 'chapter-v3';
    const cacheKey = sha256Hex(
      JSON.stringify({
        fileHash,
        // Omitted for "openai" so caches written before provider selection existed stay valid.
        ...(transcribeProvider !== 'openai' && { transcribeProvider }),
        transcribeModel,
        summaryModel,
        temperature: /^gpt-5/i.test(summaryModel) ? null : temperature,
        promptVersion,
      }),
    );

    const cached = await readJsonCache<{ transcript?: string; chapterTitle?: string; chapterMarkdown?: string }>('process-lecture', cacheKey);
    if (cached?.chapterMarkdown && typeof cached?.transcript === 'string') {
      return NextResponse.json({
        fileName: file.name,
        transcript: cached.transcript,
        summary: cached.chapterMarkdown,
        chapterTitle: cached.chapterTitle || file.name,
        chapterMarkdown: cached.chapterMarkdown,
      });
    }

    step = 'transcribe';
    const transcriptText = await transcribeAudio(transcribeConfig, audioPath, {
      language: 'de',
      splitAudio: async (seconds) => {
        step = 'split_audio';
        const pattern = path.join(tmpDir, `${jobId}-part-%03d.wav`);
        await runFfmpegExtractAudio(['-y', '-i', audioPath, '-f', 'segment', '-segment_time', String(seconds), '-c', 'copy', pattern]);
        const parts = (await fs.readdir(tmpDir)).filter((f) => f.startsWith(`${jobId}-part-`) && f.endsWith('.wav')).sort();
        step = 'transcribe';
        return parts.map((f) => path.join(tmpDir, f));
      },
    });

    step = 'chapter';
    const chapterReq: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: summaryModel,
      messages: [
        {
          role: 'system',
          content:
            'Du bist ein Lernassistent. Erzeuge aus einem Vorlesungs-Transkript ein einzelnes Kapitel im perfekten Lern-Layout. Antworte ausschließlich mit Markdown.',
        },
        {
          role: 'user',
          content:
            `Transkript (kann Fehler enthalten):\n\n${transcriptText}\n\nErstelle GENAU dieses Layout (in dieser Reihenfolge). Nutze überall klare, lernorientierte Formulierungen. Wenn etwas nicht vorkommt, schreibe "(nicht erwähnt)" statt es wegzulassen.\n\nInhaltliche Vorgaben (nur als Guideline, NICHT in Überschriften schreiben):\n- Kurz-Zusammenfassung: 5-8 Sätze\n- Lernziele: 3-7 Bulletpoints\n- Unterkapitel: 3-7 Unterkapitel; je Unterkapitel 3-7 Bulletpoints + optional 1 Mini-Beispiel\n- Kernpunkte: 10-25 Bulletpoints\n- Beispiele: 2-5\n- Übungsfragen: 5-10\n\n# Kapitel: <prägnanter Titel>\n\n## Kurz-Zusammenfassung\n\n## Lernziele\n- ...\n\n## Unterkapitel\n### <Unterkapitel 1>\n- ...\n\n### <Unterkapitel 2>\n- ...\n\n## Kernpunkte\n- ...\n\n## Begriffe & Definitionen\n| Begriff | Definition |\n|---|---|\n| ... | ... |\n\n## Methoden/Formeln (falls vorhanden)\n- ...\n\n## Beispiele\n- ...\n\n## Typische Fehler/Missverständnisse\n- ...\n\n## Prüfungs-/Übungsfragen mit Antworten\n1. Frage: ...\n   Antwort: ...\n\n## Evidence (kurze Originalaussagen aus dem Transkript)\n- "..."`,
        },
      ],
    };

    if (!/^gpt-5/i.test(summaryModel)) {
      chapterReq.temperature = temperature;
    }

    const summaryResponse = await textClient.chat.completions.create(chapterReq);
    const rawChapterMarkdown = summaryResponse.choices[0]?.message?.content ?? '';
    const chapterMarkdown = sanitizeChapterMarkdown(rawChapterMarkdown);
    const chapterTitle = extractChapterTitle(chapterMarkdown) || file.name;

    await writeJsonCache('process-lecture', cacheKey, {
      transcript: transcriptText,
      chapterTitle,
      chapterMarkdown,
      fileName: file.name,
      fileHash,
      transcribeProvider,
      transcribeModel,
      summaryModel,
      promptVersion,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      fileName: file.name,
      transcript: transcriptText,
      summary: chapterMarkdown,
      chapterTitle,
      chapterMarkdown,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[process-lecture] error', { step, message, err });
    return NextResponse.json({ error: message, step }, { status: 500 });
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
