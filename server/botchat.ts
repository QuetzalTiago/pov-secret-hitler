// Table talk for bots. On strategic moments (claims about cards, investigation results, accusations) the bot
// asks Jev WHAT to say: tell the truth, lie, accuse, or keep quiet. The wording comes from the role-neutral
// pools in botlines.ts, drawn with a per-room no-repeat picker. Small talk stays template-only. Everything is
// built from the bot's own view and memory.
//
// Two audiences for the strings here. `description` and `instructions` are read by Jev and stay in English.
// `line` is read by players, so it follows the table's language (Room.lang, from the host's client language;
// SH_BOT_LANG is the default): it is what a bot actually types whenever the writing
// model in bottalk.ts is unavailable, and an English fallback at a Rioplatense table reads broken.
import { buildState, type Rand } from '../shared/smartbot';
import { beliefs } from '../shared/belief';
import { ROLE_COUNTS } from '../shared/rules';
import { profiles, type Memory } from '../shared/tracker';
import type { GameEvent, Policy } from '../shared/types';
import type { GameView } from '../shared/view';
import { config, type BotLang } from './config';
import { poolLine, type LinePicker, type POOLS } from './botlines';

/** Card wording for a table language. */
function cardsIn(lang: BotLang) {
  return (cs: Policy[]): string => {
    const l = cs.filter((c) => c === 'L').length;
    const f = cs.length - l;
    if (lang === 'es-AR') {
      // "facha" is what the table calls a Fascist card; nobody says "política fascista" out loud.
      if (cs.length === 2) return l === 2 ? 'dos liberales' : f === 2 ? 'dos fachas' : 'una liberal y una facha';
      return l === 0 ? 'tres fachas' : l === 3 ? 'tres liberales' : `${l} liberal${l > 1 ? 'es' : ''} y ${f} facha${f > 1 ? 's' : ''}`;
    }
    if (cs.length === 2) return l === 2 ? 'two Liberals' : f === 2 ? 'two Fascists' : 'a Liberal and a Fascist';
    return l === 0 ? 'three Fascists' : l === 3 ? 'three Liberals' : `${l} Liberal${l > 1 ? 's' : ''} and ${f} Fascist${f > 1 ? 's' : ''}`;
  };
}

/** English card wording, for the `description`/`situation` text that Jev and the writing model read. */
function cardsEn(cs: Policy[]): string {
  const l = cs.filter((c) => c === 'L').length;
  const f = cs.length - l;
  if (cs.length === 2) return l === 2 ? 'two Liberals' : f === 2 ? 'two Fascists' : 'a Liberal and a Fascist';
  return l === 0 ? 'three Fascists' : l === 3 ? 'three Liberals' : `${l} Liberal${l > 1 ? 's' : ''} and ${f} Fascist${f > 1 ? 's' : ''}`;
}

/** How Fascist each seat looks to this bot when it talks, from the belief model. Liberals use everything
 *  they know; the Fascist team reads the table's view, so what they say sounds plausible. `sus` puts
 *  pFascist on the old suspicion scale (0 = the prior, about +3 = certain), which the talk thresholds use:
 *  a read at about 60%, a warning at 75%, an outright accusation at 80%. */
export function talkReads(m: Memory, v: GameView): { pF: number[]; sus: number[] } {
  const fasc = v.yourRole !== 'liberal';
  const pF = beliefs(m, v, fasc ? { observer: 'liberal' } : undefined).pFascist;
  const k = ROLE_COUNTS[m.n][1] + 1;
  const prior = fasc ? k / m.n : k / (m.n - 1);
  return { pF, sus: pF.map((p) => 6 * (p - prior)) };
}

/** buildState with each player's `suspicion` and decision-side `read` swapped for the talk percentage, so a
 *  Fascist talks from the table's view. buildState lists the other players in seat order, so the swap goes
 *  by that order. */
function withLikelyFascist(state: ReturnType<typeof buildState>, v: GameView, pF: number[]) {
  const others = v.players.filter((p) => p.seat !== v.you);
  const players = (state.players as Record<string, unknown>[]).map((p, i) => {
    const { suspicion: _s, read: _r, ...rest } = p;
    return { ...rest, likelyFascist: `${Math.round(pF[others[i].seat] * 100)}%` };
  });
  return { ...state, players };
}

export interface TalkOption {
  line: string | null; // null = say nothing
  description: string; // what this choice means, for Jev
  score: number; // built-in preference when Jev is unavailable
}

/** Either a fixed line, or a choice for Jev to make. `situation` describes what just happened, in plain
 *  prose, and is reused by bottalk.ts when it writes the words. `must`: never throttled or dropped as stale,
 *  e.g. an investigation result the table is waiting for. */
export type TalkPlan =
  | { kind: 'line'; line: string; situation: string; must?: boolean }
  | { kind: 'choice'; situation: string; instructions: string; options: Record<string, TalkOption>; state: unknown; must?: boolean };

/** Events whose plan for `seat` is `must`: the table is waiting for this bot's investigation result. */
export const mustTalk = (e: GameEvent, seat: number) => e.k === 'investigated' && e.by === seat;

function honesty(fasc: boolean): string {
  return fasc
    ? 'You are secretly on the Fascist team, so you may lie. Protect your teammates and Hitler, cast doubt on Liberals, and keep your story believable: a claim your government partner knows is false can expose you, unless your partner is a teammate. Never admit to discarding or burying a Liberal policy.'
    : 'You are a Liberal. Liberals win by sharing accurate information, so tell the truth; accuse only when you have real evidence.';
}

export function planTalk(
  e: GameEvent, v: GameView, m: Memory, name: (s: number) => string, rand: Rand, lang: BotLang = config.llm.lang, picker?: LinePicker,
): TalkPlan | null {
  const say = (key: keyof typeof POOLS, vars: Record<string, string> = {}) => poolLine(key, lang, vars, rand, picker);
  const cards = cardsIn(lang);
  const me = v.you!;
  const fasc = v.yourRole !== 'liberal';
  const choice = (situation: string, options: Record<string, TalkOption>): TalkPlan => ({
    kind: 'choice',
    situation,
    instructions: `${situation} What do you say to the table? ${honesty(fasc)}`,
    options,
    state: withLikelyFascist(buildState(v, m, profiles(m, v), name), v, talkReads(m, v).pF),
  });
  const line = (situation: string, text: string): TalkPlan => ({ kind: 'line', line: text, situation });
  const role = (s: number) => v.players[s]?.role;

  switch (e.k) {
    case 'enacted': {
      if (e.chaos) {
        const sit = `Three elections failed in a row, so the top card was enacted automatically: a ${e.policy === 'L' ? 'Liberal' : 'Fascist'} policy. Nobody is to blame for it.`;
        return rand() < 0.2 ? line(sit, say('chaos')) : null;
      }
      const g = m.governments.at(-1);
      if (!g || g.result !== e.policy) return null;
      const policy = e.policy === 'L' ? 'Liberal' : 'Fascist';
      if (g.president === me) {
        const p = m.passed.find((x) => x.round === g.round);
        if (!p) return null;
        const partner = name(g.chancellor);
        const teammate = role(g.chancellor) && role(g.chancellor) !== 'liberal';
        const drew = p.drew ? `You drew ${cardsEn(p.drew)} and passed ${cardsEn(p.gave)}` : `You passed ${cardsEn(p.gave)}`;
        // A Fascist who threw away a Liberal card must not say so: that exposes them.
        const discardedLiberal = !!p.drew && p.drew.filter((c) => c === 'L').length > p.gave.filter((c) => c === 'L').length;
        const hide = fasc && discardedLiberal;
        const options: Record<string, TalkOption> = {};
        if (!hide) {
          options.truth = {
            line: p.drew ? say('presDrew', { drew: cards(p.drew), gave: cards(p.gave) }) : say('presPassed', { gave: cards(p.gave) }),
            description: 'Tell the truth about the cards you drew and passed',
            score: fasc ? 0.5 : 2,
          };
        } else if (p.gave.includes('L')) {
          // Claim the passed cards plus one Fascist that was "discarded".
          const claimed: Policy[] = [...p.gave, 'F'];
          options.cover = {
            line: say('presDrew', { drew: cards(claimed), gave: cards(p.gave) }),
            description: `Claim you drew ${cardsEn(claimed)} and passed ${cardsEn(p.gave)} (hides that you discarded a Liberal)`,
            score: 2,
          };
        }
        options.silent = { line: null, description: 'Say nothing', score: 0.3 };
        if (e.policy === 'F') {
          options.three_fascists = {
            line: say('threeFascists', { partner }),
            description: 'Claim you drew three Fascist policies, so nothing could be done',
            score: fasc ? 2 : p.drew?.every((c) => c === 'F') ? 2.5 : -2,
          };
          options.blame_partner = {
            line: say('presBlame', { partner }),
            description: `Claim you gave ${partner} a Liberal policy and they chose Fascist anyway (accuses them)`,
            score: !fasc && p.gave.includes('L') ? 3 : fasc && !teammate ? 1.5 : -2,
          };
        }
        return choice(`You were President with Chancellor ${partner}${teammate ? ' (your teammate)' : ''}. ${drew}. A ${policy} policy was enacted.${hide ? ' Admitting you discarded a Liberal would expose you as a Fascist.' : ''}`, options);
      }
      if (g.chancellor === me) {
        const r = m.received.find((x) => x.round === g.round);
        if (!r) return null;
        const partner = name(g.president);
        const teammate = role(g.president) && role(g.president) !== 'liberal';
        // A Fascist who was handed a Liberal and still enacted Fascist must not say so: that exposes them.
        const hide = fasc && r.got.includes('L') && e.policy === 'F';
        const options: Record<string, TalkOption> = {};
        if (!hide) {
          options.truth = { line: say('chanGot', { got: cards(r.got) }), description: 'Tell the truth about the two cards you received', score: fasc ? 0.5 : 2 };
        } else {
          options.two_fascists = {
            line: say('twoFascists'),
            description: 'Claim you received two Fascist policies, so you had no choice (does not accuse the President)',
            score: teammate ? 2.5 : 1.5,
          };
        }
        options.silent = { line: null, description: 'Say nothing', score: 0.4 };
        if (e.policy === 'F') {
          options.blame_partner = {
            line: say('chanBlame', { partner }),
            description: `Claim President ${partner} handed you two Fascist policies (shifts blame to them)`,
            score: !fasc && r.got.every((c) => c === 'F') ? 3 : fasc && !teammate ? 2 : -2,
          };
        }
        return choice(`You were Chancellor with President ${partner}${teammate ? ' (your teammate)' : ''}. You received ${cardsEn(r.got)} and a ${policy} policy was enacted.${hide ? ' Admitting you received a Liberal would expose you as a Fascist.' : ''}`, options);
      }
      return null;
    }
    case 'investigated': {
      if (e.by !== me) return null;
      const truth = m.known.get(e.target);
      if (!truth) return null;
      const t = name(e.target);
      const teammate = role(e.target) && role(e.target) !== 'liberal';
      return { ...choice(`You investigated ${t}${teammate ? ' (your teammate)' : ''}. Their party card says ${truth.toUpperCase()}. You must announce a result.`, {
        liberal: { line: say('invLiberal', { target: t }), description: `Announce that ${t} is a Liberal`, score: truth === 'liberal' ? (fasc ? 0.5 : 3) : fasc ? 3 : -3 },
        fascist: { line: say('invFascist', { target: t }), description: `Announce that ${t} is a Fascist`, score: truth === 'fascist' ? (fasc ? -3 : 3) : fasc ? 1.2 : -3 },
      }), must: true };
    }
    case 'votes': {
      const el = m.elections.at(-1);
      if (!el) return null;
      const { pF, sus } = talkReads(m, v);
      const pres = name(el.president);
      const nom = name(el.nominee);
      const presSus = sus[el.president];
      const nomSus = sus[el.nominee];
      const pct = (s: number) => Math.round(pF[s] * 100);
      // A government just formed in which a suspicious President hands cards to someone the table still
      // trusts. That is the classic setup ("hacer la cama"): two Fascists passed down, and the Chancellor
      // wears it. Bots call it out, exactly as players do - louder when it is about to happen to them.
      if (el.passed && presSus >= 1.5 && v.players[el.nominee].alive) {
        if (el.nominee === me) {
          return choice(
            `You were just elected Chancellor under President ${pres}, who you do not trust (likely Fascist ${pct(el.president)}%). ` +
              `If ${pres} is a Fascist they can hand you two Fascist policies, leaving you no choice and no way to prove it was not you.`,
            {
              warn: {
                line: say('warnSelf', { pres }),
                description: `Say out loud, before you get the cards, that ${pres} may be setting you up to take the blame`,
                score: presSus - 0.3,
              },
              silent: { line: null, description: 'Say nothing', score: 0.7 },
            },
          );
        }
        if (el.president !== me && nomSus < 0.5 && rand() < 0.5) {
          return choice(
            `The election passed: President ${pres} (likely Fascist ${pct(el.president)}%) will hand policies to Chancellor ${nom}, ` +
              `who the table still trusts (likely Fascist ${pct(el.nominee)}%). If ${pres} is a Fascist, they can pass ${nom} two Fascist ` +
              `policies and leave ${nom} carrying the blame for them.`,
            {
              warn: {
                line: say('warnOther', { nom }),
                description: `Warn ${nom} out loud that ${pres} may be setting them up to take the blame`,
                score: presSus - 0.8,
              },
              silent: { line: null, description: 'Say nothing', score: 0.9 },
            },
          );
        }
      }
      if (el.votes[me] !== false || rand() > 0.5) return null;
      return choice(`You voted NEIN on President ${pres} with Chancellor ${nom}. The government ${el.passed ? 'passed anyway' : 'was rejected'}.`, {
        accuse_chancellor: {
          line: say('accuseChancellor', { nom }),
          description: `Explain you don't trust Chancellor ${nom}`,
          score: nomSus - 1,
        },
        accuse_president: { line: say('accusePresident', { pres }), description: `Explain you don't trust President ${pres}`, score: presSus - 1.2 },
        silent: { line: null, description: 'Say nothing', score: 0.5 },
      });
    }
    // Small talk: fixed lines, no Jev call.
    case 'nominated':
      if (e.target === me && rand() < 0.35) {
        return line(`President ${name(e.president)} just nominated YOU as Chancellor. The table is about to vote on you.`, say('nominated'));
      }
      return null;
    case 'executed':
      return e.by === me
        ? line(`You just shot ${name(e.target)} dead in front of everyone. They are out of the game.`,
            say('executed', { target: name(e.target) }))
        : null;
    case 'vetoProposed':
      return e.seat === me
        ? line('You are Chancellor and you just proposed a veto, which means asking the President to bin both policies.',
            say('veto'))
        : null;
    case 'gameOver': {
      const won = (e.winner === 'liberal') === !fasc;
      const sit = `The game is over: the ${e.winner === 'liberal' ? 'Liberals' : 'Fascists'} won. ${won ? 'Your team won.' : 'You lost.'} Everyone's role is now public.`;
      return rand() < 0.4 ? line(sit, say(won ? 'won' : 'lost')) : null;
    }
    default:
      return null;
  }
}

/** Built-in choice when Jev is unavailable: best score with a little noise. */
export function heuristicTalk(options: Record<string, TalkOption>, rand: Rand): string {
  let best = '';
  let bestScore = -Infinity;
  for (const [k, o] of Object.entries(options)) {
    const s = o.score + rand() * 0.8;
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  return best;
}
