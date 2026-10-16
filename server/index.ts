// HTTP + WebSocket server. Serves the built client and the game socket on one loopback port.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { CODE_ALPHABET, MAX_MESSAGE_BYTES, parseClientMsg, type ClientMsg, type ServerMsg } from '../shared/protocol';
import { config, type BotLang } from './config';
import { TokenBucket } from './ratelimit';
import { Room, botLangFor, type Conn, type RoomSnapshot } from './room';
import { RoomStore } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, '..', 'dist', 'client');

export interface RunningServer {
  port: number;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  // Only the local cloudflared process can reach us, so its header is trustworthy.
  return loopback && typeof cf === 'string' && cf.length < 64 ? cf : remote;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, health checks)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Control chars except \n and \t.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function parseFeedback(body: unknown): { text: string; contact?: string; lang?: 'en' | 'es' } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.text !== 'string') return null;
  const text = b.text.replace(CONTROL_CHARS, '').trim();
  if (text.length < 1 || text.length > 2000) return null;
  const out: { text: string; contact?: string; lang?: 'en' | 'es' } = { text };
  if (b.contact !== undefined) {
    if (typeof b.contact !== 'string') return null;
    const contact = b.contact.replace(CONTROL_CHARS, '').trim();
    if (contact.length > 120) return null;
    if (contact) out.contact = contact;
  }
  if (b.lang === 'en' || b.lang === 'es') out.lang = b.lang;
  return out;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // blob:/data: because three's GLTFLoader decodes embedded textures with fetch(blob URL) in Chrome; without
  // them every GLB texture fails and the models render plain white.
  "connect-src 'self' ws: wss: blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function startServer(port = config.port): Promise<RunningServer> {
  const rooms = new Map<string, Room>();
  const store = new RoomStore(config.dbPath);
  const roomIp = new Map<string, string>(); // room code -> IP that created it
  const createBuckets = new Map<string, TokenBucket>();
  const track = (room: Room) => {
    room.onChange = (r) => store.save(r.code, r.snapshot());
    rooms.set(room.code, room);
    return room;
  };
  // A room that really ends (empty lobby, idle too long) is removed from the database too.
  const ended = (room: Room) => {
    rooms.delete(room.code);
    roomIp.delete(room.code);
    store.delete(room.code);
  };
  for (const row of store.load(config.restoreMaxAgeMs)) {
    try {
      track(Room.restore(row.data as RoomSnapshot, ended));
    } catch (e) {
      console.error(`[store] could not restore room ${row.code}:`, (e as Error).message);
      store.delete(row.code);
    }
  }
  if (rooms.size) console.log(`[store] restored ${rooms.size} room(s) from ${config.dbPath}`);
  const feedbackBuckets = new Map<string, TokenBucket>();
  let feedbackDirReady = false;
  const perIp = new Map<string, number>();
  let connections = 0;
  let nextId = 1;

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  app.post(
    '/feedback',
    express.json({ limit: '8kb' }),
    async (req: Request, res: Response) => {
      if (!sameOrigin(req)) return void res.status(403).json({ error: 'Forbidden' });
      const ip = clientIp(req);
      let bucket = feedbackBuckets.get(ip);
      if (!bucket) {
        if (feedbackBuckets.size > 1000) for (const [k, b] of feedbackBuckets) if (b.full()) feedbackBuckets.delete(k);
        feedbackBuckets.set(ip, (bucket = new TokenBucket(config.feedbackBurst, config.feedbackPerHour / 3600)));
      }
      if (!bucket.take()) return void res.status(429).json({ error: 'Too many messages. Try again later.' });
      const parsed = parseFeedback(req.body);
      if (!parsed) return void res.status(400).json({ error: 'Feedback must be 1-2000 characters.' });
      try {
        if (!feedbackDirReady) {
          mkdirSync(dirname(config.feedbackPath), { recursive: true });
          feedbackDirReady = true;
        }
        await appendFile(config.feedbackPath, JSON.stringify({ at: new Date().toISOString(), ...parsed }) + '\n');
      } catch (e) {
        console.error('[feedback] write failed:', (e as Error).message);
        return void res.status(500).json({ error: 'Could not save feedback.' });
      }
      console.log('[feedback] received', parsed.text.length, 'chars');
      res.sendStatus(204);
    },
    // Unparseable or oversized JSON bodies: answer JSON, never an HTML stack trace.
    (err: { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
      if (err.type === 'entity.too.large') res.status(413).json({ error: 'Feedback is too long.' });
      else res.status(400).json({ error: 'Feedback must be 1-2000 characters.' });
    },
  );
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, connections });
  });
  if (existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        index: 'index.html',
        maxAge: '1h',
        // Asset names are content-hashed; the HTML must always be revalidated so rebuilds show up.
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  } else {
    app.get('/', (_req, res) => {
      res.type('text').send('Client not built. Run `npm run build` first.');
    });
  }
  app.use((_req, res) => {
    res.status(404).type('text').send('Not found');
  });

  const http = createServer(app);
  http.headersTimeout = 15_000;
  http.requestTimeout = 30_000;

  const newCode = (): string | null => {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    return null;
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  http.on('upgrade', (req, socket, head) => {
    const ip = clientIp(req);
    const reject = (code: number, why: string) => {
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (req.url !== '/ws') return reject(404, 'Not Found');
    if (!sameOrigin(req)) return reject(403, 'Forbidden');
    if (connections >= config.maxConnections) return reject(503, 'Server Full');
    if ((perIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) return reject(429, 'Too Many Connections');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  function onConnection(ws: WebSocket, ip: string) {
    connections++;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const bucket = new TokenBucket(30, 10);
    const chatBucket = new TokenBucket(5, 0.5);
    let strikes = 0;
    let alive = true;

    const conn: Conn = {
      id: nextId++,
      room: null,
      seat: -1,
      send(msg: ServerMsg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    const error = (msg: string, forAct = false) => conn.send(forAct ? { t: 'error', msg, for: 'act' } : { t: 'error', msg });

    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20_000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text only');
      if (!bucket.take()) {
        if (++strikes > 50) ws.close(1008, 'rate limit');
        return;
      }
      const msg = parseClientMsg(data.toString());
      if (!msg) {
        if (++strikes > 50) ws.close(1008, 'bad messages');
        return error('Malformed message.');
      }
      try {
        const err = handle(conn, msg, chatBucket, ip);
        if (err) error(err, msg.t === 'act');
      } catch (e) {
        console.error('handler error', e);
        error('Server error.', msg.t === 'act');
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      connections--;
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      conn.room?.disconnected(conn);
    });
    ws.on('error', () => ws.terminate());
  }

  function openRoom(current: Room | null, ip: string, lang: BotLang): Room | string {
    if (current) return 'Leave your current room first.';
    let lobbies = 0;
    for (const [code, creator] of roomIp) if (creator === ip && rooms.get(code)?.stage === 'lobby') lobbies++;
    if (lobbies >= config.maxLobbiesPerIp) return 'You already have open tables waiting. Start or leave one first.';
    if (rooms.size >= config.maxRooms) return 'The bar is packed: too many rooms right now. Try later.';
    // Last, so a refused create does not burn a token.
    let bucket = createBuckets.get(ip);
    if (!bucket) createBuckets.set(ip, (bucket = new TokenBucket(config.createsPerMinute, config.createsPerMinute / 60)));
    if (!bucket.take()) return 'Slow down: too many new tables. Try again in a minute.';
    const code = newCode();
    if (!code) return 'Could not allocate a room.';
    roomIp.set(code, ip);
    return track(new Room(code, ended, lang));
  }

  function handle(conn: Conn, msg: ClientMsg, chatBucket: TokenBucket, ip: string): string | null {
    const room = conn.room;
    switch (msg.t) {
      case 'ping':
        conn.send({ t: 'pong' });
        return null;
      case 'create': {
        const r = openRoom(room, ip, botLangFor(msg.lang));
        return typeof r === 'string' ? r : r.join(conn, msg.name);
      }
      case 'quickStart': {
        const r = openRoom(room, ip, botLangFor(msg.lang));
        if (typeof r === 'string') return r;
        const err = r.join(conn, msg.name);
        return err ?? r.quickStart(conn);
      }
      case 'join': {
        if (room) return 'Leave your current room first.';
        const r = rooms.get(msg.code);
        return r ? r.join(conn, msg.name) : 'No room with that code.';
      }
      case 'resume': {
        if (room) return null;
        const r = rooms.get(msg.code);
        const err = r ? r.resume(conn, msg.token) : 'That room no longer exists.';
        if (err) conn.send({ t: 'error', msg: err, fatal: true });
        return null;
      }
    }
    if (!room) return 'You are not in a room.';
    switch (msg.t) {
      case 'addBot':
        return room.addBot(conn);
      case 'setOptions':
        return room.setOptions(conn, { pace: msg.pace, botLevel: msg.botLevel });
      case 'removeBot':
        return room.removeBot(conn);
      case 'start':
        return room.start(conn);
      case 'act':
        return room.act(conn, msg.a);
      case 'chat':
        return chatBucket.take() ? room.chat(conn, msg.text) : 'Slow down.';
      case 'leave':
        room.leave(conn);
        return null;
      case 'rematch':
        return room.rematch(conn);
      case 'playAgain':
        return room.playAgain(conn);
      case 'redeal':
        return room.forceRedeal(conn);
    }
  }

  // Garbage-collect idle rooms.
  const gc = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.connectedHumans() === 0 && now - room.lastActivity > config.roomIdleMs) room.close();
    }
    for (const [ip, bucket] of createBuckets) if (bucket.full()) createBuckets.delete(ip);
  }, 60_000);

  return new Promise((resolve, reject) => {
    http.once('error', reject); // e.g. EADDRINUSE
    http.listen(port, config.host, () => {
      const addr = http.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: actual,
        rooms,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(gc);
            // Shutdown keeps rooms in the database so games survive a restart.
            for (const r of rooms.values()) r.shutdown();
            store.close();
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => res());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.on('unhandledRejection', (e) => console.error('[server] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[server] uncaught exception', e));
  config.dbPath = process.env.SH_DB_PATH ?? 'data/rooms.db';
  startServer().then((s) => {
    console.log(`POV Secret Hitler (povsecrethitler.app) listening on http://${config.host}:${s.port}`);
  });
}
