// Secrets come from a git-ignored .env file (see .env.example).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: fine */
}

// Runtime configuration. HOST is intentionally not configurable: the server only ever binds to loopback.
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export type LlmProvider = 'gemini' | 'openai' | 'anthropic';
export type BotLang = 'es-AR' | 'en';

const llmDisabled = process.env.SH_LLM_DISABLED === '1';

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
  /**
   * Table talk: a small text model that writes what the bots type into the chat (no audio involved).
   * Any provider works (see .env.example); without a key bots fall back to the built-in template lines.
   */
  llm: {
    // SH_LLM_DISABLED=1 (set by the test runner) guarantees no network calls.
    key: llmDisabled ? '' : (process.env.SH_LLM_KEY ?? process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''),
    provider: (process.env.SH_LLM_PROVIDER ?? 'gemini') as LlmProvider,
    model: process.env.SH_LLM_MODEL ?? '',
    /** Base URL override. Any OpenAI-compatible endpoint works here (Groq, OpenRouter, Ollama, ...). */
    url: process.env.SH_LLM_URL ?? '',
    lang: (process.env.SH_BOT_LANG ?? 'es-AR') as BotLang,
    /** Bots swear like real players. Set to 0 for a family-friendly table. */
    profanity: process.env.SH_LLM_PROFANITY !== '0',
    timeoutMs: num(process.env.SH_LLM_TIMEOUT_MS, 6000),
    maxInflight: num(process.env.SH_LLM_MAX_INFLIGHT, 4),
    /** Hard ceiling on generated lines per game, so a long table can never run up a surprise bill. */
    maxCallsPerGame: num(process.env.SH_LLM_MAX_CALLS, 400),
  },
};

/** Defaults per provider: free-tier friendly and fast, because table talk is realtime. */
export const LLM_DEFAULTS: Record<LlmProvider, { url: string; model: string }> = {
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash-lite' },
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  anthropic: { url: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5' },
};

export function llmEndpoint(): { url: string; model: string } {
  const d = LLM_DEFAULTS[config.llm.provider] ?? LLM_DEFAULTS.gemini;
  return { url: config.llm.url || d.url, model: config.llm.model || d.model };
}
