import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export function sha256Hex(data: Buffer | string) {
  const h = createHash('sha256');
  h.update(data);
  return h.digest('hex');
}

export function getCacheDir() {
  return process.env.CACHE_DIR || path.join(process.cwd(), '.cache', 'lecture-notes-app');
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function safeKey(key: string) {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function readJsonCache<T>(namespace: string, key: string): Promise<T | null> {
  const dir = path.join(getCacheDir(), namespace);
  const filePath = path.join(dir, `${safeKey(key)}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonCache(namespace: string, key: string, value: unknown): Promise<void> {
  const dir = path.join(getCacheDir(), namespace);
  await ensureDir(dir);
  const filePath = path.join(dir, `${safeKey(key)}.json`);
  await fs.writeFile(filePath, JSON.stringify(value), 'utf8');
}
