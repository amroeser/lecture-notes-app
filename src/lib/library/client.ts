/** Browser-side wrappers for the /api/library routes. */
import type { Course, CourseSummary, GuardrailReport, StoredLecture } from './types';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

const base = (id: string) => `/api/library/${encodeURIComponent(id)}`;

export const library = {
  list: () => call<{ courses: CourseSummary[] }>('/api/library').then((r) => r.courses),
  create: (title: string) => call<{ course: Course }>('/api/library', { method: 'POST', body: JSON.stringify({ title }) }).then((r) => r.course),
  get: (id: string) => call<{ course: Course }>(base(id)).then((r) => r.course),
  rename: (id: string, title: string) =>
    call<{ course: Course }>(base(id), { method: 'PATCH', body: JSON.stringify({ title }) }).then((r) => r.course),
  remove: (id: string) => call<void>(base(id), { method: 'DELETE' }),
  saveLecture: (id: string, lecture: Omit<StoredLecture, 'updatedAt'>) =>
    call<{ lecture: StoredLecture }>(`${base(id)}/lectures/${encodeURIComponent(lecture.videoId)}`, {
      method: 'PUT',
      body: JSON.stringify(lecture),
    }),
  saveSeries: (id: string, seriesMarkdown: string, guardrailReport: GuardrailReport | null) =>
    call<{ updatedAt: string }>(`${base(id)}/series`, { method: 'PUT', body: JSON.stringify({ seriesMarkdown, guardrailReport }) }),
};

export function isNotFound(e: unknown) {
  return typeof e === 'object' && e !== null && (e as { status?: number }).status === 404;
}
