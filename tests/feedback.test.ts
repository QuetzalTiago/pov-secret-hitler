import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { parseFeedback, startServer, type RunningServer } from '../server/index';

let server: RunningServer;
let dir: string;
let file: string;
const saved = { path: config.feedbackPath, burst: config.feedbackBurst };

const post = (srv: RunningServer, body: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${srv.port}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
const lines = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sh-feedback-'));
  file = join(dir, 'feedback.jsonl');
  config.feedbackPath = file;
  config.feedbackBurst = 1000;
  server = await startServer(0);
});
afterAll(async () => {
  config.feedbackPath = saved.path;
  config.feedbackBurst = saved.burst;
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /feedback', () => {
  it('appends a valid post as one JSON line without the IP', async () => {
    const res = await post(server, JSON.stringify({ text: 'Great game', contact: 'a@b.c', lang: 'es' }));
    expect(res.status).toBe(204);
    const rows = lines();
    expect(rows).toHaveLength(1);
    const row = JSON.parse(rows[0]);
    expect(row).toMatchObject({ text: 'Great game', contact: 'a@b.c', lang: 'es' });
    expect(typeof row.at).toBe('string');
    expect(row).not.toHaveProperty('ip');
  });

  it('rejects empty, whitespace and overlong text', async () => {
    for (const text of ['', '   \n', 'x'.repeat(2001)]) {
      const res = await post(server, JSON.stringify({ text }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Feedback must be 1-2000 characters.' });
    }
  });

  it('answers malformed JSON with a JSON 400', async () => {
    const res = await post(server, '{nope');
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
  });

  it('answers an oversized body with a JSON 413', async () => {
    const res = await post(server, JSON.stringify({ text: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
    expect(typeof (await res.json()).error).toBe('string');
  });

  it('drops an unknown lang', async () => {
    const before = lines().length;
    expect((await post(server, JSON.stringify({ text: 'hola', lang: 'fr' }))).status).toBe(204);
    const row = JSON.parse(lines()[before]);
    expect(row).not.toHaveProperty('lang');
  });

  it('refuses a cross-origin post and writes nothing', async () => {
    const before = lines().length;
    const res = await post(server, JSON.stringify({ text: 'hi' }), { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(lines()).toHaveLength(before);
  });

  it('rate limits per IP after the burst', async () => {
    config.feedbackBurst = 2;
    const limited = await startServer(0);
    try {
      expect((await post(limited, JSON.stringify({ text: 'one' }))).status).toBe(204);
      expect((await post(limited, JSON.stringify({ text: 'two' }))).status).toBe(204);
      const res = await post(limited, JSON.stringify({ text: 'three' }));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: 'Too many messages. Try again later.' });
    } finally {
      config.feedbackBurst = 1000;
      await limited.close();
    }
  });
});

describe('parseFeedback', () => {
  it('strips control chars but keeps newlines and tabs, and trims contact', () => {
    expect(parseFeedback({ text: 'a\u0000b\u0007c\nd\te', contact: '  me@x.y \u0001 ' })).toEqual({
      text: 'abc\nd\te',
      contact: 'me@x.y',
    });
  });

  it('rejects non-objects, non-string text and long contact', () => {
    expect(parseFeedback(null)).toBeNull();
    expect(parseFeedback({ text: 5 })).toBeNull();
    expect(parseFeedback({ text: 'ok', contact: 'x'.repeat(121) })).toBeNull();
  });
});
