// Table talk for bots. On strategic moments (claims about cards, investigation results, accusations) the bot
// asks Jev WHAT to say: tell the truth, lie, accuse, or keep quiet. The wording comes from templates.
// Small talk stays template-only. Everything is built from the bot's own view and memory.
//
// Two audiences for the strings here. `description` and `instructions` are read by Jev and stay in English.
// `line` is read by players, so it follows SH_BOT_LANG: it is what a bot actually types whenever the writing
// model in bottalk.ts is unavailable, and an English fallback at a Rioplatense table reads broken.
import { buildState, type Rand } from '../shared/smartbot';
import { profiles, type Memory } from '../shared/tracker';
import type { GameEvent, Policy } from '../shared/types';
import type { GameView } from '../shared/view';
import { config } from './config';

const pick = <T>(xs: T[], rand: Rand) => xs[Math.floor(rand() * xs.length)];

/** Picks the player-facing wording for the configured language. */
const say = (es: string, en: string) => (config.llm.lang === 'es-AR' ? es : en);

function cards(cs: Policy[]): string {
  const l = cs.filter((c) => c === 'L').length;
  const f = cs.length - l;
  if (config.llm.lang === 'es-AR') {
    // "facha" is what the table calls a Fascist card; nobody says "política fascista" out loud.
    if (cs.length === 2) return l === 2 ? 'dos liberales' : f === 2 ? 'dos fachas' : 'una liberal y una facha';
    return l === 0 ? 'tres fachas' : l === 3 ? 'tres liberales' : `${l} liberal${l > 1 ? 'es' : ''} y ${f} facha${f > 1 ? 's' : ''}`;
  }
  if (cs.length === 2) return l === 2 ? 'two Liberals' : f === 2 ? 'two Fascists' : 'a Liberal and a Fascist';
  return l === 0 ? 'three Fascists' : l === 3 ? 'three Liberals' : `${l} Liberal${l > 1 ? 's' : ''} and ${f} Fascist${f > 1 ? 's' : ''}`;
}

/** English card wording, for the `description`/`situation` text that Jev and the writing model read. */
function cardsEn(cs: Policy[]): string {
  const l = cs.filter((c) => c === 'L').length;
  const f = cs.length - l;
  if (cs.length === 2) return l === 2 ? 'two Liberals' : f === 2 ? 'two Fascists' : 'a Liberal and a Fascist';
  return l === 0 ? 'three Fascists' : l === 3 ? 'three Liberals' : `${l} Liberal${l > 1 ? 's' : ''} and ${f} Fascist${f > 1 ? 's' : ''}`;
}

export interface TalkOption {
  line: string | null; // null = say nothing
  description: string; // what this choice means, for Jev
  score: number; // built-in preference when Jev is unavailable
}

/** Either a fixed line, or a choice for Jev to make. `situation` describes what just happened, in plain
 *  prose, and is reused by bottalk.ts when it writes the words. */
export type TalkPlan =
  | { kind: 'line'; line: string; situation: string }
  | { kind: 'choice'; situation: string; instructions: string; options: Record<string, TalkOption>; state: unknown };

function honesty(fasc: boolean): string {
  return fasc
    ? 'You are secretly on the Fascist team, so you may lie. Protect your teammates and Hitler, cast doubt on Liberals, and keep your story believable: a claim your government partner knows is false can expose you, unless your partner is a teammate.'
    : 'You are a Liberal. Liberals win by sharing accurate information, so tell the truth; accuse only when you have real evidence.';
}

export function planTalk(e: GameEvent, v: GameView, m: Memory, name: (s: number) => string, rand: Rand): TalkPlan | null {
  const me = v.you!;
  const fasc = v.yourRole !== 'liberal';
  const choice = (situation: string, options: Record<string, TalkOption>): TalkPlan => ({
    kind: 'choice',
    situation,
    instructions: `${situation} What do you say to the table? ${honesty(fasc)}`,
    options,
    state: buildState(v, m, profiles(m, v), name),
  });
  const line = (situation: string, text: string): TalkPlan => ({ kind: 'line', line: text, situation });
  const role = (s: number) => v.players[s]?.role;

  switch (e.k) {
    case 'enacted': {
      if (e.chaos) {
        const sit = `Three elections failed in a row, so the top card was enacted automatically: a ${e.policy === 'L' ? 'Liberal' : 'Fascist'} policy. Nobody is to blame for it.`;
        const lines = say('es', 'en') === 'es'
          ? ['caos, joya.', 'bueno, esto pasa cuando no nos ponemos de acuerdo.']
          : ['Chaos. Great.', "Well, that's what happens when we can't agree."];
        return rand() < 0.2 ? line(sit, pick(lines, rand)) : null;
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
        const options: Record<string, TalkOption> = {
          truth: {
            line: p.drew
              ? say(`me tocaron ${cards(p.drew)} y pasé ${cards(p.gave)}.`, `I drew ${cards(p.drew)} and passed ${cards(p.gave)}.`)
              : say(`pasé ${cards(p.gave)}.`, `I passed ${cards(p.gave)}.`),
            description: 'Tell the truth about the cards you drew and passed',
            score: fasc ? 0.5 : 2,
          },
          silent: { line: null, description: 'Say nothing', score: 0.3 },
        };
        if (e.policy === 'F') {
          options.three_fascists = {
            line: pick(say('es', 'en') === 'es'
              ? ['me tocaron tres fachas, no podía hacer nada.', `eran las tres fachas, te lo juro. ${partner} lo puede confirmar.`]
              : ['I drew three Fascists. Nothing I could do.', `All Fascist cards, I swear. ${partner} can confirm.`], rand),
            description: 'Claim you drew three Fascist policies, so nothing could be done',
            score: fasc ? 2 : p.drew?.every((c) => c === 'F') ? 2.5 : -2,
          };
          options.blame_partner = {
            line: say(`a ${partner} le pasé una liberal y eligió la facha. Acordate de esto.`, `I passed ${partner} a Liberal. They chose Fascist. Remember that.`),
            description: `Claim you gave ${partner} a Liberal policy and they chose Fascist anyway (accuses them)`,
            score: !fasc && p.gave.includes('L') ? 3 : fasc && !teammate ? 1.5 : -2,
          };
        }
        return choice(`You were President with Chancellor ${partner}${teammate ? ' (your teammate)' : ''}. ${drew}. A ${policy} policy was enacted.`, options);
      }
      if (g.chancellor === me) {
        const r = m.received.find((x) => x.round === g.round);
        if (!r) return null;
        const partner = name(g.president);
        const teammate = role(g.president) && role(g.president) !== 'liberal';
        const options: Record<string, TalkOption> = {
          truth: { line: say(`me llegaron ${cards(r.got)}.`, `I got ${cards(r.got)}.`), description: 'Tell the truth about the two cards you received', score: fasc ? 0.5 : 2 },
          silent: { line: null, description: 'Say nothing', score: 0.4 },
        };
        if (e.policy === 'F') {
          options.blame_partner = {
            line: pick(say('es', 'en') === 'es'
              ? [`${partner} me pasó dos fachas.`, `dos fachas. No me miren a mí, pregúntenle a ${partner}.`]
              : [`${partner} gave me two Fascists.`, `Two Fascists. Don't look at me, ask ${partner}.`], rand),
            description: `Claim President ${partner} handed you two Fascist policies (shifts blame to them)`,
            score: !fasc && r.got.every((c) => c === 'F') ? 3 : fasc && !teammate ? 2 : -2,
          };
        }
        return choice(`You were Chancellor with President ${partner}${teammate ? ' (your teammate)' : ''}. You received ${cardsEn(r.got)} and a ${policy} policy was enacted.`, options);
      }
      return null;
    }
    case 'investigated': {
      if (e.by !== me) return null;
      const truth = m.known.get(e.target);
      if (!truth) return null;
      const t = name(e.target);
      const teammate = role(e.target) && role(e.target) !== 'liberal';
      return choice(`You investigated ${t}${teammate ? ' (your teammate)' : ''}. Their party card says ${truth.toUpperCase()}. You must announce a result.`, {
        liberal: { line: say(`${t} es liberal.`, `${t} is a Liberal.`), description: `Announce that ${t} is a Liberal`, score: truth === 'liberal' ? (fasc ? 0.5 : 3) : fasc ? 3 : -3 },
        fascist: { line: say(`${t} es FACHO.`, `${t} is a FASCIST.`), description: `Announce that ${t} is a Fascist`, score: truth === 'fascist' ? (fasc ? -3 : 3) : fasc ? 1.2 : -3 },
      });
    }
    case 'votes': {
      const el = m.elections.at(-1);
      if (!el) return null;
      const prof = profiles(m, v);
      const pres = name(el.president);
      const nom = name(el.nominee);
      const presSus = prof[el.president].suspicion;
      const nomSus = prof[el.nominee].suspicion;
      // A government just formed in which a suspicious President hands cards to someone the table still
      // trusts. That is the classic setup ("hacer la cama"): two Fascists passed down, and the Chancellor
      // wears it. Bots call it out, exactly as players do - louder when it is about to happen to them.
      if (el.passed && presSus >= 1.5 && v.players[el.nominee].alive) {
        if (el.nominee === me) {
          return choice(
            `You were just elected Chancellor under President ${pres}, who you do not trust (suspicion ${presSus.toFixed(1)}). ` +
              `If ${pres} is a Fascist they can hand you two Fascist policies, leaving you no choice and no way to prove it was not you.`,
            {
              warn: {
                line: say(`che, ¿${pres} me va a hacer la cama o qué?`, `Is ${pres} setting me up here or what?`),
                description: `Say out loud, before you get the cards, that ${pres} may be setting you up to take the blame`,
                score: presSus - 0.3,
              },
              silent: { line: null, description: 'Say nothing', score: 0.7 },
            },
          );
        }
        if (el.president !== me && nomSus < 0.5 && rand() < 0.5) {
          return choice(
            `The election passed: President ${pres} (suspicion ${presSus.toFixed(1)}) will hand policies to Chancellor ${nom}, ` +
              `who the table still trusts (suspicion ${nomSus.toFixed(1)}). If ${pres} is a Fascist, they can pass ${nom} two Fascist ` +
              `policies and leave ${nom} carrying the blame for them.`,
            {
              warn: {
                line: say(`ojo ${nom}, te van a hacer la cama.`, `Careful ${nom}, they are setting you up.`),
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
          line: pick(say('es', 'en') === 'es'
            ? [`ni en pedo confío en ${nom}.`, `¿${nom}? ¿con ese historial? nein.`]
            : [`No way I'm trusting ${nom}.`, `${nom}? After that record? Nein.`], rand),
          description: `Explain you don't trust Chancellor ${nom}`,
          score: nomSus - 1,
        },
        accuse_president: { line: say(`no me cierran las elecciones de ${pres}.`, `I don't trust ${pres}'s picks.`), description: `Explain you don't trust President ${pres}`, score: presSus - 1.2 },
        silent: { line: null, description: 'Say nothing', score: 0.5 },
      });
    }
    // Small talk: fixed lines, no Jev call.
    case 'nominated':
      if (e.target === me && rand() < 0.35) {
        const lines = say('es', 'en') === 'es'
          ? (fasc ? ['confíen en mí.', 'no se van a arrepentir.'] : ['no los voy a defraudar.', 'al fin alguien con criterio.'])
          : (fasc ? ['Trust me.', "You won't regret it."] : ["I won't let you down.", 'Finally, some sense.']);
        return line(`President ${name(e.president)} just nominated YOU as Chancellor. The table is about to vote on you.`, pick(lines, rand));
      }
      return null;
    case 'executed':
      return e.by === me
        ? line(`You just shot ${name(e.target)} dead in front of everyone. They are out of the game.`,
            pick(say('es', 'en') === 'es'
              ? [`perdón, ${name(e.target)}.`, 'había que hacerlo.']
              : [`Sorry, ${name(e.target)}.`, 'It had to be done.'], rand))
        : null;
    case 'vetoProposed':
      return e.seat === me
        ? line('You are Chancellor and you just proposed a veto, which means asking the President to bin both policies.',
            say('las dos son fachas. quiero vetar.', 'Both Fascist. I want to veto.'))
        : null;
    case 'gameOver': {
      const won = (e.winner === 'liberal') === !fasc;
      const sit = `The game is over: the ${e.winner === 'liberal' ? 'Liberals' : 'Fascists'} won. ${won ? 'Your team won.' : 'You lost.'} Everyone's role is now public.`;
      const lines = say('es', 'en') === 'es'
        ? (won ? ['gg!', 'te lo dije.'] : ['bien jugado.', 'la próxima.'])
        : (won ? ['GG!', 'Told you.'] : ['Well played.', 'Next time.']);
      return rand() < 0.4 ? line(sit, pick(lines, rand)) : null;
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
