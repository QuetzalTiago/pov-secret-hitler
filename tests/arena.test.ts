import { describe, expect, it } from 'vitest';
import { playMatch, runArena } from '../scripts/arenacore';

describe('bot arena', () => {
  it.each([5, 7])('old Liberals beat random Liberals at %ip', (n) => {
    const old = runArena('old', 'old', 50, [n])[0];
    const rnd = runArena('random', 'old', 50, [n])[0];
    expect(old.libPct).toBeGreaterThanOrEqual(rnd.libPct + 30);
  });

  it.each([5, 7])('new Liberals beat old Fascists at least as often as old Liberals at %ip', (n) => {
    const old = runArena('old', 'old', 50, [n])[0];
    const nu = runArena('new', 'old', 50, [n])[0];
    expect(nu.libPct).toBeGreaterThanOrEqual(old.libPct - 5);
  });

  it('playMatch is deterministic', () => {
    const a = playMatch(7, 700021, 'old', 'random');
    const b = playMatch(7, 700021, 'old', 'random');
    expect(b).toEqual(a);
  });
});
