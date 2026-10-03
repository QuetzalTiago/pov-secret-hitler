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
};
