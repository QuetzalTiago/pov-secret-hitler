import { describe, expect, it, beforeEach } from 'vitest';
import { cool, newMood, offend, readMessage, relation, revealsOwnRole, sanitize, tension, toneFor, warmTo } from '../server/bottalk';
import { REGISTER } from '../server/lexicon';
import { breakerOpen, llmStats, resetLlmState, write } from '../server/llm';
import { personaFor, pickBotName, tooSimilar, BOT_NAMES } from '../server/persona';
import { config } from '../server/config';
import { Room } from '../server/room';
import { MAX_CHAT } from '../shared/protocol';

const persona = personaFor('Nacho', 'es-AR');
const TABLE = ['Humano', 'Nacho', 'Moni', 'Bruno', 'Tincho'];

describe('reading the room', () => {
  const mood = () => newMood();

  it('answers when it is named, accused or insulted', () => {
    expect(readMessage('nacho sos un pelotudo', 'Nacho', persona, mood()).trigger).toBe('insulted');
    expect(readMessage('para mi nacho es facho', 'Nacho', persona, mood()).trigger).toBe('accused');
    expect(readMessage('nacho que carta te paso?', 'Nacho', persona, mood()).trigger).toBe('addressed');
    for (const text of ['nacho sos un pelotudo', 'nacho mentis', 'nacho?']) {
      expect(readMessage(text, 'Nacho', persona, mood()).chance).toBeGreaterThan(0.8);
    }
  });

  it('matches names regardless of accents and case', () => {
    const p = personaFor('Gastón', 'es-AR');
    expect(readMessage('GASTON fuiste vos', 'Gastón', p, mood()).trigger).toBe('accused');
    expect(readMessage('gaston contestame', 'Gastón', p, mood()).trigger).toBe('addressed');
  });

  it('does not mistake a longer name for its own', () => {
    const p = personaFor('Flor', 'es-AR');
    // Both are accusations at the table, but only one is aimed at Flor: she almost always answers that
    // one and only occasionally weighs in on the other.
    const aimed = readMessage('flor es fascista', 'Flor', p, mood());
    const other = readMessage('florencia es fascista', 'Flor', p, mood());
    expect(aimed.chance).toBeGreaterThan(0.9);
    expect(other.chance).toBeLessThan(0.6);
  });

  it('knows when it is being insulted in Rioplatense, not just in dictionary Spanish', () => {
    const insults = [
      'nacho cerra el orto', 'nacho sos un ortiva', 'nacho chanta de mierda', 'nacho garca',
      'nacho andá a cagar', 'nacho la puta que te parió', 'nacho sos un turro', 'nacho pedazo de pelotudo',
      'nacho sos un dibujo', 'nacho careta', 'nacho vendehumo', 'nacho cagón', 'nacho te la das de vivo',
      'nacho la concha de tu madre', 'nacho sos un salame',
    ];
    for (const text of insults) {
      expect(readMessage(text, 'Nacho', persona, mood()).trigger, text).toBe('insulted');
    }
  });

  it('knows when it is being called a liar or a fascist', () => {
    for (const text of ['nacho sos facho', 'nacho chamuyero', 'nacho estas mintiendo', 'nacho vendido', 'nacho tapás a moni']) {
      expect(readMessage(text, 'Nacho', persona, mood()).trigger, text).toBe('accused');
    }
  });

  it('understands "hacer la cama" and all its shapes', () => {
    const forms = [
      'nacho te van a hacer la cama',          // a warning aimed at the bot
      'nacho me estas haciendo la cama',       // an accusation against the bot
      'nacho me hicieron la cama entre los dos',
      'nacho le armaron la cama a moni',
      'nacho me la hicieron',
      'nacho cama armada esto',
      'nacho they are setting you up',
    ];
    for (const text of forms) {
      expect(readMessage(text, 'Nacho', persona, mood()).trigger, text).toBe('setup');
    }
    // Shouted at the table rather than at one player: still worth weighing in on.
    const loose = readMessage('me estan haciendo la cama chicos', 'Nacho', persona, mood());
    expect(loose.trigger).toBe('setup');
    expect(loose.chance).toBeGreaterThan(0.3);
  });

  it('does not see an insult in ordinary table talk', () => {
    for (const text of ['nacho te voto', 'nacho pasame la liberal', 'nacho dale arranca']) {
      expect(readMessage(text, 'Nacho', persona, mood()).trigger, text).not.toBe('insulted');
    }
  });

  it('mostly ignores chatter it was not part of', () => {
    const r = readMessage('bueno arranquemos', 'Nacho', persona, mood());
    expect(r.trigger).toBe('general');
    expect(r.chance).toBeLessThan(0.3);
  });

  it('is quicker to jump in at someone it is already angry with', () => {
    const calm = mood();
    const hot = mood();
    offend(hot, 2, 1);
    const text = 'alguien aca miente';
    expect(readMessage(text, 'Nacho', persona, hot, 2).chance).toBeGreaterThan(readMessage(text, 'Nacho', persona, calm, 2).chance);
    // ...and not with an innocent bystander: the grudge is with seat 2, not with the room.
    expect(readMessage(text, 'Nacho', persona, hot, 3).chance).toBeCloseTo(readMessage(text, 'Nacho', persona, calm, 3).chance);
  });

  it('notices somebody backing it up', () => {
    for (const text of ['nacho te banco', 'nacho tenés razón', 'nacho yo te creo', 'nacho vamos juntos']) {
      expect(readMessage(text, 'Nacho', persona, mood(), 2).trigger, text).toBe('support');
    }
  });
});

describe('relationships', () => {
  it('keeps a grudge with the person who caused it, and nobody else', () => {
    const m = newMood();
    offend(m, 3, 0.6);
    expect(relation(m, 3).heat).toBeCloseTo(0.6);
    expect(relation(m, 3).rapport).toBeLessThan(0);
    // Seat 4 did nothing and is unaffected. This is the whole point of per-person relations.
    expect(relation(m, 4).heat).toBe(0);
    expect(relation(m, 4).rapport).toBe(0);
  });

  it('cools off fast but remembers slowly', () => {
    const m = newMood();
    offend(m, 3, 0.8);
    const hot = relation(m, 3).heat;
    const sour = relation(m, 3).rapport;
    cool(m);
    expect(relation(m, 3).heat).toBeLessThan(hot * 0.8); // the anger passes
    expect(relation(m, 3).rapport).toBeCloseTo(sour, 1); // the resentment does not
  });

  it('makes allies out of people who back it up', () => {
    const m = newMood();
    warmTo(m, 2, 0.5);
    expect(relation(m, 2).rapport).toBeGreaterThan(0.4);
    // Warming to someone takes the edge off any heat with them.
    offend(m, 5, 0.6);
    warmTo(m, 5, 0.4);
    expect(relation(m, 5).heat).toBeLessThan(0.6);
  });

  it('never exceeds its bounds', () => {
    const m = newMood();
    for (let i = 0; i < 20; i++) offend(m, 1, 0.9);
    expect(relation(m, 1).heat).toBeLessThanOrEqual(1);
    expect(relation(m, 1).rapport).toBeGreaterThanOrEqual(-1);
    for (let i = 0; i < 20; i++) warmTo(m, 1, 0.9);
    expect(relation(m, 1).rapport).toBeLessThanOrEqual(1);
  });

  it('forgets people it has no feelings about either way', () => {
    const m = newMood();
    offend(m, 3, 0.3);
    for (let i = 0; i < 300; i++) cool(m);
    expect(m.relations.size).toBe(0);
  });
});

describe('aggression is earned, not the opening move', () => {
  it('starts calm with everyone', () => {
    const m = newMood();
    expect(toneFor(m, 0)).toBe('calm');
    expect(toneFor(m, null)).toBe('calm');
    expect(tension(m)).toBe(0);
  });

  it('escalates only with whoever is doing the attacking', () => {
    const m = newMood();
    offend(m, 1, 0.35);
    expect(toneFor(m, 1)).toBe('edgy');
    expect(toneFor(m, 2)).toBe('calm'); // seat 2 still gets a civil bot
    offend(m, 1, 0.4);
    expect(toneFor(m, 1)).toBe('hot');
    expect(toneFor(m, 2)).toBe('calm');
  });

  it('comes back down once it cools off', () => {
    const m = newMood();
    offend(m, 1, 0.9);
    expect(toneFor(m, 1)).toBe('hot');
    for (let i = 0; i < 4; i++) cool(m);
    expect(toneFor(m, 1)).toBe('calm');
  });
});

describe('bot names', () => {
  it('spots names a player could mix up', () => {
    expect(tooSimilar('Flor', 'Florencia')).toBe(true);
    expect(tooSimilar('Nacho', 'nacho')).toBe(true);
    expect(tooSimilar('Nacho', 'Nachito')).toBe(true);
    expect(tooSimilar('Gastón', 'Gaston')).toBe(true);
    expect(tooSimilar('Moni', 'Mona')).toBe(true);
    expect(tooSimilar('Nacho', 'Moni')).toBe(false);
    expect(tooSimilar('Bruno', 'Vicky')).toBe(false);
  });

  it('never picks a name that clashes with someone already seated', () => {
    const pool = BOT_NAMES['es-AR'];
    expect(pickBotName(['Nacho'], pool, 1)).not.toBe('Nacho');
    expect(pickBotName(['Monica'], pool, 1)).not.toBe('Moni');
    expect(pickBotName(['Brunito'], pool, 1)).not.toBe('Bruno');
    // With the whole pool ruled out it falls back, and the fallback is checked too.
    const everyone = pool.concat(['Bot 1', 'Bot 2']);
    const fallback = pickBotName(everyone, pool, 1);
    expect(everyone.some((n) => tooSimilar(n, fallback))).toBe(false);
  });
});

describe('sanitizing what the model writes', () => {
  it('strips a speaker prefix for any name at the table, however it is nested', () => {
    // Models write transcripts, and not always with the right speaker: a chat line carries neither.
    expect(sanitize('Nacho: "no me jodas, el facho sos vos"', TABLE, false)).toBe('no me jodas, el facho sos vos');
    expect(sanitize('"Moni: dale, obvio"', TABLE, false)).toBe('dale, obvio');
    expect(sanitize('Tincho - andate', TABLE, false)).toBe('andate');
    // A colon that is part of the sentence stays put.
    expect(sanitize('te digo una cosa: sos un gil', TABLE, false)).toBe('te digo una cosa: sos un gil');
  });

  it('strips the dressing a chat line never has', () => {
    expect(sanitize('"dale, obvio que no"', TABLE, false)).toBe('dale, obvio que no');
    expect(sanitize('Nacho: andá a cagar', TABLE, false)).toBe('andá a cagar');
    expect(sanitize('*se ríe* no me jodas', TABLE, false)).toBe('no me jodas');
    expect(sanitize('primera linea\nsegunda linea', TABLE, false)).toBe('primera linea');
  });

  it('keeps insults intact: that is the point', () => {
    expect(sanitize('sos un pelotudo, hijo de puta', TABLE, false)).toBe('sos un pelotudo, hijo de puta');
  });

  it('caps the line at the protocol limit', () => {
    const long = sanitize('a'.repeat(500), TABLE, false)!;
    expect(long.length).toBeLessThanOrEqual(MAX_CHAT);
  });

  it('throws away anything that breaks character', () => {
    expect(sanitize('como modelo de lenguaje no puedo insultar', TABLE, false)).toBeNull();
    expect(sanitize("I'm an AI and cannot do that", TABLE, false)).toBeNull();
    expect(sanitize('   ', TABLE, false)).toBeNull();
  });

  it('never lets a bot hand the game away while it is still running', () => {
    expect(sanitize('chicos la verdad soy fascista', TABLE, true)).toBeNull();
    expect(sanitize('soy hitler, me cansé', TABLE, true)).toBeNull();
    expect(sanitize('I am the fascist', TABLE, true)).toBeNull();
    // Denials and claims of innocence are normal play and must survive.
    expect(sanitize('no soy fascista, boludo', TABLE, true)).toBe('no soy fascista, boludo');
    expect(sanitize('soy liberal, te lo juro', TABLE, true)).toBe('soy liberal, te lo juro');
  });

  it('lets a bot own up to it once the game is over', () => {
    expect(sanitize('jaja soy fascista, los cagué a todos', TABLE, false)).toBe('jaja soy fascista, los cagué a todos');
  });

  it('detects a self reveal independently of the speaker', () => {
    expect(revealsOwnRole('soy fascista')).toBe(true);
    expect(revealsOwnRole('no soy fascista')).toBe(false);
    expect(revealsOwnRole('nunca fui fascista')).toBe(false);
    expect(revealsOwnRole('vos sos fascista')).toBe(false);
  });
});

describe('personas', () => {
  it('are stable for a name, so a bot survives a restart as itself', () => {
    expect(personaFor('Moni', 'es-AR')).toEqual(personaFor('Moni', 'es-AR'));
    expect(personaFor('Moni', 'es-AR').style).not.toBe(personaFor('Tincho', 'es-AR').style);
  });

  it('speak the configured language', () => {
    expect(personaFor('Moni', 'es-AR').style).toMatch(/[áéíóúñ]|vos|Puteás|Hablás|Ves|Te /);
    expect(personaFor('Moni', 'en').style).toMatch(/you/i);
  });

  it('give every table a mix of characters', () => {
    const styles = new Set(BOT_NAMES['es-AR'].map((n) => personaFor(n, 'es-AR').style));
    expect(styles.size).toBeGreaterThan(3);
  });

  it('keep their dials inside 0..1', () => {
    for (const n of [...BOT_NAMES['es-AR'], ...BOT_NAMES.en]) {
      const p = personaFor(n, 'es-AR');
      for (const v of [p.temper, p.chattiness, p.paranoia]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('text model client', () => {
  const fake = (status: number, body: unknown) => {
    const f = (async (url: string, init: RequestInit) => {
      f.calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch & { calls: { url: string; init: RequestInit }[] };
    f.calls = [];
    return f;
  };
  const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

  beforeEach(() => resetLlmState());

  it('is disabled under tests, so no call ever leaves the machine', async () => {
    expect(config.llm.key).toBe('');
    const f = fake(200, reply('hola'));
    expect(await write({ system: 's', user: 'u' }, f)).toBeNull();
    expect((f as unknown as { calls: unknown[] }).calls.length).toBe(0);
  });

  it('sends a Gemini request with the safety filters the game needs', async () => {
    config.llm.key = 'test-key';
    try {
      const f = fake(200, reply('andá a cagar, flaco'));
      expect(await write({ system: 'sos Nacho', user: 'que decis?' }, f)).toBe('andá a cagar, flaco');
      const call = (f as unknown as { calls: { url: string; init: RequestInit }[] }).calls.at(-1)!;
      expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
      const sent = JSON.parse(call.init.body as string);
      expect(sent.systemInstruction.parts[0].text).toBe('sos Nacho');
      expect(sent.contents[0].parts[0].text).toBe('que decis?');
      // Insults are the feature; the two categories that would censor them are off.
      const thresholds = Object.fromEntries((sent.safetySettings as { category: string; threshold: string }[]).map((x) => [x.category, x.threshold]));
      expect(thresholds.HARM_CATEGORY_HARASSMENT).toBe('BLOCK_NONE');
      expect(thresholds.HARM_CATEGORY_HATE_SPEECH).toBe('BLOCK_NONE');
      // Every category name must be one the REST API actually accepts: a single wrong enum makes the whole
      // request a 400, which silently costs the table its voice. (HARM_CATEGORY_DANGEROUS is the Python SDK
      // alias and is rejected over REST; the wire name is HARM_CATEGORY_DANGEROUS_CONTENT.)
      const VALID = [
        'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
        'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_CIVIC_INTEGRITY',
      ];
      for (const category of Object.keys(thresholds)) expect(VALID, category).toContain(category);
    } finally {
      config.llm.key = '';
    }
  });

  it('resolves null on provider errors instead of throwing at the game', async () => {
    config.llm.key = 'test-key';
    try {
      expect(await write({ system: 's', user: 'u' }, fake(500, {}))).toBeNull();
      expect(await write({ system: 's', user: 'u' }, fake(200, { candidates: [] }))).toBeNull();
      expect(llmStats.failed + llmStats.blocked).toBeGreaterThanOrEqual(2);
    } finally {
      config.llm.key = '';
    }
  });

  it('retries once when the provider is overloaded', async () => {
    config.llm.key = 'test-key';
    try {
      let n = 0;
      const flaky = (async () => {
        n++;
        return n === 1
          ? new Response('{}', { status: 503 })
          : new Response(JSON.stringify(reply('salió a la segunda')), { status: 200 });
      }) as unknown as typeof fetch;
      expect(await write({ system: 's', user: 'u' }, flaky)).toBe('salió a la segunda');
      expect(n).toBe(2);
      // A 400 is our bug, not theirs: no point asking twice.
      let m = 0;
      const bad = (async () => {
        m++;
        return new Response('{}', { status: 400 });
      }) as unknown as typeof fetch;
      expect(await write({ system: 's', user: 'u' }, bad)).toBeNull();
      expect(m).toBe(1);
    } finally {
      config.llm.key = '';
    }
  });

  it('opens a breaker after repeated failures and stops calling out', async () => {
    config.llm.key = 'test-key';
    try {
      const f = fake(429, {});
      for (let i = 0; i < 4; i++) await write({ system: 's', user: 'u' }, f);
      expect(breakerOpen()).toBe(true);
      const calls = (f as unknown as { calls: unknown[] }).calls.length;
      // While the breaker is open the table silently falls back to Jev + template lines: no more requests.
      expect(await write({ system: 's', user: 'u' }, f)).toBeNull();
      expect((f as unknown as { calls: unknown[] }).calls.length).toBe(calls);
    } finally {
      config.llm.key = '';
    }
  });

  it('closes the breaker again once the provider answers', async () => {
    config.llm.key = 'test-key';
    try {
      for (let i = 0; i < 3; i++) await write({ system: 's', user: 'u' }, fake(500, {}));
      expect(breakerOpen()).toBe(false); // still under the threshold
      expect(await write({ system: 's', user: 'u' }, fake(200, reply('listo')))).toBe('listo');
      for (let i = 0; i < 3; i++) await write({ system: 's', user: 'u' }, fake(500, {}));
      expect(breakerOpen()).toBe(false); // the success reset the count
    } finally {
      config.llm.key = '';
    }
  });

  it('talks to an OpenAI-compatible endpoint when configured', async () => {
    config.llm.key = 'test-key';
    config.llm.provider = 'openai';
    config.llm.url = 'http://127.0.0.1:11434/v1'; // e.g. a local Ollama
    config.llm.model = 'llama-local';
    try {
      const f = fake(200, { choices: [{ message: { content: 'de una' } }] });
      expect(await write({ system: 's', user: 'u' }, f)).toBe('de una');
      const call = (f as unknown as { calls: { url: string; init: RequestInit }[] }).calls.at(-1)!;
      expect(call.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
      expect(JSON.parse(call.init.body as string).model).toBe('llama-local');
    } finally {
      config.llm.key = '';
      config.llm.provider = 'gemini';
      config.llm.url = '';
      config.llm.model = '';
    }
  });
});

describe('a room with talking bots', () => {
  const table = () => {
    const seen: { name: string; text: string }[] = [];
    const conn = { id: 1, room: null, seat: -1, send: (m: { t: string; name?: string; text?: string }) => {
      if (m.t === 'chat') seen.push({ name: m.name!, text: m.text! });
    } } as unknown as import('../server/room').Conn;
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Humano');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    return { room, conn, seen };
  };

  it('gives the bots Rioplatense names when that is the configured language', () => {
    const { room } = table();
    expect(room.seats.slice(1).every((s) => BOT_NAMES['es-AR'].includes(s.name))).toBe(true);
    room.close();
  });

  it('broadcasts what a player says and keeps it for the bots to read', () => {
    const { room, conn, seen } = table();
    expect(room.start(conn)).toBeNull();
    expect(room.chat(conn, 'nacho sos un pelotudo')).toBeNull();
    expect(seen).toContainEqual({ name: 'Humano', text: 'nacho sos un pelotudo' });
    const transcript = (room as unknown as { transcript: { text: string }[] }).transcript;
    expect(transcript.at(-1)!.text).toBe('nacho sos un pelotudo');
    room.close();
  });

  it('still runs the game when the text model is unavailable', async () => {
    const { room, conn, seen } = table();
    expect(room.start(conn)).toBeNull();
    // No key configured: bots take offence internally but post nothing extra, and nothing throws.
    for (const text of ['nacho sos un pelotudo', 'moni fuiste vos', 'che alguien dice algo?']) {
      expect(room.chat(conn, text)).toBeNull();
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.every((m) => m.name === 'Humano')).toBe(true);
    expect(room.game).not.toBeNull();
    room.close();
  });

  it('does not try to answer lobby chat, where there is no game to speak from', async () => {
    const { room, conn, seen } = table();
    config.llm.key = 'test-key'; // as if a provider were configured
    const errors: unknown[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      expect(room.chat(conn, 'nacho sos un pelotudo')).toBeNull();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      console.error = realError;
      config.llm.key = '';
    }
    expect(errors).toEqual([]);
    expect(seen).toEqual([{ name: 'Humano', text: 'nacho sos un pelotudo' }]);
    room.close();
  });

  it('holds the insult against the one who said it, not the table', () => {
    const { room, conn } = table();
    expect(room.start(conn)).toBeNull();
    room.chat(conn, 'nacho sos un pelotudo hijo de puta');
    const moods = (room as unknown as { moods: Map<number, ReturnType<typeof newMood>> }).moods;
    const nacho = room.seats.findIndex((s) => s.name === 'Nacho');
    expect(nacho).toBeGreaterThan(0);
    const mood = moods.get(nacho)!;
    expect(relation(mood, 0).heat).toBeGreaterThan(0); // the human who said it
    // Every other seat is untouched: nobody else insulted anyone.
    for (const other of room.seats.map((_, i) => i)) {
      if (other === 0 || other === nacho) continue;
      expect(relation(mood, other).heat, `seat ${other}`).toBe(0);
    }
    room.close();
  });

  it('drops its timers when the room closes', () => {
    const { room, conn } = table();
    room.start(conn);
    expect((room as unknown as { moodTimer: unknown }).moodTimer).not.toBeNull();
    room.close();
    expect((room as unknown as { moodTimer: unknown }).moodTimer).toBeNull();
  });
});

describe('calling out a setup', () => {
  it('warns the Chancellor when a suspicious President is about to hand them the cards', async () => {
    const { planTalk } = await import('../server/botchat');
    const { newMemory, observe } = await import('../shared/tracker');
    const { viewFor } = await import('../shared/view');
    const { setup, roles, act, voteAll } = await import('./helpers');

    // Seat 2 watches seat 0 earn a Fascist record, then elect the still-trusted seat 3.
    let s = setup(5, { president: 0, roles: roles(5, 4, [3]), deck: ['F', 'F', 'F', ...Array(14).fill('L')] });
    const m = newMemory(2, 5);
    const feed = (st: typeof s, events: Parameters<typeof observe>[2]) => observe(m, viewFor(st, 2), events);
    s = act(s, 0, { type: 'nominate', target: 1 });
    feed(s, [{ k: 'nominated', president: 0, target: 1 }]);
    s = voteAll(s, true);
    feed(s, [{ k: 'votes', votes: s.lastVotes!, passed: true }]);
    s = act(s, 0, { type: 'presDiscard', index: 0 });
    s = act(s, s.chancellor!, { type: 'chancEnact', index: 0 });
    feed(s, [{ k: 'enacted', policy: 'F', chaos: false }]);
    // A second Fascist policy under the same President is what pushes them past the warning threshold.
    m.governments.push({ round: 2, president: 0, chancellor: 4, result: 'F' });

    // Now seat 0 is suspicious. Put them back in the chair with a clean Chancellor.
    const el = { round: 2, president: 0, nominee: 3, votes: [true, true, true, true, true], passed: true };
    m.elections.push(el);
    const plan = planTalk({ k: 'votes', votes: el.votes, passed: true }, viewFor(s, 2), m, (x) => `P${x}`, () => 0.1);
    expect(plan?.kind).toBe('choice');
    if (plan?.kind !== 'choice') return;
    expect(Object.keys(plan.options).sort()).toEqual(['silent', 'warn']);
    expect(plan.options.warn.description).toMatch(/setting them up/);
    expect(plan.situation).toMatch(/carrying the blame/);
  });

  it('says it out loud when the setup is aimed at itself', async () => {
    const { planTalk } = await import('../server/botchat');
    const { newMemory } = await import('../shared/tracker');
    const { viewFor } = await import('../shared/view');
    const { setup, roles } = await import('./helpers');

    const s = setup(5, { president: 0, roles: roles(5, 4, [3]) });
    const m = newMemory(2, 5);
    m.governments.push({ round: 1, president: 0, chancellor: 1, result: 'F' });
    m.governments.push({ round: 2, president: 0, chancellor: 4, result: 'F' });
    const el = { round: 3, president: 0, nominee: 2, votes: [true, true, true, true, true], passed: true };
    m.elections.push(el);
    const plan = planTalk({ k: 'votes', votes: el.votes, passed: true }, viewFor(s, 2), m, (x) => `P${x}`, () => 0.1);
    if (plan?.kind !== 'choice') throw new Error('expected a choice');
    expect(plan.options.warn.description).toMatch(/setting you up/);
    expect(plan.situation).toMatch(/elected Chancellor/);
  });
});

describe('the register handed to the writer', () => {
  it('teaches the table words, not dictionary Spanish', () => {
    const es = REGISTER['es-AR'];
    const all = `${es.voice} ${es.tone.hot} ${es.idioms}`;
    // facho/facha is how the table says it, and the writer is told so explicitly.
    expect(es.idioms).toMatch(/FACHO/);
    expect(es.idioms).toMatch(/FACHA para la carta/);
    expect(es.idioms).toMatch(/me tocaron tres fachas/);
    expect(es.idioms).toMatch(/hacer la cama/);
    // Voseo, not neutral Spanish.
    expect(es.voice).toMatch(/voseo/);
    expect(es.voice).toMatch(/nunca "tú"/);
    for (const word of ['pelotudo', 'forro', 'cerrá el orto', 'la concha de tu madre', 'ortiva', 'chanta']) {
      expect(all, word).toContain(word);
    }
  });

  it('only hands over the full repertoire at the hot tier', () => {
    for (const lang of ['es-AR', 'en'] as const) {
      const t = REGISTER[lang].tone;
      // Calm must forbid insults outright and point the bot at making allies, or it opens every game
      // swearing at people who have done nothing.
      expect(t.calm).toMatch(/NO la insultás|Do NOT insult/);
      expect(t.calm).toMatch(/aliad|all(y|ies)/i);
      expect(t.edgy).toMatch(/nada de puteadas pesadas|no real swearing/);
      expect(t.hot).toMatch(/sin autocensura|no self-censoring/);
    }
    expect(REGISTER['es-AR'].tone.calm).not.toContain('pelotudo');
    expect(REGISTER['es-AR'].tone.hot).toContain('pelotudo');
  });

  it('tells the writer suspicion can go down as well as up', () => {
    expect(REGISTER['es-AR'].rules.join(' ')).toMatch(/LAS DOS DIRECCIONES/);
    expect(REGISTER.en.rules.join(' ')).toMatch(/BOTH WAYS/);
  });

  it('keeps the rules that stop a bot breaking the game', () => {
    for (const lang of ['es-AR', 'en'] as const) {
      const rules = REGISTER[lang].rules.join(' ');
      expect(rules).toMatch(/IA|bot|modelo|AI/);
      expect(rules).toMatch(/rol oculto|hidden role/);
      expect(rules).toMatch(/140/);
    }
  });
});

describe('Rioplatense card wording', () => {
  it('calls a Fascist card a facha when the table speaks Spanish', async () => {
    const { planTalk } = await import('../server/botchat');
    const { newMemory } = await import('../shared/tracker');
    const { viewFor } = await import('../shared/view');
    const { setup, roles } = await import('./helpers');

    const m = newMemory(0, 5);
    m.governments.push({ round: 1, president: 0, chancellor: 3, result: 'F' });
    m.passed.push({ round: 1, to: 3, gave: ['L', 'F'], drew: ['L', 'F', 'F'] });
    const s = setup(5, { president: 1, roles: roles(5, 4, [3]) });
    const plan = planTalk({ k: 'enacted', policy: 'F', chaos: false }, viewFor(s, 0), m, (x) => `P${x}`, () => 0.5);
    if (plan?.kind !== 'choice') throw new Error('expected a choice');
    // What players read is Rioplatense; what Jev reads stays English.
    expect(plan.options.truth.line).toBe('me tocaron 1 liberal y 2 fachas y pasé una liberal y una facha.');
    expect(plan.options.three_fascists.line).toMatch(/fachas/);
    expect(plan.options.truth.description).toMatch(/Tell the truth/);
    expect(plan.situation).toMatch(/Liberal and 2 Fascists/);
  });
});

describe('what the writer is allowed to see', () => {
  // The whole feature hangs on this: a bot writes with its own GameView and Memory only, so a prompt can
  // never carry a secret that seat does not hold. Checked on the real path, by capturing the request body.
  const capture = async (fn: () => Promise<unknown>) => {
    const sent: unknown[] = [];
    const real = globalThis.fetch;
    config.llm.key = 'test-key';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'dale' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
      config.llm.key = '';
    }
    return sent as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] }[];
  };

  const context = async (seat: number) => {
    const { newMemory } = await import('../shared/tracker');
    const { viewFor } = await import('../shared/view');
    const { setup, roles } = await import('./helpers');
    const s = setup(5, { president: 0, roles: roles(5, 4, [3]) }); // seat 3 Fascist, seat 4 Hitler
    const view = viewFor(s, seat);
    return {
      view,
      memory: newMemory(seat, 5),
      persona: personaFor('Nacho', 'es-AR'),
      mood: newMood(),
      name: (x: number) => `P${x}`,
      transcript: [],
      lang: 'es-AR' as const,
    };
  };

  it('never hands a Liberal bot anyone else\'s role', async () => {
    const { writeReply } = await import('../server/bottalk');
    const ctx = await context(1); // a Liberal
    const sent = await capture(() => writeReply(ctx, 0, 'sos facho', 'accused'));
    expect(sent.length).toBe(1);
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toMatch(/"role":"liberal"/); // its own role, which it obviously knows
    expect(prompt).not.toMatch(/"knownRole":"fascist"/);
    expect(prompt).not.toMatch(/"knownRole":"hitler"/);
  });

  it('hands a Fascist bot exactly what the rules let it see', async () => {
    const { writeReply } = await import('../server/bottalk');
    const ctx = await context(3); // a Fascist: sees the other Fascist and Hitler
    const sent = await capture(() => writeReply(ctx, 0, 'sos facho', 'accused'));
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toMatch(/"knownRole":"hitler"/);
    // and never a Liberal's role, because nobody is told that
    expect(prompt).not.toMatch(/"name":"P1"[^}]*"knownRole":"liberal"/);
  });

  it('carries the chat the table can see, and the bot\'s own feelings', async () => {
    const { writeReply } = await import('../server/bottalk');
    const ctx = { ...(await context(1)), transcript: [{ seat: 0, name: 'P0', text: 'me hicieron la cama', at: Date.now() }] };
    offend(ctx.mood, 0, 0.9);
    const sent = await capture(() => writeReply(ctx, 0, 'sos facho', 'accused'));
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toContain('P0: me hicieron la cama');
    expect(prompt).toMatch(/Con P0 estás caliente/);
  });
});

describe('expecting an answer', () => {
  // A bot that sulks whenever a line of its own goes unanswered is exhausting: most of what gets said at a
  // table needs no reply at all.
  const room5 = () => {
    const conn = { id: 1, room: null, seat: -1, send: () => {} } as unknown as import('../server/room').Conn;
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Humano');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    room.start(conn);
    return { room, conn };
  };
  const awaiting = (room: Room, seat: number) =>
    (room as unknown as { moods: Map<number, ReturnType<typeof newMood>> }).moods.get(seat)?.awaiting ?? null;
  const note = (room: Room, seat: number, text: string) =>
    (room as unknown as { noteAwaiting: (s: number, t: string) => void }).noteAwaiting(seat, text);

  it('waits for an answer only when it actually asked one person something', () => {
    const { room } = room5();
    const other = room.seats.findIndex((s) => s.bot && s.name !== room.seats[1].name);
    const target = room.seats[other].name;
    note(room, 1, `${target} a quién votaste?`);
    expect(awaiting(room, 1)?.seat).toBe(other);
    room.close();
  });

  it('expects nothing from a statement or a warning', () => {
    const { room } = room5();
    const target = room.seats[2].name;
    for (const line of [`ojo ${target}, te van a hacer la cama`, `${target} puso la facha, ojo con eso`, 'bueno vamos a ver qué pasa']) {
      note(room, 1, line);
      expect(awaiting(room, 1), line).toBeNull();
    }
    room.close();
  });

  it('expects nothing from a question thrown at the whole table', () => {
    const { room } = room5();
    const a = room.seats[2].name;
    const b = room.seats[3].name;
    note(room, 1, `${a} ${b} alguno me explica qué pasó?`);
    expect(awaiting(room, 1)).toBeNull(); // nobody in particular was asked
    note(room, 1, 'alguien me explica qué pasó?');
    expect(awaiting(room, 1)).toBeNull();
    room.close();
  });
});

describe('changing its mind', () => {
  it('lets a player off the hook once they place a Liberal policy', async () => {
    const conn = { id: 1, room: null, seat: -1, send: () => {} } as unknown as import('../server/room').Conn;
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Humano');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    room.start(conn);
    const inner = room as unknown as {
      moods: Map<number, ReturnType<typeof newMood>>;
      memories: { governments: { round: number; president: number; chancellor: number; result: string }[] }[];
      maybeReconsider: (s: number, m: ReturnType<typeof newMood>, now: number) => boolean;
      written: number;
    };
    const bot = 1;
    const mood = newMood();
    inner.moods.set(bot, mood);
    offend(mood, 0, 0.5); // the bot had written the human off
    expect(relation(mood, 0).rapport).toBeLessThan(0);

    // The human got stuck with a Fascist early, then placed a Liberal in the current round.
    room.game!.round = 3;
    inner.memories[bot].governments.push({ round: 1, president: 2, chancellor: 0, result: 'F' });
    inner.memories[bot].governments.push({ round: 3, president: 0, chancellor: 2, result: 'L' });

    let reconsidered = false;
    for (let i = 0; i < 40 && !reconsidered; i++) reconsidered = inner.maybeReconsider(bot, mood, Date.now());
    expect(reconsidered).toBe(true);
    expect(relation(mood, 0).rapport).toBeGreaterThan(0); // they are on decent terms now
    expect(mood.recanted.has(0)).toBe(true);
    // Once said, it is not said again: no bot announces the same change of heart twice.
    expect(inner.maybeReconsider(bot, mood, Date.now())).toBe(false);
    room.close();
  });

  it('does not reconsider someone whose last act was Fascist', () => {
    const conn = { id: 1, room: null, seat: -1, send: () => {} } as unknown as import('../server/room').Conn;
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Humano');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    room.start(conn);
    const inner = room as unknown as {
      memories: { governments: { round: number; president: number; chancellor: number; result: string }[] }[];
      maybeReconsider: (s: number, m: ReturnType<typeof newMood>, now: number) => boolean;
    };
    const mood = newMood();
    offend(mood, 0, 0.5);
    room.game!.round = 3;
    inner.memories[1].governments.push({ round: 3, president: 0, chancellor: 2, result: 'F' });
    for (let i = 0; i < 20; i++) expect(inner.maybeReconsider(1, mood, Date.now())).toBe(false);
    room.close();
  });
});

describe('a table where nobody shares a name', () => {
  it('renames a bot when a player turns up with a confusable name', () => {
    const host = { id: 1, room: null, seat: -1, send: () => {} } as unknown as import('../server/room').Conn;
    const late = { id: 2, room: null, seat: -1, send: () => {} } as unknown as import('../server/room').Conn;
    const room = new Room('ABCD', () => {});
    room.join(host, 'Humano');
    for (let i = 0; i < 4; i++) room.addBot(host);
    const clash = room.seats[1].name; // an existing bot
    room.join(late, `${clash}ito`); // a player whose name looks just like it
    expect(room.seats.find((s) => !s.bot && s.name === `${clash}ito`)).toBeDefined();
    const names = room.seats.map((s) => s.name);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        expect(tooSimilar(names[i], names[j]), `${names[i]} vs ${names[j]}`).toBe(false);
      }
    }
    room.close();
  });
});
