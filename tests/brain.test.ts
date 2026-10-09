import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decide } from '../server/brain';
import { askChoice, jevStats } from '../server/jev';
import { config } from '../server/config';
import { legalActions, reduce } from '../shared/engine';
import { buildDecision } from '../shared/smartbot';
import { newMemory, observe, profiles } from '../shared/tracker';
import type { GameState } from '../shared/types';
import { viewFor } from '../shared/view';
import { act, roles, setup, voteAll } from './helpers';

const name = (s: number) => `P${s}`;

/** Plays one government (nominate, all Ja, legislate) while feeding every seat's memory. */
function playGov(s: GameState, mems: ReturnType<typeof newMemory>[], chancellor: number, presDiscard: number, chancEnact: number) {
  const step = (seat: number, body: object) => {
    const r = reduce(s, { ...body, seat } as never);
    s = r.state;
    mems.forEach((m, i) => observe(m, viewFor(s, i), r.events));
  };
  step(s.president, { type: 'nominate', target: chancellor });
  for (const p of s.players) if (p.alive) step(p.seat, { type: 'vote', ja: true });
  step(s.president, { type: 'presDiscard', index: presDiscard });
  step(s.chancellor!, { type: 'chancEnact', index: chancEnact });
  return s;
}

describe('bot memory', () => {
  it('records governments and blames those who enact Fascist policies', () => {
    let s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]), deck: ['F', 'F', 'F', 'L', 'L', 'L', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'L', 'L', 'L'] });
    const mems = s.players.map((p) => newMemory(p.seat, 7));
    s = playGov(s, mems, 3, 0, 0);
    expect(mems[2].governments).toEqual([{ round: 1, president: 0, chancellor: 3, result: 'F' }]);
    const prof = profiles(mems[2], viewFor(s, 2));
    expect(prof[3].suspicion).toBeGreaterThan(prof[1].suspicion);
    expect(prof[3].fascistAsChancellor).toBe(1);
  });

  it('turns a betrayal it witnessed first-hand into hard evidence', () => {
    let s = setup(5, { president: 0, roles: roles(5, 4, [3]), deck: ['L', 'F', 'F', ...Array(14).fill('L')] });
    const mems = s.players.map((p) => newMemory(p.seat, 5));
    // President 0 (Liberal) discards F and passes L+F; chancellor 3 (Fascist) enacts F.
    s = act(s, 0, { type: 'nominate', target: 3 });
    mems.forEach((m, i) => observe(m, viewFor(s, i), [{ k: 'nominated', president: 0, target: 3 }]));
    const v = voteAll(s, true);
    mems.forEach((m, i) => observe(m, viewFor(v, i), [{ k: 'votes', votes: v.lastVotes!, passed: true }]));
    s = v;
    const presView = viewFor(s, 0);
    // Record what the president passed (as the brain does when it acts).
    const r1 = reduce(s, { seat: 0, type: 'presDiscard', index: 1 });
    mems[0].passed.push({ round: presView.round, to: 3, gave: ['L', 'F'] });
    s = r1.state;
    const r2 = reduce(s, { seat: 3, type: 'chancEnact', index: 1 });
    s = r2.state;
    mems.forEach((m, i) => observe(m, viewFor(s, i), r2.events));
    const prof = profiles(mems[0], viewFor(s, 0));
    expect(prof[3].suspicion).toBeGreaterThanOrEqual(5);
    expect(prof[3].proof.join()).toMatch(/passed them a Liberal/);
  });
});

describe('Jev decision payload', () => {
  it('only contains what the bot is allowed to know', () => {
    const s = setup(7, { president: 1, roles: roles(7, 6, [5, 4]) });
    const v = viewFor(s, 1); // a Liberal president
    const d = buildDecision(v, legalActions(s, 1), newMemory(1, 7), name);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/known (FASCIST|HITLER|fascist|hitler)/);
    expect((d.state.players as { knownRole: string }[]).every((p) => p.knownRole === 'unknown')).toBe(true);
    expect(d.state.myCards).toBeUndefined();
    expect(Object.keys(d.options).sort()).toEqual(legalActions(s, 1).map((a) => `p${(a as { target: number }).target}`).sort());
  });

  it('includes what each player placed in earlier rounds', () => {
    let s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]), deck: ['F', 'F', 'F', ...Array(14).fill('L')] });
    const mems = s.players.map((p) => newMemory(p.seat, 7));
    s = playGov(s, mems, 3, 0, 0);
    const pres = s.president; // seat 1 is now President and must nominate
    const d = buildDecision(viewFor(s, pres), legalActions(s, pres), mems[pres], name);
    const players = d.state.players as { name: string; policiesPlaced: string[] }[];
    expect(players.find((p) => p.name === 'P3')!.policiesPlaced).toEqual(['Round 1, as Chancellor with President P0: placed a FASCIST policy']);
    expect(players.find((p) => p.name === 'P0')!.policiesPlaced).toEqual(['Round 1, as President with Chancellor P3: placed a FASCIST policy']);
    expect(players.find((p) => p.name === 'P2')!.policiesPlaced).toEqual([]);
  });

  it('a Fascist bot sees its teammates and Hitler, and only legal options', () => {
    const s = setup(7, { president: 4, roles: roles(7, 6, [5, 4]) });
    const v = viewFor(s, 4);
    const d = buildDecision(v, legalActions(s, 4), newMemory(4, 7), name);
    const known = (d.state.players as { name: string; knownRole: string }[]).filter((p) => p.knownRole !== 'unknown');
    expect(known.map((p) => `${p.name}:${p.knownRole}`).sort()).toEqual(['P5:fascist', 'P6:hitler']);
  });
});

describe('brain', () => {
  const state = () => setup(5, { president: 0, roles: roles(5, 4, [3]) });

  it('plays the option Jev picks', async () => {
    const s = state();
    const r = await decide(viewFor(s, 0), legalActions(s, 0), newMemory(0, 5), name, () => 0, async (_st, _ins, criteria) => {
      expect(Object.keys(criteria)).toContain('p2');
      return { choice: 'p2', probabilities: { p2: 0.9, p1: 0.1 }, confidence: 0.9 };
    });
    expect(r).toEqual({ action: { type: 'nominate', target: 2 }, source: 'jev' });
  });

  it('falls back to the built-in strategy when Jev fails or answers nonsense', async () => {
    const s = state();
    const legal = legalActions(s, 0);
    const failed = await decide(viewFor(s, 0), legal, newMemory(0, 5), name, Math.random, async () => null);
    expect(failed.source).toBe('heuristic');
    expect(legal).toContainEqual(failed.action);
    const bogus = await decide(viewFor(s, 0), legal, newMemory(0, 5), name, Math.random, async () => ({ choice: 'p99', probabilities: { p99: 1 }, confidence: 1 }));
    expect(bogus.source).toBe('heuristic');
    expect(legal).toContainEqual(bogus.action);
  });

  it('a Liberal president discards a Fascist policy with the built-in strategy', async () => {
    let s = setup(5, { president: 0, roles: roles(5, 4, [3]), deck: ['L', 'F', 'L', ...Array(14).fill('F')] });
    s = act(s, 0, { type: 'nominate', target: 1 });
    s = voteAll(s, true);
    for (let i = 0; i < 20; i++) {
      const r = await decide(viewFor(s, 0), legalActions(s, 0), newMemory(0, 5), name, Math.random, async () => null);
      expect(r.action).toEqual({ type: 'presDiscard', index: 1 });
    }
  });

  it('never asks Jev for trivial moves', async () => {
    const s = setup(5, {});
    let asked = false;
    const night = { ...s, phase: 'night' as const, nightAcks: s.nightAcks.map(() => false) };
    const r = await decide(viewFor(night, 0), legalActions(night, 0), newMemory(0, 5), name, Math.random, async () => {
      asked = true;
      return null;
    });
    expect(asked).toBe(false);
    expect(r.action).toEqual({ type: 'ack' });
  });
});

describe('Jev client', () => {
  const fake = (status: number, body: unknown) =>
    (async (url: string, init: RequestInit) => {
      fake.calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  fake.calls = [] as { url: string; init: RequestInit }[];

  it('is disabled under tests (no paid calls)', async () => {
    expect(config.jev.key).toBe('');
    expect(await askChoice({}, 'q', { a: 'A', b: 'B' }, fake(200, {}))).toBeNull();
    expect(fake.calls.length).toBe(0);
  });

  it('sends the documented request and parses the answer', async () => {
    config.jev.key = 'test-key';
    try {
      const ok = await askChoice({ x: 1 }, 'pick', { a: 'A', b: 'B' }, fake(200, { answers: { decision: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.7 } }, usage: { input_tokens: 50 } }));
      expect(ok).toEqual({ choice: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.7 });
      const call = fake.calls.at(-1)!;
      expect(call.url).toBe('https://api.typesafe.ai/v1/systemone');
      expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      const sent = JSON.parse(call.init.body as string);
      expect(sent).toEqual({ model: 'jev-latest', state: { x: 1 }, questions: { decision: { type: 'choice', instructions: 'pick', criteria: { a: 'A', b: 'B' } } } });
      // Errors and malformed answers resolve to null (caller falls back).
      expect(await askChoice({}, 'q', { a: 'A' }, fake(500, {}))).toBeNull();
      expect(await askChoice({}, 'q', { a: 'A' }, fake(200, { answers: { decision: { choice: 'zzz' } } }))).toBeNull();
      expect(jevStats.failed).toBeGreaterThanOrEqual(2);
    } finally {
      config.jev.key = '';
    }
  });
});

describe('table talk', () => {
  // Imported lazily so the module graph matches the server's.
  const load = () => import('../server/botchat');

  // What a bot types follows SH_BOT_LANG; what Jev reads is always English. These tests pin the English
  // wording, so set the language explicitly rather than riding on whatever the default happens to be.
  beforeEach(() => {
    config.llm.lang = 'en';
  });
  afterEach(() => {
    config.llm.lang = 'es-AR';
  });

  it('a Liberal President betrayed by the Chancellor blames them (built-in fallback)', async () => {
    const { planTalk, heuristicTalk } = await load();
    const m = newMemory(0, 5);
    m.governments.push({ round: 1, president: 0, chancellor: 3, result: 'F' });
    m.passed.push({ round: 1, to: 3, gave: ['L', 'F'], drew: ['L', 'F', 'F'] });
    const s = setup(5, { president: 1, roles: roles(5, 4, [3]) });
    const plan = planTalk({ k: 'enacted', policy: 'F', chaos: false }, viewFor(s, 0), m, name, () => 0.5)!;
    expect(plan.kind).toBe('choice');
    if (plan.kind !== 'choice') return;
    expect(Object.keys(plan.options).sort()).toEqual(['blame_partner', 'silent', 'three_fascists', 'truth']);
    for (let i = 0; i < 20; i++) expect(heuristicTalk(plan.options, Math.random)).toBe('blame_partner');
    expect(plan.options.blame_partner.line).toBe('I passed P3 a Liberal. They chose Fascist. Remember that.');
    // The same plan at a Rioplatense table: the player-facing line changes, the strategy does not.
    config.llm.lang = 'es-AR';
    const es = planTalk({ k: 'enacted', policy: 'F', chaos: false }, viewFor(s, 0), m, name, () => 0.5)!;
    if (es.kind !== 'choice') throw new Error('expected a choice');
    expect(es.options.blame_partner.line).toBe('a P3 le pasé una liberal y eligió la facha. Acordate de esto.');
    expect(es.options.blame_partner.description).toBe(plan.options.blame_partner.description);
    // The request carries no hidden roles for a Liberal speaker.
    expect(JSON.stringify(plan.state)).not.toMatch(/"knownRole":"(fascist|hitler)"/);
  });

  it('investigation claims: Liberals tell the truth, Fascists may lie', async () => {
    const { planTalk, heuristicTalk } = await load();
    const s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]) });
    const lib = newMemory(0, 7);
    lib.known.set(4, 'fascist');
    const libPlan = planTalk({ k: 'investigated', by: 0, target: 4 }, viewFor(s, 0), lib, name, Math.random)!;
    if (libPlan.kind !== 'choice') throw new Error('expected a choice');
    for (let i = 0; i < 20; i++) expect(heuristicTalk(libPlan.options, Math.random)).toBe('fascist');

    const fas = newMemory(5, 7);
    fas.known.set(1, 'liberal');
    const fasPlan = planTalk({ k: 'investigated', by: 5, target: 1 }, viewFor(s, 5), fas, name, Math.random)!;
    if (fasPlan.kind !== 'choice') throw new Error('expected a choice');
    expect(fasPlan.instructions).toMatch(/may lie/);
    expect(Object.keys(fasPlan.options).sort()).toEqual(['fascist', 'liberal']);
  });

  it('small talk needs no Jev call', async () => {
    const { planTalk } = await load();
    const s = setup(5, { president: 0 });
    const plan = planTalk({ k: 'executed', by: 2, target: 1 }, viewFor(s, 2), newMemory(2, 5), name, () => 0);
    expect(plan).toMatchObject({ kind: 'line', line: 'Sorry, P1.' });
    config.llm.lang = 'es-AR';
    expect(planTalk({ k: 'executed', by: 2, target: 1 }, viewFor(s, 2), newMemory(2, 5), name, () => 0)).toMatchObject({ line: 'perdón, P1.' });
    // The situation travels with the plan so bottalk.ts can write the line in character.
    expect((plan as { situation: string }).situation).toContain('P1');
  });
});
