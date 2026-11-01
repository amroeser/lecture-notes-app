import { execFile } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { CliInfo } from './bridge-types';

async function isExecutable(file: string) {
  try {
    await fs.access(file, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** `which` without a shell: search PATH (and PATHEXT on Windows). */
export async function findExecutable(name: string, searchPath: string): Promise<string | undefined> {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function runVersion(file: string, searchPath: string): Promise<string> {
  const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  // .cmd/.bat need cmd.exe; arguments are fixed, so no user input reaches the shell.
  const [cmd, args] = isCmd ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${file}" --version`]] : [file, ['--version']];
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 8000, env: { ...process.env, PATH: searchPath }, encoding: 'utf8', windowsVerbatimArguments: isCmd },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString().trim().slice(0, 300)));
        resolve(stdout.toString().trim().split('\n')[0]?.slice(0, 120) ?? '');
      },
    );
  });
}

export async function cliInfo(name: 'claude' | 'codex', override: string, searchPath: string): Promise<CliInfo> {
  const file = override ? ((await isExecutable(override)) ? override : undefined) : await findExecutable(name, searchPath);
  if (!file) return { found: false, ...(override && { error: 'not_executable' }) };
  try {
    return { found: true, path: file, version: await runVersion(file, searchPath) };
  } catch (e) {
    return { found: false, path: file, error: e instanceof Error ? e.message : 'failed' };
  }
}
