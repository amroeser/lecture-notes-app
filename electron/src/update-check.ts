import { app, dialog, shell, type BrowserWindow } from 'electron';

const REPO = 'amroeser/lecture-notes-app';

function parse(v: string) {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string) {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Unsigned macOS builds cannot auto-update, so the app only tells the user about a newer release.
 * Any error (offline, rate limit, no release yet) is ignored.
 */
export async function checkForUpdate(win: BrowserWindow) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lecture-batch-summarizer-desktop' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!json.tag_name || !json.html_url || !isNewer(json.tag_name, app.getVersion())) return;
    if (!json.html_url.startsWith(`https://github.com/${REPO}/`)) return;

    const de = app.getLocale().toLowerCase().startsWith('de');
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: de ? ['Zur Release-Seite', 'Später'] : ['Open release page', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: de ? `Version ${json.tag_name} ist verfügbar` : `Version ${json.tag_name} is available`,
      detail: de
        ? `Installiert ist ${app.getVersion()}. Lade die neue Version von der Release-Seite.`
        : `You have ${app.getVersion()}. Download the new version from the release page.`,
    });
    if (response === 0) await shell.openExternal(json.html_url);
  } catch {
    // Offline or rate-limited: try again next launch.
  }
}
