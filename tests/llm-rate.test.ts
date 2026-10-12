import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { breakerOpen, resetLlmState, write } from '../server/llm';

const okBody = { candidates: [{ content: { parts: [{ text: 'fine, whatever you say' }] } }] };
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
const req = { system: 's', user: 'u' };

const saved = { ...config.llm };

beforeEach(() => {
  resetLlmState();
  config.llm.key = 'test';
});

afterEach(() => {
  Object.assign(config.llm, saved);
  resetLlmState();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('per-minute budget', () => {
  it('stops non-reply lines at 60% of the rpm and keeps the rest for replies', async () => {
    config.llm.rpm = 5;
    const f = okFetch();
    const fx = f as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) expect(await write(req, fx)).toBe('fine, whatever you say');
    expect(f).toHaveBeenCalledTimes(3);

    const onSent = vi.fn();
    expect(await write(req, fx, onSent, 'other')).toBeNull();
    expect(f).toHaveBeenCalledTimes(3);
    expect(onSent).not.toHaveBeenCalled();

    expect(await write(req, fx, undefined, 'reply')).toBe('fine, whatever you say');
    expect(await write(req, fx, undefined, 'reply')).toBe('fine, whatever you say');
    expect(f).toHaveBeenCalledTimes(5);
    expect(await write(req, fx, undefined, 'reply')).toBeNull();
    expect(f).toHaveBeenCalledTimes(5);
  });

  it('frees the budget after a minute', async () => {
    vi.useFakeTimers();
    config.llm.rpm = 5;
    const f = okFetch();
    const fx = f as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) await write(req, fx);
    expect(await write(req, fx)).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(await write(req, fx)).toBe('fine, whatever you say');
  });
});

describe('429', () => {
  it('opens the breaker for Retry-After after a single call', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => new Response('quota exceeded: per minute', { status: 429, headers: { 'Retry-After': '120' } }));
    const p = write(req, f as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    expect(await p).toBeNull();
    // Retry-After above 2 s: no second attempt.
    expect(f).toHaveBeenCalledTimes(1);
    expect(breakerOpen(Date.now() + 100_000)).toBe(true);
    expect(breakerOpen(Date.now() + 130_000)).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[llm] 429 from provider: quota exceeded'));
  });

  it('without Retry-After keeps the old retry and failure counting', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => new Response('slow down', { status: 429 }));
    const p = write(req, f as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    expect(await p).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
    expect(breakerOpen()).toBe(false);
  });
});
