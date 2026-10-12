import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '..', 'client', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selectors { body }` rule at any nesting level (media blocks only add an outer brace). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim().split('\n').pop()!.trim()),
  body: m[2],
}));

function bodies(selector: string): string[] {
  return rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
}

function fontSize(selector: string): string {
  return bodies(selector).join(';').match(/font-size:\s*([^;]*)/)?.[1] ?? '';
}

describe('windowed viewport fit', () => {
  for (const sel of ['#home', '#room', '#gameover', '#confirm-leave', '.panel.wide']) {
    it(`${sel} caps at 100dvh and scrolls`, () => {
      expect(bodies(sel).some((b) => /max-height:[^;]*100dvh/.test(b) && /overflow-y:\s*auto/.test(b))).toBe(true);
    });
  }

  it('panel children do not shrink', () => {
    expect(bodies('.panel > *').some((b) => /flex-shrink:\s*0/.test(b))).toBe(true);
  });

  it('no max-height uses 100vh', () => {
    expect(css).not.toMatch(/max-height:[^;]*100vh/);
  });

  for (const sel of ['#enact-title', '#enact-masthead', '#victory-title', '#victory-masthead']) {
    it(`${sel} font-size is height-aware`, () => {
      expect(fontSize(sel)).toMatch(/min\(.*vh/);
    });
  }

  it('has a short-height media block for the chat log', () => {
    expect(css).toMatch(/@media \(max-height: 720px\)\s*\{\s*#chat-log/);
  });

  it('the action card caps at 100dvh and scrolls instead of clipping', () => {
    expect(bodies('#prompt').some((b) => /max-height:[^;]*100dvh/.test(b) && /overflow-y:\s*auto/.test(b))).toBe(true);
    expect(bodies('#prompt').join(';')).not.toMatch(/overflow:\s*hidden/);
  });

  it('the action card goes compact on short screens', () => {
    expect(css).toMatch(/@media \(max-height: 720px\)\s*\{[^@]*#prompt\.mine::before\s*\{\s*display:\s*none/);
  });
});
