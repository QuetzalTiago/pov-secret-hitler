// Secrets come from a git-ignored .env file (see .env.example).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: fine */
}

// Runtime configuration. HOST is intentionally not configurable: the server only ever binds to loopback.
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  host: '127.0.0.1',
  port: num(process.env.PORT, 3000),
  botDelayMs: num(process.env.SH_BOT_DELAY_MS, 1400),
  timerScale: num(process.env.SH_TIMER_SCALE, 1),
  reconnectGraceMs: num(process.env.SH_RECONNECT_MS, 60_000),
  maxRooms: num(process.env.SH_MAX_ROOMS, 50),
  maxConnections: num(process.env.SH_MAX_CONNECTIONS, 200),
  maxConnectionsPerIp: num(process.env.SH_MAX_PER_IP, 12),
  roomIdleMs: 30 * 60_000,
  /** SQLite file for room persistence. In-memory by default (tests, dev scripts); the real server sets a file. */
  dbPath: process.env.SH_DB_PATH ?? ':memory:',
  restoreMaxAgeMs: 6 * 60 * 60_000,
  jev: {
    // JEV_DISABLED=1 (set by the test runner) guarantees no paid API calls.
    key: process.env.JEV_DISABLED === '1' ? '' : (process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY ?? ''),
    url: process.env.JEV_API_URL ?? 'https://api.typesafe.ai/v1/systemone',
    model: process.env.JEV_MODEL ?? 'jev-latest',
    timeoutMs: num(process.env.JEV_TIMEOUT_MS, 3000),
    maxInflight: num(process.env.JEV_MAX_INFLIGHT, 6),
  },
};
