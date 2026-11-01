/**
 * File-based course library. One folder per course under `<LBS_DATA_DIR>/library/<courseId>/`
 * holding a single `course.json`. Writes are atomic (temp file + rename) and serialized per course,
 * because parallel batch workers save lecture results at the same time.
 */
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  COURSE_ID_RE,
  COURSE_SCHEMA_VERSION,
  MAX_TITLE_LENGTH,
  VIDEO_ID_RE,
  videoNumber,
  type Course,
  type CourseSummary,
  type GuardrailReport,
  type StoredLecture,
} from './types';

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500,
  ) {
    super(message);
  }
}

export function getDataDir() {
  return process.env.LBS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), '.data');
}

function libraryDir() {
  return path.join(getDataDir(), 'library');
}

export function assertCourseId(id: string) {
  if (!COURSE_ID_RE.test(id)) throw new LibraryError('Invalid course id.', 400);
}

function courseDir(id: string) {
  assertCourseId(id);
  return path.join(libraryDir(), id);
}

function courseFile(id: string) {
  return path.join(courseDir(id), 'course.json');
}

export function normalizeTitle(raw: unknown) {
  if (typeof raw !== 'string') throw new LibraryError('Title must be a string.', 400);
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title) throw new LibraryError('Title must not be empty.', 400);
  if (title.length > MAX_TITLE_LENGTH) throw new LibraryError(`Title must be at most ${MAX_TITLE_LENGTH} characters.`, 400);
  return title;
}

/* ---------- Per-course write queue ---------- */

const queues = new Map<string, Promise<unknown>>();

function withCourseLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
}

/* ---------- Read / write ---------- */

async function writeAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

function isCourse(v: unknown): v is Course {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<Course>;
  return typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.lectures);
}

async function readCourse(id: string): Promise<Course> {
  let raw: string;
  try {
    raw = await fs.readFile(courseFile(id), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('Course not found.', 404);
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LibraryError('Course file is corrupt.', 500);
  }
  if (!isCourse(parsed)) throw new LibraryError('Course file is corrupt.', 500);
  return {
    ...parsed,
    schemaVersion: parsed.schemaVersion ?? COURSE_SCHEMA_VERSION,
    seriesMarkdown: parsed.seriesMarkdown ?? '',
    guardrailReport: parsed.guardrailReport ?? null,
  };
}

function summarize(c: Course): CourseSummary {
  const missing = c.guardrailReport?.missingIds;
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lectureCount: c.lectures.length,
    doneCount: c.lectures.filter((l) => l.status === 'done').length,
    errorCount: c.lectures.filter((l) => l.status === 'error').length,
    hasSeries: c.seriesMarkdown.trim().length > 0,
    guardrailsOk: Array.isArray(missing) ? missing.length === 0 : null,
  };
}

/* ---------- Public API ---------- */

export async function listCourses(): Promise<CourseSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(libraryDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const courses = await Promise.all(
    entries
      .filter((name) => COURSE_ID_RE.test(name))
      .map((id) => readCourse(id).then(summarize).catch(() => null)),
  );
  return courses
    .filter((c): c is CourseSummary => c !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCourse(id: string) {
  assertCourseId(id);
  return readCourse(id);
}

export async function createCourse(rawTitle: unknown): Promise<Course> {
  const title = normalizeTitle(rawTitle);
  const now = new Date().toISOString();
  const course: Course = {
    schemaVersion: COURSE_SCHEMA_VERSION,
    id: randomBytes(9).toString('base64url'),
    title,
    createdAt: now,
    updatedAt: now,
    lectures: [],
    seriesMarkdown: '',
    guardrailReport: null,
  };
  await withCourseLock(course.id, () => writeAtomic(courseFile(course.id), course));
  return course;
}

async function update(id: string, fn: (c: Course) => Course | void): Promise<Course> {
  assertCourseId(id);
  return withCourseLock(id, async () => {
    const current = await readCourse(id);
    const next = fn(current) ?? current;
    next.updatedAt = new Date().toISOString();
    await writeAtomic(courseFile(id), next);
    return next;
  });
}

export function renameCourse(id: string, rawTitle: unknown) {
  const title = normalizeTitle(rawTitle);
  return update(id, (c) => {
    c.title = title;
  });
}

export async function deleteCourse(id: string) {
  assertCourseId(id);
  await withCourseLock(id, async () => {
    await readCourse(id); // 404 when missing
    await fs.rm(courseDir(id), { recursive: true, force: true });
  });
}

const optionalString = (v: unknown, field: string, max = 2_000_000) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new LibraryError(`${field} must be a string.`, 400);
  if (v.length > max) throw new LibraryError(`${field} is too long.`, 400);
  return v;
};

export function parseLecture(videoId: string, body: unknown): StoredLecture {
  if (!VIDEO_ID_RE.test(videoId)) throw new LibraryError('Invalid videoId.', 400);
  if (!body || typeof body !== 'object') throw new LibraryError('Expected a JSON object.', 400);
  const b = body as Record<string, unknown>;
  const fileName = optionalString(b.fileName, 'fileName', 500);
  if (!fileName) throw new LibraryError('fileName is required.', 400);
  if (b.status !== 'done' && b.status !== 'error') throw new LibraryError('status must be "done" or "error".', 400);
  const sizeBytes = typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) && b.sizeBytes >= 0 ? b.sizeBytes : 0;
  return {
    videoId,
    fileName,
    sizeBytes,
    status: b.status,
    chapterTitle: optionalString(b.chapterTitle, 'chapterTitle', 1_000),
    chapterMarkdown: optionalString(b.chapterMarkdown, 'chapterMarkdown'),
    transcript: optionalString(b.transcript, 'transcript'),
    error: optionalString(b.error, 'error', 5_000),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertLecture(id: string, lecture: StoredLecture) {
  return update(id, (c) => {
    const idx = c.lectures.findIndex((l) => l.videoId === lecture.videoId);
    if (idx >= 0) c.lectures[idx] = lecture;
    else c.lectures.push(lecture);
    c.lectures.sort((a, b) => videoNumber(a.videoId) - videoNumber(b.videoId));
  });
}

export function parseSeries(body: unknown): { seriesMarkdown: string; guardrailReport: GuardrailReport | null } {
  if (!body || typeof body !== 'object') throw new LibraryError('Expected a JSON object.', 400);
  const b = body as Record<string, unknown>;
  const seriesMarkdown = optionalString(b.seriesMarkdown, 'seriesMarkdown', 20_000_000) ?? '';
  const report = b.guardrailReport;
  if (report !== undefined && report !== null && (typeof report !== 'object' || Array.isArray(report))) {
    throw new LibraryError('guardrailReport must be an object or null.', 400);
  }
  return { seriesMarkdown, guardrailReport: (report as GuardrailReport | null | undefined) ?? null };
}

export function saveSeries(id: string, series: { seriesMarkdown: string; guardrailReport: GuardrailReport | null }) {
  return update(id, (c) => {
    c.seriesMarkdown = series.seriesMarkdown;
    c.guardrailReport = series.guardrailReport;
  });
}

/** Maps any thrown error to a JSON response body + status for the API routes. */
export function errorResponse(e: unknown) {
  if (e instanceof LibraryError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
  console.error('[library]', e);
  return Response.json({ error: 'Library error.' }, { status: 500 });
}
