// Text model client for bot table talk. Writes the words a bot types into the chat box; there is no
// audio anywhere in this feature. Provider-neutral on purpose, so a table can run on a free tier
// (Gemini, Groq, a local Ollama) without code changes. Server-only: the API key never reaches a browser.
// Jev still decides WHAT a bot says in the strategic moments (see botchat.ts); this only writes it.
import { config, llmEndpoint } from './config';

export interface LlmStats {
  calls: number;
  ok: number;
  failed: number;
  blocked: number; // provider refused / returned nothing usable
  lastError: string | null;
  disabled: boolean;
}

export const llmStats: LlmStats = { calls: 0, ok: 0, failed: 0, blocked: 0, lastError: null, disabled: false };

let inflight = 0;
let authFailures = 0;

/**
 * Circuit breaker. A provider that is rate-limiting us or simply down must not cost every bot line a full
 * timeout: after a few consecutive failures we stop calling out entirely for a while and the table falls
 * back to Jev plus the scripted template lines, which is exactly how the game played before this feature.
 * The breaker half-opens on its own, so a transient outage heals without a restart.
 */
const BREAKER_AFTER = 4;
const BREAKER_MIN_MS = 30_000;
const BREAKER_MAX_MS = 15 * 60_000;
let consecutiveFailures = 0;
let openUntil = 0;
let cooldownMs = BREAKER_MIN_MS;

function recordFailure(): void {
  if (++consecutiveFailures < BREAKER_AFTER) return;
  openUntil = Date.now() + cooldownMs;
  console.error(`[llm] ${consecutiveFailures} failures in a row (${llmStats.lastError}); pausing bot table talk for ${Math.round(cooldownMs / 1000)}s and using template lines.`);
  cooldownMs = Math.min(BREAKER_MAX_MS, cooldownMs * 2);
}

function recordSuccess(): void {
  if (consecutiveFailures >= BREAKER_AFTER) console.info('[llm] provider recovered; bots are talking again.');
  consecutiveFailures = 0;
  openUntil = 0;
  cooldownMs = BREAKER_MIN_MS;
}

/** True while the breaker is holding calls back. Exposed for the stats endpoint and tests. */
export function breakerOpen(now = Date.now()): boolean {
  return now < openUntil;
}

export function llmEnabled(): boolean {
  return !!config.llm.key && !llmStats.disabled && !breakerOpen();
}

/** Test seam: forget the breaker and the auth-failure count. */
export function resetLlmState(): void {
  consecutiveFailures = 0;
  openUntil = 0;
  cooldownMs = BREAKER_MIN_MS;
  authFailures = 0;
  llmStats.disabled = false;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

type Adapter = (req: LlmRequest, url: string, model: string, key: string) => { url: string; init: RequestInit; read: (body: unknown) => string | null };

/**
 * Gemini. Safety filters are turned off for the two categories that cover insults and profanity:
 * this is a game of accusations where players swear at each other, and a filtered bot goes mute at the
 * exact moment it should be shouting. Set SH_LLM_PROFANITY=0 for a tamer table.
 */
const gemini: Adapter = (req, url, model, key) => ({
  url: `${url}/models/${encodeURIComponent(model)}:generateContent`,
  init: {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 120,
        temperature: req.temperature ?? 1,
        stopSequences: ['\n\n'],
      },
      safetySettings: config.llm.profanity
        ? [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ]
        : undefined,
    }),
  },
  read: (body) => {
    const b = body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };
    const parts = b.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    return text || null;
  },
});

/** OpenAI chat completions. Also covers Groq, OpenRouter, Together, LM Studio and Ollama via SH_LLM_URL. */
const openai: Adapter = (req, url, model, key) => ({
  url: `${url}/chat/completions`,
  init: {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_completion_tokens: req.maxTokens ?? 120,
      temperature: req.temperature ?? 1,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  },
  read: (body) => {
    const b = body as { choices?: { message?: { content?: unknown } }[] };
    const text = b.choices?.[0]?.message?.content;
    return typeof text === 'string' && text ? text : null;
  },
});

const anthropic: Adapter = (req, url, model, key) => ({
  url: `${url}/messages`,
  init: {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 120,
      temperature: req.temperature ?? 1,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    }),
  },
  read: (body) => {
    const b = body as { content?: { type?: string; text?: unknown }[] };
    const text = (b.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
    return text || null;
  },
});

const ADAPTERS: Record<string, Adapter> = { gemini, openai, anthropic };

/**
 * Writes one line of table talk (plain text, posted to the chat log). Resolves null — the caller falls
 * back to the built-in template line — on timeout, HTTP error, an empty or filtered answer, or when too
 * many requests are already in flight. A bot that cannot find its words types the scripted line instead;
 * it never blocks the game.
 */
export async function write(req: LlmRequest, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!llmEnabled() || inflight >= config.llm.maxInflight) return null;
  const adapter = ADAPTERS[config.llm.provider];
  if (!adapter) {
    llmStats.disabled = true;
    console.error(`[llm] unknown provider "${config.llm.provider}"; using template lines from now on.`);
    return null;
  }
  const { url, model } = llmEndpoint();
  inflight++;
  llmStats.calls++;
  try {
    const call = adapter(req, url.replace(/\/$/, ''), model, config.llm.key);
    const res = await fetchImpl(call.url, { ...call.init, signal: AbortSignal.timeout(config.llm.timeoutMs) });
    if (res.status === 401 || res.status === 403) {
      if (++authFailures >= 3) {
        llmStats.disabled = true;
        console.error('[llm] API key rejected 3 times; bots fall back to template lines from now on.');
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    authFailures = 0;
    const text = call.read(await res.json());
    if (!text) {
      llmStats.blocked++;
      recordFailure(); // a provider that keeps filtering us is no more useful than one that is down
      return null;
    }
    llmStats.ok++;
    recordSuccess();
    return text;
  } catch (e) {
    llmStats.failed++;
    llmStats.lastError = (e as Error).message;
    recordFailure();
    return null;
  } finally {
    inflight--;
  }
}
