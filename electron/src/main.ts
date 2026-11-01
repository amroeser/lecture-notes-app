import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { IPC, type AppInfo, type ConnectionTarget } from './bridge-types';
import { cliInfo } from './cli';
import { testConnection } from './connection-test';
import { startServer, type RunningServer } from './server';
import { SettingsStore } from './settings';
import { loginShellPath } from './shell-path';
import { checkForUpdate } from './update-check';
import { loadWindowState, trackWindowState } from './window-state';

const TOKEN_COOKIE = 'lbs_desktop_token';
const DEV = process.env.LBS_DESKTOP_DEV === '1';

// Tests and power users can point the app at another profile directory.
if (process.env.LBS_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.LBS_USER_DATA_DIR));

/** Variables the app manages itself; inherited values (e.g. from a terminal) must not leak in. */
const MANAGED_ENV = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_TEXT_API_KEY',
  'OPENAI_TEXT_BASE_URL',
  'OPENAI_TRANSCRIBE_MODEL',
  'OPENAI_SUMMARY_MODEL',
  'OPENAI_SERIES_MODEL',
  'OPENAI_SERIES_FINAL_MODEL',
  'TRANSCRIBE_PROVIDER',
  'MISTRAL_API_KEY',
  'MISTRAL_BASE_URL',
  'MISTRAL_TRANSCRIBE_MODEL',
  'TEXT_PROVIDER',
  'CLAUDE_CODE_PATH',
  'CODEX_PATH',
  'CLI_TEXT_MODEL',
  'CACHE_DIR',
  'LBS_DATA_DIR',
  'FFMPEG_PATH',
  'LBS_DESKTOP_TOKEN',
];

const de = () => app.getLocale().toLowerCase().startsWith('de');

function paths() {
  const userData = app.getPath('userData');
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      repoRoot: res,
      serverDir: path.join(res, 'server'),
      ffmpeg: path.join(res, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      userData,
    };
  }
  // Unpacked: the app folder is <repo>/electron/app.
  const repoRoot = path.resolve(app.getAppPath(), '..', '..');
  return {
    repoRoot,
    serverDir: path.join(repoRoot, 'dist-desktop', 'server'),
    ffmpeg: path.join(repoRoot, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    userData,
  };
}

let mainWindow: BrowserWindow | null = null;
let server: RunningServer | null = null;
let store: SettingsStore;
let searchPath = process.env.PATH ?? '';
const token = randomBytes(32).toString('hex');

function serverEnv(): Record<string, string> {
  const p = paths();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string' && !MANAGED_ENV.includes(e[0])),
  );
  return {
    ...inherited,
    ...store.toEnv(),
    PATH: searchPath,
    CACHE_DIR: path.join(p.userData, 'cache'),
    LBS_DATA_DIR: path.join(p.userData, 'data'),
    ...(existsSync(p.ffmpeg) && { FFMPEG_PATH: p.ffmpeg }),
    LBS_DESKTOP_TOKEN: token,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

function bootPage(message: string) {
  const dark = nativeTheme.shouldUseDarkColors;
  const bg = dark ? '#09090b' : '#fafaf9';
  const fg = dark ? '#a1a1aa' : '#63636c';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lecture Batch Summarizer</title>
<style>html,body{height:100%;margin:0;background:${bg};color:${fg};font:14px -apple-system,system-ui,sans-serif}
body{display:grid;place-items:center}.d{width:28px;height:28px;border-radius:50%;border:3px solid #4f46e533;border-top-color:#4f46e5;
animation:s 0.9s linear infinite;margin:0 auto 14px}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div><div class="d"></div><div>${message}</div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function bootServer(targetPath = '/') {
  const win = mainWindow;
  if (!win) return;
  await win.loadURL(bootPage(de() ? 'Lecture Batch Summarizer startet…' : 'Starting Lecture Batch Summarizer…'));
  const p = paths();
  try {
    server = await startServer({
      serverDir: p.serverDir,
      repoRoot: p.repoRoot,
      dev: DEV,
      env: serverEnv(),
      logFile: path.join(p.userData, 'logs', 'server.log'),
    });
  } catch (e) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      buttons: de() ? ['Erneut versuchen', 'Log anzeigen', 'Beenden'] : ['Try again', 'Show log', 'Quit'],
      defaultId: 0,
      message: de() ? 'Der lokale Server ließ sich nicht starten.' : 'The local server could not be started.',
      detail: e instanceof Error ? e.message : String(e),
    });
    if (response === 0) return bootServer(targetPath);
    if (response === 1) shell.showItemInFolder(path.join(p.userData, 'logs', 'server.log'));
    app.quit();
    return;
  }
  await session.defaultSession.cookies.set({
    url: server.origin,
    name: TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'strict',
  });
  await win.loadURL(`${server.origin}${targetPath}`);
}

async function restartServer(targetPath: string) {
  const old = server;
  server = null;
  await old?.stop();
  await bootServer(targetPath);
}

function isAppUrl(url: string) {
  try {
    return server !== null && new URL(url).origin === server.origin;
  } catch {
    return false;
  }
}

function openExternalSafe(url: string) {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return;
  // E2E tests check the routing without opening a real browser.
  if (process.env.LBS_DISABLE_OPEN_EXTERNAL === '1') return;
  void shell.openExternal(url);
}

async function createWindow() {
  const p = paths();
  const stateFile = path.join(p.userData, 'window-state.json');
  const state = await loadWindowState(stateFile);
  const win = new BrowserWindow({
    ...(state.center ? { width: state.bounds.width, height: state.bounds.height } : state.bounds),
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'Lecture Batch Summarizer',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#09090b' : '#fafaf9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win, stateFile);
  win.once('ready-to-show', () => win.show());

  // Everything outside the local app opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || url.startsWith('data:text/html')) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  // Exports are saved like a browser does: into Downloads, without a dialog for every file.
  win.webContents.session.on('will-download', (_event, item) => {
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename());
    let candidate = path.join(dir, parsed.base);
    for (let i = 1; existsSync(candidate); i += 1) candidate = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(candidate);
  });

  win.on('closed', () => {
    mainWindow = null;
  });
  mainWindow = win;
  return win;
}

function guard(event: IpcMainInvokeEvent) {
  if (!isAppUrl(event.senderFrame?.url ?? '')) throw new Error('Forbidden');
}

function registerIpc() {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    guard(event);
    return { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged };
  });
  ipcMain.handle(IPC.getSettings, (event) => {
    guard(event);
    return store.view();
  });
  ipcMain.handle(IPC.saveSettings, async (event, patch: unknown) => {
    guard(event);
    const view = await store.apply(patch);
    // Answer first, then restart: the page reloads with the new configuration.
    setTimeout(() => void restartServer('/settings?saved=1'), 50);
    return view;
  });
  ipcMain.handle(IPC.testConnection, (event, target: unknown) => {
    guard(event);
    const t: ConnectionTarget = target === 'text' ? 'text' : 'transcription';
    return testConnection(t, store, searchPath);
  });
  ipcMain.handle(IPC.cliStatus, async (event) => {
    guard(event);
    const s = store.settings;
    const [claudeCode, codex] = await Promise.all([cliInfo('claude', s.claudeCodePath, searchPath), cliInfo('codex', s.codexPath, searchPath)]);
    return { claudeCode, codex };
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const goto = (p: string) => {
    if (server && mainWindow) void mainWindow.loadURL(`${server.origin}${p}`);
  };
  const settingsItem: MenuItemConstructorOptions = {
    label: de() ? 'Einstellungen…' : 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => goto('/settings'),
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, settingsItem, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: de() ? 'Datei' : 'File',
      submenu: [...(isMac ? [] : [settingsItem, { type: 'separator' } as MenuItemConstructorOptions]), isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: de() ? 'Ansicht' : 'View',
      submenu: [
        { label: de() ? 'Startseite' : 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => goto('/') },
        { role: 'reload' },
        ...(DEV || !app.isPackaged ? ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'GitHub', click: () => void shell.openExternal('https://github.com/amroeser/lecture-notes-app') },
        { label: de() ? 'Server-Log anzeigen' : 'Show server log', click: () => shell.showItemInFolder(path.join(paths().userData, 'logs', 'server.log')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  void app.whenReady().then(async () => {
    store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    await store.load();
    searchPath = await loginShellPath();
    registerIpc();
    buildMenu();
    const win = await createWindow();
    await bootServer('/');
    if (app.isPackaged && process.env.LBS_DISABLE_UPDATE_CHECK !== '1') void checkForUpdate(win);

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
        if (server && mainWindow) {
          await mainWindow.loadURL(server.origin);
        } else {
          await bootServer('/');
        }
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    event.preventDefault();
    quitting = true;
    void server.stop().finally(() => app.quit());
  });
}
