import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '..', 'client', 'index.html'), 'utf8');

function openTag(id: string): string {
  const m = html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`));
  if (!m) throw new Error(`#${id} not found in index.html`);
  return m[0];
}

describe('dialog and live-region markup', () => {
  for (const id of ['confirm-leave', 'rules', 'credits', 'gameover', 'victory']) {
    it(`#${id} is a modal dialog`, () => {
      const tag = openTag(id);
      expect(tag).toMatch(/\brole="dialog"/);
      expect(tag).toMatch(/\baria-modal="true"/);
    });
  }

  it('#victory is focusable without a tab stop', () => {
    expect(openTag('victory')).toMatch(/\btabindex="-1"/);
  });

  it('#toasts is a polite live region', () => {
    expect(openTag('toasts')).toMatch(/\baria-live="polite"/);
  });

  it('#chat-log has role log', () => {
    expect(openTag('chat-log')).toMatch(/\brole="log"/);
  });
});
