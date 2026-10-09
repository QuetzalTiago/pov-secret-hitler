// Minimal client for TypeSafe's Jev decision model (https://docs.typesafe.ai).
// Server-only: the API key never reaches a browser.
import { config } from './config';

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevStats {
  calls: number;
  ok: number;
  failed: number;
  inputTokens: number;
  lastError: string | null;
  disabled: boolean;
}

export const jevStats: JevStats = { calls: 0, ok: 0, failed: 0, inputTokens: 0, lastError: null, disabled: false };

let inflight = 0;
let authFailures = 0;

export function jevEnabled(): boolean {
  return !!config.jev.key && !jevStats.disabled;
}

/**
 * Asks one `choice` question. Resolves null (caller falls back to the built-in strategy) on timeout,
 * HTTP error, malformed answer, or when too many requests are already in flight.
 */
export async function askChoice(
  state: unknown,
  instructions: string,
  criteria: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  /** Slots kept free for more important calls (table talk passes 2 so it never delays a bot's move). */
  reserve = 0,
): Promise<ChoiceAnswer | null> {
  if (!jevEnabled() || inflight >= config.jev.maxInflight - reserve) return null;
  inflight++;
  jevStats.calls++;
  try {
    const res = await fetchImpl(config.jev.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.jev.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.jev.model,
        state,
        questions: { decision: { type: 'choice', instructions, criteria } },
      }),
      signal: AbortSignal.timeout(config.jev.timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      if (++authFailures >= 3) {
        jevStats.disabled = true;
        console.error('[jev] API key rejected 3 times; using the built-in bot strategy from now on.');
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    authFailures = 0;
    const body = (await res.json()) as {
      answers?: { decision?: { choice?: unknown; probabilities?: unknown; confidence?: unknown } };
      usage?: { input_tokens?: number };
    };
    const a = body.answers?.decision;
    if (!a || typeof a.choice !== 'string' || !(a.choice in criteria)) throw new Error('malformed answer');
    jevStats.ok++;
    jevStats.inputTokens += body.usage?.input_tokens ?? 0;
    const probabilities =
      a.probabilities && typeof a.probabilities === 'object' ? (a.probabilities as Record<string, number>) : { [a.choice]: 1 };
    return { choice: a.choice, probabilities, confidence: typeof a.confidence === 'number' ? a.confidence : 1 };
  } catch (e) {
    jevStats.failed++;
    jevStats.lastError = (e as Error).message;
    return null;
  } finally {
    inflight--;
  }
}
