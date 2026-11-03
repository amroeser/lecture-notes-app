/** Shared library types: used by the API routes (server) and the UI (client). No Node imports here. */

export const COURSE_SCHEMA_VERSION = 1;

export type LectureStatus = 'done' | 'error';

export interface StoredLecture {
  videoId: string;
  fileName: string;
  sizeBytes: number;
  status: LectureStatus;
  chapterTitle?: string;
  chapterMarkdown?: string;
  transcript?: string;
  error?: string;
  updatedAt: string;
}

export interface GuardrailReport {
  missingIds?: string[];
  inputCount?: number;
  order?: string[];
  [key: string]: unknown;
}

export interface Course {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lectures: StoredLecture[];
  seriesMarkdown: string;
  guardrailReport: GuardrailReport | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lectureCount: number;
  doneCount: number;
  errorCount: number;
  hasSeries: boolean;
  /** null when no guardrail report exists yet. */
  guardrailsOk: boolean | null;
}

export const COURSE_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
export const VIDEO_ID_RE = /^V\d{2,4}$/;
export const MAX_TITLE_LENGTH = 200;

export function videoNumber(videoId: string) {
  return Number(videoId.slice(1)) || 0;
}

export function formatVideoId(n: number) {
  return `V${String(n).padStart(2, '0')}`;
}
