import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';

export interface ServerOptions {
  /** Directory with the Next.js standalone server (server.js). Ignored in dev mode. */
  serverDir: string;
  /** Repository root; used in dev mode to run `next dev`. */
  repoRoot: string;
  dev: boolean;
  env: Record<string, string>;
  logFile: string;
}

export interface RunningServer {
  origin: string;
  stop(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function probe(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${origin}/`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitUntilReady(origin: string, isAlive: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('The local server exited during start-up.');
    if (await probe(origin)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The local server did not answer within ${Math.round(timeoutMs / 1000)} s.`);
}

async function openLog(file: string): Promise<WriteStream> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // One log per launch; the previous one is kept as .1 for support.
  await fs.rename(file, `${file}.1`).catch(() => undefined);
  return createWriteStream(file, { flags: 'a' });
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const log = await openLog(opts.logFile);
  const env: Record<string, string> = {
    ...opts.env,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: opts.dev ? 'development' : 'production',
  };

  let alive = true;
  let stopFn: () => void;
  let exited: Promise<void>;

  if (opts.dev) {
    // Dev only: run `next dev` with the system Node so Turbopack can spawn its workers normally.
    const nextBin = path.join(opts.repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
    const child: ChildProcess = spawn(process.env.LBS_NODE_BIN || 'node', [nextBin, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: opts.repoRoot,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    exited = new Promise((resolve) => child.once('exit', () => resolve()));
    stopFn = () => child.kill();
  } else {
    const proc: UtilityProcess = utilityProcess.fork(path.join(opts.serverDir, 'server.js'), [], {
      cwd: opts.serverDir,
      env,
      stdio: 'pipe',
      serviceName: 'Lecture Batch Summarizer server',
    });
    proc.stdout?.pipe(log, { end: false });
    proc.stderr?.pipe(log, { end: false });
    exited = new Promise((resolve) => proc.once('exit', () => resolve()));
    stopFn = () => {
      proc.kill();
    };
  }
  void exited.then(() => {
    alive = false;
  });

  try {
    await waitUntilReady(origin, () => alive, opts.dev ? 120_000 : 45_000);
  } catch (e) {
    stopFn();
    log.end();
    throw e;
  }

  return {
    origin,
    async stop() {
      if (alive) {
        stopFn();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      log.end();
    },
  };
}
