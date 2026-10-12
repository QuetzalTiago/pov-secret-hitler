import { describe, expect, it } from 'vitest';
import { nearBottom } from '../client/chatscroll';

describe('nearBottom', () => {
  it('is true at the bottom', () => {
    expect(nearBottom(320, 180, 500)).toBe(true);
  });
  it('is true within the slack', () => {
    expect(nearBottom(300, 180, 500)).toBe(true);
  });
  it('is false when scrolled up beyond the slack', () => {
    expect(nearBottom(200, 180, 500)).toBe(false);
  });
  it('is true when the content is shorter than the box', () => {
    expect(nearBottom(0, 180, 120)).toBe(true);
  });
  it('respects a custom slack', () => {
    expect(nearBottom(300, 180, 500, 10)).toBe(false);
    expect(nearBottom(300, 180, 500, 20)).toBe(true);
  });
});
