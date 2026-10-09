import { describe, expect, it, beforeEach } from 'vitest';
import { bump, cool, newMood, readMessage, revealsOwnRole, sanitize } from '../server/bottalk';
import { REGISTER } from '../server/lexicon';
import { breakerOpen, llmStats, resetLlmState, write } from '../server/llm';
import { personaFor, BOT_NAMES } from '../server/persona';
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

  it('an angry bot is quicker to jump in', () => {
    const calm = mood();
    const hot = mood();
    hot.anger = 1;
    const text = 'alguien aca miente';
    expect(readMessage(text, 'Nacho', persona, hot).chance).toBeGreaterThan(readMessage(text, 'Nacho', persona, calm).chance);
  });
});

describe('mood', () => {
  it('builds and decays anger and grudges', () => {
    const m = newMood();
    bump(m, 3, 0.5);
    expect(m.grudge.get(3)).toBeCloseTo(0.5);
    expect(m.anger).toBeGreaterThan(0);
    const before = m.anger;
    cool(m);
    expect(m.anger).toBeLessThan(before);
    // Anger fades fast, resentment does not.
    expect(m.grudge.get(3)!).toBeGreaterThan(0.4);
    for (let i = 0; i < 200; i++) cool(m);
    expect(m.grudge.size).toBe(0);
  });

  it('never exceeds its bounds', () => {
    const m = newMood();
    for (let i = 0; i < 20; i++) bump(m, 1, 0.9);
    expect(m.anger).toBeLessThanOrEqual(1);
    expect(m.grudge.get(1)).toBeLessThanOrEqual(1);
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

  it('remembers who insulted it', () => {
    const { room, conn } = table();
    expect(room.start(conn)).toBeNull();
    room.chat(conn, 'nacho sos un pelotudo hijo de puta');
    const moods = (room as unknown as { moods: Map<number, { grudge: Map<number, number> }> }).moods;
    const nacho = room.seats.findIndex((s) => s.name === 'Nacho');
    expect(nacho).toBeGreaterThan(0);
    expect(moods.get(nacho)!.grudge.get(0)).toBeGreaterThan(0);
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
    const all = `${es.voice} ${es.swearing} ${es.idioms}`;
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
    const sent = await capture(() => writeReply(ctx, 'P0', 'sos facho', 'accused'));
    expect(sent.length).toBe(1);
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toMatch(/"role":"liberal"/); // its own role, which it obviously knows
    expect(prompt).not.toMatch(/"knownRole":"fascist"/);
    expect(prompt).not.toMatch(/"knownRole":"hitler"/);
  });

  it('hands a Fascist bot exactly what the rules let it see', async () => {
    const { writeReply } = await import('../server/bottalk');
    const ctx = await context(3); // a Fascist: sees the other Fascist and Hitler
    const sent = await capture(() => writeReply(ctx, 'P0', 'sos facho', 'accused'));
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toMatch(/"knownRole":"hitler"/);
    // and never a Liberal's role, because nobody is told that
    expect(prompt).not.toMatch(/"name":"P1"[^}]*"knownRole":"liberal"/);
  });

  it('carries the chat the table can see, and the bot\'s own feelings', async () => {
    const { writeReply } = await import('../server/bottalk');
    const ctx = { ...(await context(1)), transcript: [{ seat: 0, name: 'P0', text: 'me hicieron la cama', at: Date.now() }] };
    bump(ctx.mood, 0, 0.9);
    const sent = await capture(() => writeReply(ctx, 'P0', 'sos facho', 'accused'));
    const prompt = sent[0].contents[0].parts[0].text;
    expect(prompt).toContain('P0: me hicieron la cama');
    expect(prompt).toMatch(/Le tenés bronca a P0/);
    expect(prompt).toMatch(/caliente|picado/);
  });
});
