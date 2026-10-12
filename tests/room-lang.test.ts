import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Room, botLangFor, type Conn } from '../server/room';
import { config } from '../server/config';
import { planTalk } from '../server/botchat';
import { BOT_NAMES, personaFor } from '../server/persona';
import { parseClientMsg, type ServerMsg } from '../shared/protocol';
import { newMemory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { setup } from './helpers';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs, lang: config.llm.lang };

function table(lang?: 'en' | 'es-AR') {
  const msgs: ServerMsg[] = [];
  const conn: Conn = { id: 1, room: null, seat: -1, send: (m) => msgs.push(m) };
  const room = new Room('ABCD', () => {}, lang);
  expect(room.join(conn, 'Human')).toBeNull();
  expect(room.quickStart(conn)).toBeNull();
  const seats = room.snapshot().seats;
  return { room, seats, botNames: seats.filter((s) => s.bot).map((s) => s.name) };
}

describe('per-table bot language', () => {
  beforeEach(() => {
    config.timerScale = 0.001;
    config.botDelayMs = 1_000_000;
    config.llm.lang = 'es-AR';
  });

  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
    config.llm.lang = original.lang;
  });

  it("an 'en' table gets English bot names", () => {
    const { room, botNames } = table('en');
    expect(botNames.length).toBe(6);
    for (const n of botNames) {
      expect(BOT_NAMES.en).toContain(n);
      expect(BOT_NAMES['es-AR']).not.toContain(n);
    }
    room.close();
  });

  it("an 'es-AR' table gets Rioplatense names", () => {
    config.llm.lang = 'en';
    const { room, botNames } = table('es-AR');
    expect(botNames.length).toBe(6);
    for (const n of botNames) {
      expect(BOT_NAMES['es-AR']).toContain(n);
      expect(BOT_NAMES.en).not.toContain(n);
    }
    room.close();
  });

  it("an 'en' table's bots talk in English", () => {
    const { room, seats } = table('en');
    const seat = seats.findIndex((s) => s.bot);
    const talk = (room as unknown as { talk: { personaOf(seat: number): { style: string } } }).talk;
    expect(talk.personaOf(seat).style).toBe(personaFor(seats[seat].name, 'en').style);
    room.close();

    const s = setup(5);
    const chaos = { k: 'enacted', policy: 'F', chaos: true } as const;
    const plan = (lang: 'en' | 'es-AR') => planTalk(chaos, viewFor(s, 0), newMemory(0, 5), (x) => `P${x}`, () => 0.1, lang)!;
    const en = plan('en');
    const es = plan('es-AR');
    if (en.kind !== 'line' || es.kind !== 'line') throw new Error('expected a line');
    expect(en.line).not.toBe(es.line);
  });

  it('snapshot keeps the language; old snapshots default', () => {
    const { room } = table('en');
    const snap = room.snapshot();
    expect(snap.lang).toBe('en');
    const back = Room.restore(snap, () => {});
    expect(back.lang).toBe('en');
    back.close();
    delete snap.lang;
    config.llm.lang = 'en';
    const old = Room.restore(snap, () => {});
    expect(old.lang).toBe('en');
    old.close();
    config.llm.lang = 'es-AR';
    const old2 = Room.restore(snap, () => {});
    expect(old2.lang).toBe('es-AR');
    old2.close();
    room.close();
  });

  it('botLangFor maps the client language', () => {
    expect(botLangFor('en')).toBe('en');
    expect(botLangFor('es')).toBe('es-AR');
    config.llm.lang = 'en';
    expect(botLangFor(undefined)).toBe('en');
    config.llm.lang = 'es-AR';
    expect(botLangFor(undefined)).toBe('es-AR');
  });

  it('the parser keeps a valid lang and drops others without rejecting', () => {
    expect(parseClientMsg('{"t":"create","name":"Ana","lang":"en"}')).toEqual({ t: 'create', name: 'Ana', lang: 'en' });
    expect(parseClientMsg('{"t":"quickStart","name":"Ana","lang":"es"}')).toEqual({ t: 'quickStart', name: 'Ana', lang: 'es' });
    const bad = parseClientMsg('{"t":"create","name":"Ana","lang":"fr"}');
    expect(bad).toEqual({ t: 'create', name: 'Ana' });
    expect(bad).not.toHaveProperty('lang');
    expect(parseClientMsg('{"t":"create","name":"Ana"}')).toEqual({ t: 'create', name: 'Ana' });
  });
});
