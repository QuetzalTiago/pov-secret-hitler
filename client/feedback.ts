// Player feedback: validation and the POST to /feedback (pure; the dialog lives in ui.ts).
export const REPO_URL = 'https://github.com/QuetzalTiago/pov-secret-hitler';

export type FeedbackResult = 'ok' | 'invalid' | 'rate' | 'error';

const MAX_TEXT = 2000;

export function feedbackValid(text: string): boolean {
  const n = text.trim().length;
  return n >= 1 && n <= MAX_TEXT;
}

export async function sendFeedback(text: string, contact: string, lang: 'en' | 'es', fetchFn: typeof fetch = fetch): Promise<FeedbackResult> {
  if (!feedbackValid(text)) return 'invalid';
  try {
    const res = await fetchFn('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), contact: contact.trim() || undefined, lang }),
    });
    if (res.status === 429) return 'rate';
    if (res.status === 400) return 'invalid';
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
