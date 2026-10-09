// Table talk for bots. On strategic moments (claims about cards, investigation results, accusations) the bot
// asks Jev WHAT to say: tell the truth, lie, accuse, or keep quiet. The wording comes from templates.
// Small talk stays template-only. Everything is built from the bot's own view and memory.
import { buildState, type Rand } from '../shared/smartbot';
import { profiles, type Memory } from '../shared/tracker';
import type { GameEvent, Policy } from '../shared/types';
import type { GameView } from '../shared/view';

const pick = <T>(xs: T[], rand: Rand) => xs[Math.floor(rand() * xs.length)];

function cards(cs: Policy[]): string {
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

/** Either a fixed line, or a choice for Jev to make. */
export type TalkPlan =
  | { kind: 'line'; line: string }
  | { kind: 'choice'; instructions: string; options: Record<string, TalkOption>; state: unknown };

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
    instructions: `${situation} What do you say to the table? ${honesty(fasc)}`,
    options,
    state: buildState(v, m, profiles(m, v), name),
  });
  const role = (s: number) => v.players[s]?.role;

  switch (e.k) {
    case 'enacted': {
      if (e.chaos) return rand() < 0.2 ? { kind: 'line', line: pick(['Chaos. Great.', "Well, that's what happens when we can't agree."], rand) } : null;
      const g = m.governments.at(-1);
      if (!g || g.result !== e.policy) return null;
      const policy = e.policy === 'L' ? 'Liberal' : 'Fascist';
      if (g.president === me) {
        const p = m.passed.find((x) => x.round === g.round);
        if (!p) return null;
        const partner = name(g.chancellor);
        const teammate = role(g.chancellor) && role(g.chancellor) !== 'liberal';
        const drew = p.drew ? `You drew ${cards(p.drew)} and passed ${cards(p.gave)}` : `You passed ${cards(p.gave)}`;
        const options: Record<string, TalkOption> = {
          truth: { line: p.drew ? `I drew ${cards(p.drew)} and passed ${cards(p.gave)}.` : `I passed ${cards(p.gave)}.`, description: 'Tell the truth about the cards you drew and passed', score: fasc ? 0.5 : 2 },
          silent: { line: null, description: 'Say nothing', score: 0.3 },
        };
        if (e.policy === 'F') {
          options.three_fascists = { line: pick(['I drew three Fascists. Nothing I could do.', `All Fascist cards, I swear. ${partner} can confirm.`], rand), description: 'Claim you drew three Fascist policies, so nothing could be done', score: fasc ? 2 : p.drew?.every((c) => c === 'F') ? 2.5 : -2 };
          options.blame_partner = { line: `I passed ${partner} a Liberal. They chose Fascist. Remember that.`, description: `Claim you gave ${partner} a Liberal policy and they chose Fascist anyway (accuses them)`, score: !fasc && p.gave.includes('L') ? 3 : fasc && !teammate ? 1.5 : -2 };
        }
        return choice(`You were President with Chancellor ${partner}${teammate ? ' (your teammate)' : ''}. ${drew}. A ${policy} policy was enacted.`, options);
      }
      if (g.chancellor === me) {
        const r = m.received.find((x) => x.round === g.round);
        if (!r) return null;
        const partner = name(g.president);
        const teammate = role(g.president) && role(g.president) !== 'liberal';
        const options: Record<string, TalkOption> = {
          truth: { line: `I got ${cards(r.got)}.`, description: 'Tell the truth about the two cards you received', score: fasc ? 0.5 : 2 },
          silent: { line: null, description: 'Say nothing', score: 0.4 },
        };
        if (e.policy === 'F') {
          options.blame_partner = { line: pick([`${partner} gave me two Fascists.`, `Two Fascists. Don't look at me, ask ${partner}.`], rand), description: `Claim President ${partner} handed you two Fascist policies (shifts blame to them)`, score: !fasc && r.got.every((c) => c === 'F') ? 3 : fasc && !teammate ? 2 : -2 };
        }
        return choice(`You were Chancellor with President ${partner}${teammate ? ' (your teammate)' : ''}. You received ${cards(r.got)} and a ${policy} policy was enacted.`, options);
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
        liberal: { line: `${t} is a Liberal.`, description: `Announce that ${t} is a Liberal`, score: truth === 'liberal' ? (fasc ? 0.5 : 3) : fasc ? 3 : -3 },
        fascist: { line: `${t} is a FASCIST.`, description: `Announce that ${t} is a Fascist`, score: truth === 'fascist' ? (fasc ? -3 : 3) : fasc ? 1.2 : -3 },
      });
    }
    case 'votes': {
      const el = m.elections.at(-1);
      if (!el || el.votes[me] !== false || rand() > 0.5) return null;
      const prof = profiles(m, v);
      const pres = name(el.president);
      const nom = name(el.nominee);
      return choice(`You voted NEIN on President ${pres} with Chancellor ${nom}. The government ${el.passed ? 'passed anyway' : 'was rejected'}.`, {
        accuse_chancellor: { line: pick([`No way I'm trusting ${nom}.`, `${nom}? After that record? Nein.`], rand), description: `Explain you don't trust Chancellor ${nom}`, score: prof[el.nominee].suspicion - 1 },
        accuse_president: { line: `I don't trust ${pres}'s picks.`, description: `Explain you don't trust President ${pres}`, score: prof[el.president].suspicion - 1.2 },
        silent: { line: null, description: 'Say nothing', score: 0.5 },
      });
    }
    // Small talk: fixed lines, no Jev call.
    case 'nominated':
      if (e.target === me && rand() < 0.35) return { kind: 'line', line: pick(fasc ? ['Trust me.', "You won't regret it."] : ["I won't let you down.", 'Finally, some sense.'], rand) };
      return null;
    case 'executed':
      return e.by === me ? { kind: 'line', line: pick([`Sorry, ${name(e.target)}.`, 'It had to be done.'], rand) } : null;
    case 'vetoProposed':
      return e.seat === me ? { kind: 'line', line: 'Both Fascist. I want to veto.' } : null;
    case 'gameOver': {
      const won = (e.winner === 'liberal') === !fasc;
      return rand() < 0.4 ? { kind: 'line', line: won ? pick(['GG!', 'Told you.'], rand) : pick(['Well played.', 'Next time.'], rand) } : null;
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
