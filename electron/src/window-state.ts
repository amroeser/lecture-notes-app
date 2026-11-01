import { promises as fs } from 'node:fs';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const DEFAULT: WindowState = { bounds: { x: 0, y: 0, width: 1320, height: 900 }, maximized: false };

function visible(b: Rectangle) {
  return screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y);
}

export async function loadWindowState(file: string): Promise<WindowState & { center: boolean }> {
  try {
    const s = JSON.parse(await fs.readFile(file, 'utf8')) as WindowState;
    if (s?.bounds && s.bounds.width >= 400 && s.bounds.height >= 300 && visible(s.bounds)) return { ...s, center: false };
  } catch {
    // First launch or unreadable: defaults.
  }
  return { ...DEFAULT, center: true };
}

export function trackWindowState(win: BrowserWindow, file: string) {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    void fs.writeFile(file, JSON.stringify(state)).catch(() => undefined);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', save);
}
