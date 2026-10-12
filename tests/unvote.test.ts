import { describe, expect, it } from 'vitest';
import { RuleError, legalActions, pendingActors, reduce } from '../shared/engine';
import { parseClientMsg } from '../shared/protocol';
import { legalFromView, viewFor } from '../shared/view';
import { act, setup } from './helpers';

function voting() {
  const s = setup(5, { president: 0 });
  return act(s, 0, { type: 'nominate', target: 1 });
}

describe('unvote (todo #274)', () => {
  it('gives a seat that voted only unvote, and keeps it out of pendingActors', () => {
    let s = voting();
    expect(legalActions(s, 2)).toContainEqual({ type: 'vote', ja: true });
    s = act(s, 2, { type: 'vote', ja: true });
    expect(legalActions(s, 2)).toEqual([{ type: 'unvote' }]);
    expect(pendingActors(s)).not.toContain(2);
  });

  it('resets the vote, emits unvoted and lets the seat vote the other way', () => {
    let s = voting();
    s = act(s, 2, { type: 'vote', ja: true });
    const res = reduce(s, { type: 'unvote', seat: 2 });
    expect(res.state.votes[2]).toBeNull();
    expect(res.events).toContainEqual({ k: 'unvoted', seat: 2 });
    expect(pendingActors(res.state)).toContain(2);
    s = act(res.state, 2, { type: 'vote', ja: false });
    expect(s.votes[2]).toBe(false);
  });

  it('still tallies when the last seat votes after an unvote', () => {
    let s = voting();
    for (let i = 0; i < 4; i++) s = act(s, i, { type: 'vote', ja: true });
    s = act(s, 0, { type: 'unvote' });
    s = act(s, 0, { type: 'vote', ja: false });
    expect(s.phase).toBe('vote');
    s = act(s, 4, { type: 'vote', ja: true });
    expect(s.lastVotes).toEqual([false, true, true, true, true]);
    expect(s.phase).not.toBe('vote');
  });

  it('is illegal for a seat that has not voted and once voting has ended', () => {
    let s = voting();
    expect(() => reduce(s, { type: 'unvote', seat: 2 })).toThrow(RuleError);
    for (let i = 0; i < 5; i++) s = act(s, i, { type: 'vote', ja: true });
    expect(s.phase).not.toBe('vote');
    expect(legalActions(s, 2).some((a) => a.type === 'unvote')).toBe(false);
    expect(() => reduce(s, { type: 'unvote', seat: 2 })).toThrow(RuleError);
  });

  it('is offered by legalFromView to a voted seat only', () => {
    let s = voting();
    s = act(s, 2, { type: 'vote', ja: true });
    expect(legalFromView(viewFor(s, 2))).toEqual([{ type: 'unvote' }]);
    expect(legalFromView(viewFor(s, 3))).toContainEqual({ type: 'vote', ja: true });
    expect(legalFromView(viewFor(s, 3)).some((a) => a.type === 'unvote')).toBe(false);
  });

  it('parses over the wire', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'act', a: { type: 'unvote' } }))).toEqual({ t: 'act', a: { type: 'unvote' } });
  });
});
