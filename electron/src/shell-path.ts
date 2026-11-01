import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const MARK = '__LBS_PATH__';

/**
 * Apps started from Finder or the Dock do not inherit the PATH of the user's shell, so tools like
 * `claude` (~/.local/bin) or Homebrew binaries would not be found. Ask the login shell once.
 */
export function loginShellPath(timeoutMs = 4000): Promise<string> {
  const fallbackDirs = [
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const merge = (...lists: Array<string | undefined>) =>
    Array.from(new Set(lists.flatMap((l) => (l ? l.split(path.delimiter) : [])).filter(Boolean))).join(path.delimiter);

  if (process.platform === 'win32') {
    return Promise.resolve(process.env.PATH ?? '');
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`],
      { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' }, encoding: 'utf8' },
      (_err, stdout) => {
        const m = typeof stdout === 'string' ? stdout.match(new RegExp(`${MARK}(.*)${MARK}`)) : null;
        resolve(merge(m?.[1], process.env.PATH, fallbackDirs.join(path.delimiter)));
      },
    );
  });
}
