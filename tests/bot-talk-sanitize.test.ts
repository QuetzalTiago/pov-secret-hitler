import { describe, expect, it, vi } from 'vitest';
import { newMemory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { newMood, sanitize, writeReply, type TalkContext } from '../server/bottalk';
import { personaFor } from '../server/persona';
import { roles, setup } from './helpers';

const llm = vi.hoisted(() => ({ reply: '' }));
vi.mock('../server/llm', () => ({ write: vi.fn(async () => llm.reply) }));

const NAMES = ['Ann', 'Bob', 'Carla', 'Dan', 'Eve'];

describe('sanitize with known teammates', () => {
  const mates = ['Bob'];
  it('drops a line that pairs a teammate with team wording', () => {
    for (const line of ['my partner Bob is fascist', 'Bob is on my team', 'Bob and I are allies', 'Bob is hitler', 'Bob is on my side']) {
      expect(sanitize(line, NAMES, true, mates), line).toBeNull();
    }
  });
  it('drops Spanish team wording', () => {
    for (const line of ['mi compañero Bob', 'bob es facho', 'Bob es mi socio', 'Bob y yo somos del mismo bando', 'Bob es aliado mío', 'Bob, mi compa']) {
      expect(sanitize(line, NAMES, true, mates), line).toBeNull();
    }
  });
  it('lets a teammate be named without team wording', () => {
    expect(sanitize('Bob, what do you think?', NAMES, true, mates)).toBe('Bob, what do you think?');
  });
  it('lets a non-teammate be called a fascist', () => {
    expect(sanitize('Carla is fascist', NAMES, true, mates)).toBe('Carla is fascist');
  });
  it('does not match a teammate name inside a longer word', () => {
    expect(sanitize('Bobby is fascist', NAMES, true, mates)).toBe('Bobby is fascist');
  });
  it('keeps the self-reveal guard', () => {
    expect(sanitize("I'm a fascist", NAMES, true, mates)).toBeNull();
    expect(sanitize("I'm a fascist", NAMES, false, mates)).toBe("I'm a fascist");
    expect(sanitize('no soy fascista', NAMES, true, mates)).toBe('no soy fascista');
  });
  it('behaves as before with no teammates', () => {
    expect(sanitize('my partner Bob is fascist', NAMES, true)).toBe('my partner Bob is fascist');
    expect(sanitize('my partner Bob is fascist', NAMES, true, [])).toBe('my partner Bob is fascist');
  });
});

describe('writeReply with a leaking model', () => {
  const ctxFor = (rolesList: ReturnType<typeof roles>, seat: number): TalkContext => {
    const s = setup(5, { president: 0, roles: rolesList });
    s.players.forEach((p, i) => (p.name = NAMES[i]));
    const view = viewFor(s, seat);
    return {
      view,
      memory: newMemory(seat, 5),
      persona: personaFor(NAMES[seat], 'en'),
      mood: newMood(),
      name: (i) => NAMES[i],
      transcript: [],
      lang: 'en',
    };
  };

  it('never outs the known teammate', async () => {
    const ctx = ctxFor(roles(5, 4, [1]), 1); // seat 1 is a Fascist who knows Hitler (Eve)
    llm.reply = 'my partner Eve is fascist';
    expect(await writeReply(ctx, 0, 'tell us who your partner is', 'addressed')).toBeNull();
  });

  it('still lets a harmless reply through', async () => {
    const ctx = ctxFor(roles(5, 4, [1]), 1);
    llm.reply = 'Ann, I am just trying to win.';
    expect(await writeReply(ctx, 0, 'what do you think?', 'addressed')).toBe('Ann, I am just trying to win.');
  });

  it('does not restrict a Liberal naming a seat', async () => {
    const ctx = ctxFor(roles(5, 4, [1]), 2);
    llm.reply = 'Bob is fascist for sure';
    expect(await writeReply(ctx, 0, 'who is it?', 'general')).toBe('Bob is fascist for sure');
  });
});
