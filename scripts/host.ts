// `npm run host`: build the client, start the server on loopback, open a Cloudflare quick tunnel,
// verify HTTP + WebSockets through it, and print the public URL.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';

const PORT = config.port;
const OS = platform();
const isWin = OS === 'win32';
const BIN_DIR = join(process.cwd(), 'bin');
const LOCAL_BIN = join(BIN_DIR, isWin ? 'cloudflared.exe' : 'cloudflared');

const log = (msg: string) => console.log(`\x1b[33m[host]\x1b[0m ${msg}`);
const fail = (msg: string): never => {
  console.error(`\x1b[31m[host] ${msg}\x1b[0m`);
  process.exit(1);
};

function works(cmd: string): boolean {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
  return r.status === 0;
}

function findCloudflared(): string | null {
  const candidates = ['cloudflared', LOCAL_BIN];
  if (isWin) {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? '';
    candidates.push(
      join(pf86, 'cloudflared', 'cloudflared.exe'),
      join(pf, 'cloudflared', 'cloudflared.exe'),
      join(local, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    );
  } else {
    candidates.push('/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared', '/usr/bin/cloudflared');
  }
  return candidates.find((c) => (c === 'cloudflared' || existsSync(c)) && works(c)) ?? null;
}

const INSTRUCTIONS: Record<string, string> = {
  win32: 'winget install --id Cloudflare.cloudflared -e   (or download cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases/latest)',
  darwin: 'brew install cloudflared',
  linux: 'curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/',
};

async function installCloudflared(): Promise<void> {
  log(`cloudflared not found; installing it for ${OS}…`);
  if (isWin) {
    spawnSync('winget', ['install', '--id', 'Cloudflare.cloudflared', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit' });
  } else if (OS === 'darwin') {
    spawnSync('brew', ['install', 'cloudflared'], { stdio: 'inherit' });
  } else if (OS === 'linux') {
    const a = arch() === 'arm64' ? 'arm64' : arch() === 'arm' ? 'arm' : 'amd64';
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${a}`;
    log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) return;
    mkdirSync(BIN_DIR, { recursive: true });
    writeFileSync(LOCAL_BIN, Buffer.from(await res.arrayBuffer()));
    chmodSync(LOCAL_BIN, 0o755);
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: isWin });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))));
  });
}

function startTunnel(bin: string): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('cloudflared did not report a URL within 60s')), 60_000);
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, url: m[0] });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`cloudflared exited early (code ${code})`)));
  });
}

/**
 * Optional permanent tunnel on your own domain. Create tunnel.json (git-ignored) with
 * { "name": "<tunnel name>", "hostname": "example.com", "config": "<path to cloudflared config.yml>" }.
 * Without it, a random trycloudflare.com quick tunnel is used.
 */
interface NamedTunnel {
  name: string;
  hostname: string;
  config: string;
}

function readNamedTunnel(): NamedTunnel | null {
  const file = join(process.cwd(), 'tunnel.json');
  if (!existsSync(file)) return null;
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as NamedTunnel;
  if (!cfg.name || !cfg.hostname || !cfg.config) fail('tunnel.json needs name, hostname and config');
  if (!existsSync(cfg.config)) fail(`cloudflared config not found: ${cfg.config}`);
  return cfg;
}

function startNamedTunnel(bin: string, cfg: NamedTunnel): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--config', cfg.config, 'run', cfg.name], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('cloudflared did not connect within 60s')), 60_000);
    const onData = (buf: Buffer) => {
      if (/Registered tunnel connection/i.test(buf.toString())) {
        clearTimeout(timer);
        resolve({ proc, url: `https://${cfg.hostname}` });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`cloudflared exited early (code ${code})`)));
  });
}

async function waitForHttp(url: string): Promise<void> {
  const end = Date.now() + 90_000;
  let last = '';
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`public URL never answered (${last})`);
}

function checkWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url.replace('https://', 'wss://')}/ws`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('no WebSocket pong through the tunnel'));
    }, 15_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'ping' })));
    ws.on('message', (d) => {
      if (JSON.parse(d.toString()).t === 'pong') {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function banner(url: string) {
  const line = '═'.repeat(url.length + 8);
  console.log(`\n\x1b[32m╔${line}╗`);
  console.log(`║    ${' '.repeat(url.length)}    ║`);
  console.log(`║    \x1b[1m${url}\x1b[0m\x1b[32m    ║`);
  console.log(`║    ${' '.repeat(url.length)}    ║`);
  console.log(`╚${line}╝\x1b[0m`);
  console.log('Share this link. HTTP and WebSockets verified through the tunnel. Press Ctrl+C to stop.\n');
}

async function main() {
  log(`OS: ${OS} (${arch()})`);
  let bin = findCloudflared();
  if (!bin) {
    await installCloudflared();
    bin = findCloudflared();
  }
  if (!bin) fail(`Could not install cloudflared automatically. Install it with:\n    ${INSTRUCTIONS[OS] ?? 'see https://github.com/cloudflare/cloudflared/releases'}\n  then run \`npm run host\` again.`);
  log(`using cloudflared: ${bin}`);

  const named = readNamedTunnel();
  log('building the client…');
  await run('npx', ['vite', 'build']);

  let server: RunningServer;
  try {
    config.dbPath = process.env.SH_DB_PATH ?? 'data/rooms.db'; // games survive restarts
    server = await startServer(PORT);
  } catch (e) {
    return fail(`Could not listen on 127.0.0.1:${PORT} (${(e as Error).message}). Stop whatever is using it or set PORT=xxxx.`);
  }
  log(`server listening on http://127.0.0.1:${server.port} (loopback only)`);

  log(named ? `starting named tunnel "${named.name}" for ${named.hostname}…` : 'opening Cloudflare quick tunnel…');
  const { proc, url } = named ? await startNamedTunnel(bin!, named) : await startTunnel(bin!);
  const shutdown = async () => {
    proc.kill();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  proc.on('exit', () => {
    console.error('[host] cloudflared stopped.');
    void server.close().then(() => process.exit(1));
  });

  log(`tunnel URL: ${url} (waiting for it to go live…)`);
  await waitForHttp(url);
  await checkWebSocket(url);
  banner(url);
}

main().catch((e) => fail((e as Error).message));
