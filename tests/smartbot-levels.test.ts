import { describe, expect, it } from 'vitest';
import { legalActions } from '../shared/engine';
import { buildDecision, LEVELS, LIB } from '../shared/smartbot';
import { newMemory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { act, roles, setup } from './helpers';

const name = (s: number) => `P${s}`;

/** Seven players, three Fascist policies enacted, a Liberal (P1) voting on P2 as Chancellor with no evidence either way. */
function zoneVote() {
  let s = setup(7, { president: 0, roles: roles(7, 6, [5]) });
  s = { ...s, fascist: 3 };
  s = act(s, 0, { type: 'nominate', target: 2 });
  return { v: viewFor(s, 1), legal: legalActions(s, 1), m: newMemory(1, 7) };
}

describe('bot level LIB overrides', () => {
  it('sharp Liberals score a risky Chancellor in the Hitler zone far below normal', () => {
    const { v, legal, m } = zoneVote();
    const normal = buildDecision(v, legal, m, name, { strategy: 'new' });
    const sharp = buildDecision(v, legal, m, name, { strategy: 'new', lib: LEVELS.sharp.lib });
    expect(sharp.options.ja.score).toBeLessThan(normal.options.ja.score - 10);
    expect(sharp.options.ja.score).toBeLessThan(sharp.options.nein.score);
  });

  it('normal and casual carry no overrides', () => {
    expect(LEVELS.normal.lib).toBeUndefined();
    expect(LEVELS.casual.lib).toBeUndefined();
  });

  it('lib overrides do not change LIB', () => {
    const { v, legal, m } = zoneVote();
    buildDecision(v, legal, m, name, { strategy: 'new', lib: LEVELS.sharp.lib });
    expect(LIB.voteHitler).toBe(15);
    expect(LIB.nomHitler).toBe(12);
  });
});
