import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import OpenAI from 'openai';

export type TranscribeProvider = 'openai' | 'mistral';

export type TranscribeConfig =
  | { provider: 'openai'; model: string; apiKey: string; baseURL?: string }
  | { provider: 'mistral'; model: string; apiKey: string; baseURL: string; chunkSeconds: number };

export class TranscribeConfigError extends Error {}

/**
 * Mistral Voxtral (https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files):
 * `POST /v1/audio/transcriptions`, multipart with `model`, `file`, optional `language`.
 * The request value documented there is `voxtral-small-transcribe-3`.
 */
export const DEFAULT_MISTRAL_MODEL = 'voxtral-small-transcribe-3';
export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
/**
 * Mistral documents a 65,536-token context per request and, on its known-limitations page,
 * a 60-minute maximum audio duration. Lectures are cut into 30-minute segments to stay well below both.
 */
export const DEFAULT_MISTRAL_CHUNK_SECONDS = 1800;

export function readTranscribeConfig(env: NodeJS.ProcessEnv = process.env): TranscribeConfig {
  const raw = (env.TRANSCRIBE_PROVIDER || 'openai').trim().toLowerCase();

  if (raw === 'mistral') {
    const apiKey = env.MISTRAL_API_KEY;
    if (!apiKey) throw new TranscribeConfigError('Missing MISTRAL_API_KEY in environment (TRANSCRIBE_PROVIDER=mistral).');
    const chunk = Number(env.MISTRAL_TRANSCRIBE_CHUNK_SECONDS || DEFAULT_MISTRAL_CHUNK_SECONDS);
    return {
      provider: 'mistral',
      apiKey,
      baseURL: (env.MISTRAL_BASE_URL || DEFAULT_MISTRAL_BASE_URL).replace(/\/+$/, ''),
      model: env.MISTRAL_TRANSCRIBE_MODEL || DEFAULT_MISTRAL_MODEL,
      chunkSeconds: Number.isFinite(chunk) && chunk >= 60 ? Math.floor(chunk) : DEFAULT_MISTRAL_CHUNK_SECONDS,
    };
  }

  if (raw === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new TranscribeConfigError('Missing OPENAI_API_KEY in environment.');
    return {
      provider: 'openai',
      apiKey,
      baseURL: env.OPENAI_BASE_URL || undefined,
      model: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
    };
  }

  throw new TranscribeConfigError(`Unknown TRANSCRIBE_PROVIDER "${raw}". Use "openai" or "mistral".`);
}

type MistralTranscriptionResponse = { text?: unknown };

async function transcribeWithMistral(
  cfg: Extract<TranscribeConfig, { provider: 'mistral' }>,
  audioPath: string,
  language: string,
): Promise<string> {
  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.append('model', cfg.model);
  form.append('language', language);
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), path.basename(audioPath));

  const res = await fetch(`${cfg.baseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`Mistral transcription failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const json = (await res.json()) as MistralTranscriptionResponse;
  if (typeof json.text !== 'string') throw new Error('Mistral transcription response has no "text" field.');
  return json.text.trim();
}

/**
 * Transcribe a mono 16 kHz WAV.
 * `splitAudio` cuts the file into segments of at most `seconds` and returns their paths in order.
 */
export async function transcribeAudio(
  cfg: TranscribeConfig,
  audioPath: string,
  opts: { language: string; splitAudio: (seconds: number) => Promise<string[]> },
): Promise<string> {
  if (cfg.provider === 'openai') {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: cfg.model,
      language: opts.language,
    });
    return transcription.text ?? '';
  }

  const segments = await opts.splitAudio(cfg.chunkSeconds);
  const parts: string[] = [];
  // Sequential on purpose: segments of one lecture share the workspace rate limit with other lectures in the batch.
  for (const segment of segments) {
    parts.push(await transcribeWithMistral(cfg, segment, opts.language));
  }
  return parts.filter(Boolean).join('\n\n');
}
