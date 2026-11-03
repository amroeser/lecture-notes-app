import type { Page, Route } from '@playwright/test';

/**
 * Fixture data for a fictional lecture series. The OpenAI-backed API routes are
 * mocked in the browser, so tests and README captures never call a paid API.
 */

export const lectures = [
  {
    file: 'statistik-01-deskriptive-statistik.mp4',
    title: 'Deskriptive Statistik',
    markdown: `# Kapitel: Deskriptive Statistik

## Kurz-Zusammenfassung
Die Vorlesung führt in die Beschreibung von Daten ein. Lage- und Streuungsmaße fassen Verteilungen in wenigen Kennzahlen zusammen. Der Median ist robuster gegenüber Ausreißern als das arithmetische Mittel.

## Lernziele
- Lagemaße berechnen und interpretieren
- Streuungsmaße unterscheiden
- Boxplots lesen

## Kernpunkte
- Mittelwert: Summe aller Werte geteilt durch ihre Anzahl
- Median: teilt die sortierten Daten in zwei gleich große Hälften
- Standardabweichung: typische Abweichung vom Mittelwert

## Begriffe & Definitionen
| Begriff | Definition |
|---|---|
| Median | Mittlerer Wert der sortierten Stichprobe |
| Varianz | Mittlere quadratische Abweichung vom Mittelwert |
| Quartil | Teilt die Daten in vier gleich große Teile |

## Prüfungs-/Übungsfragen mit Antworten
1. Frage: Warum ist der Median robust?
   Antwort: Extreme Werte verschieben ihn kaum.`,
  },
  {
    file: 'statistik-02-wahrscheinlichkeit.mp4',
    title: 'Grundlagen der Wahrscheinlichkeitsrechnung',
    markdown: `# Kapitel: Grundlagen der Wahrscheinlichkeitsrechnung

## Kurz-Zusammenfassung
Zufallsexperimente, Ereignisse und die Axiome von Kolmogorow bilden das Fundament. Bedingte Wahrscheinlichkeiten und der Satz von Bayes erlauben es, Wissen zu aktualisieren.

## Lernziele
- Ereignisräume beschreiben
- Bedingte Wahrscheinlichkeiten berechnen
- Den Satz von Bayes anwenden

## Kernpunkte
- P(A ∪ B) = P(A) + P(B) − P(A ∩ B)
- Unabhängigkeit: P(A ∩ B) = P(A) · P(B)

## Begriffe & Definitionen
| Begriff | Definition |
|---|---|
| Ereignis | Teilmenge des Ergebnisraums |
| Bedingte Wahrscheinlichkeit | P(A | B) = P(A ∩ B) / P(B) |`,
  },
  {
    file: 'statistik-03-hypothesentests.mp4',
    title: 'Hypothesentests',
    markdown: `# Kapitel: Hypothesentests

## Kurz-Zusammenfassung
Ein Hypothesentest prüft, ob beobachtete Daten mit einer Nullhypothese vereinbar sind. Der p-Wert misst, wie überraschend die Daten unter der Nullhypothese wären.

## Lernziele
- Null- und Alternativhypothese formulieren
- Fehler 1. und 2. Art unterscheiden
- p-Werte korrekt interpretieren

## Kernpunkte
- Signifikanzniveau α wird vor dem Test festgelegt
- Ein kleiner p-Wert ist kein Beweis für die Alternativhypothese

## Begriffe & Definitionen
| Begriff | Definition |
|---|---|
| p-Wert | Wahrscheinlichkeit für mindestens so extreme Daten unter H₀ |
| Fehler 1. Art | H₀ wird verworfen, obwohl sie wahr ist |`,
  },
];

export const seriesTitle = 'Statistik I – Wintersemester';

export function seriesMarkdown(ids = ['V01', 'V02', 'V03']) {
  const toc = ids.map((id, i) => `${i + 1}. ${lectures[Number(id.slice(1)) - 1].title}`).join('\n');
  const chapters = ids
    .map((id) => {
      const l = lectures[Number(id.slice(1)) - 1];
      return l.markdown.replace(/^# Kapitel: (.+)$/m, `# $1 <!--VID:${id}-->`);
    })
    .join('\n\n<div class="page-break"></div>\n\n');
  return `# ${seriesTitle}\n\n## Inhaltsverzeichnis\n${toc}\n\n${chapters}`;
}

export function guardrailReport(missingIds: string[] = []) {
  return {
    inputCount: 3,
    orderedCount: 3,
    order: ['V01', 'V02', 'V03'],
    missingIds,
    usedSizeFallback: false,
    usedMapReduce: false,
    seriesModel: 'gpt-5-mini',
    perChapter: lectures.map((l, i) => ({ videoId: `V0${i + 1}`, chapterTitle: l.title })),
  };
}

/** Tiny valid MP4-ish buffer; content is irrelevant because the API is mocked. */
export function fakeVideo(name: string, sizeMb = 1) {
  return { name, mimeType: 'video/mp4', buffer: Buffer.alloc(Math.round(sizeMb * 1024 * 1024), 0) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type MockOptions = {
  /** Delay per lecture in ms (README videos use longer delays to show progress). */
  lectureDelay?: number;
  seriesDelay?: number;
  /** File names whose first request fails with a 500. */
  failOnce?: string[];
  missingIds?: string[];
  /** Keep the real /api/series-pdf route (it needs no API key). */
  realPdf?: boolean;
};

export async function mockApi(page: Page, opts: MockOptions = {}) {
  const failed = new Set<string>();

  await page.route('**/api/process-lecture', async (route: Route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const lecture = lectures.find((l) => body.includes(l.file));
    await sleep(opts.lectureDelay ?? 150);
    if (!lecture) {
      return route.fulfill({ status: 400, json: { error: 'Unknown fixture file.' } });
    }
    if (opts.failOnce?.includes(lecture.file) && !failed.has(lecture.file)) {
      failed.add(lecture.file);
      return route.fulfill({ status: 500, json: { error: 'Rate limit reached', step: 'transcribe' } });
    }
    return route.fulfill({
      json: {
        fileName: lecture.file,
        transcript: `Transkript von ${lecture.title} …`,
        summary: lecture.markdown,
        chapterTitle: lecture.title,
        chapterMarkdown: lecture.markdown,
      },
    });
  });

  await page.route('**/api/series-summary', async (route) => {
    await sleep(opts.seriesDelay ?? 150);
    const missing = opts.missingIds ?? [];
    const ids = ['V01', 'V02', 'V03'].filter((id) => !missing.includes(id));
    return route.fulfill({ json: { seriesMarkdown: seriesMarkdown(ids), guardrailReport: guardrailReport(missing) } });
  });

  if (!opts.realPdf) {
    await page.route('**/api/series-pdf', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4\n%%EOF\n'),
      }),
    );
  }
}
