import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { REPO_URL, feedbackValid, sendFeedback } from '../client/feedback';

const fake = (status: number) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }));
const asFetch = (f: ReturnType<typeof fake>) => f as unknown as typeof fetch;
const sentBody = (f: ReturnType<typeof fake>) => JSON.parse(f.mock.calls[0][1]?.body as string);

describe('sendFeedback', () => {
  it('never fetches invalid text', async () => {
    const f = fake(204);
    expect(await sendFeedback('   ', '', 'en', asFetch(f))).toBe('invalid');
    expect(await sendFeedback('x'.repeat(2001), '', 'en', asFetch(f))).toBe('invalid');
    expect(f).not.toHaveBeenCalled();
    expect(feedbackValid('x'.repeat(2000))).toBe(true);
  });

  it('posts trimmed JSON to /feedback', async () => {
    const f = fake(204);
    expect(await sendFeedback('  hi  ', ' me@x.com ', 'es', asFetch(f))).toBe('ok');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/feedback');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(sentBody(f)).toEqual({ text: 'hi', contact: 'me@x.com', lang: 'es' });
  });

  it('omits a blank contact', async () => {
    const f = fake(204);
    await sendFeedback('hi', '  ', 'en', asFetch(f));
    expect(sentBody(f)).toEqual({ text: 'hi', lang: 'en' });
  });

  it('maps statuses', async () => {
    expect(await sendFeedback('hi', '', 'en', asFetch(fake(429)))).toBe('rate');
    expect(await sendFeedback('hi', '', 'en', asFetch(fake(400)))).toBe('invalid');
    expect(await sendFeedback('hi', '', 'en', asFetch(fake(500)))).toBe('error');
  });

  it('maps a thrown fetch to error', async () => {
    const f = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await sendFeedback('hi', '', 'en', f)).toBe('error');
  });
});

describe('index.html', () => {
  const html = readFileSync('client/index.html', 'utf8');
  it('has the feedback dialog and its openers', () => {
    for (const id of ['feedback', 'feedback-text', 'feedback-send', 'home-feedback', 'feedback-btn']) expect(html).toContain(`id="${id}"`);
  });
  it('credits the authors and the repo', () => {
    const from = html.slice(html.indexOf('id="credits"'));
    const block = from.slice(0, from.indexOf('credits-close'));
    expect(block).toContain('Tiago Romero');
    expect(block).toContain('Claude');
    expect(block).toContain(REPO_URL);
  });
});
