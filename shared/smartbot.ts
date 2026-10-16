// Turns a bot's decision into labelled options (for the Jev classifier) and a built-in strategy fallback.
// Everything here is derived from the bot's own GameView + Memory only.
import { beliefs } from './belief';
import { describeHistory, policyRecord, profiles, type Memory, type PlayerProfile } from './tracker';
import { ROLE_COUNTS } from './rules';
import type { BotLevel } from './protocol';
import type { ActionBody } from './types';
import type { GameView } from './view';

export interface Option {
  action: ActionBody;
  description: string;
  /** Built-in strategy score; higher is better for this bot. */
  score: number;
}

export interface Decision {
  kind: ActionBody['type'];
  instructions: string;
  options: Record<string, Option>;
  state: Record<string, unknown>;
}

export type Rand = () => number;

/** 'old' scores from suspicion heuristics; 'new' scores Liberal choices from the belief model. */
export type Strategy = 'old' | 'new';

export type { BotLevel };

/** Difficulty: which strategy scores the options and how much noise blurs the pick (0 = always the best). Sharp is also far stricter about electing a possible Hitler Chancellor in the zone. */
export const LEVELS: Record<BotLevel, { strategy: Strategy; noise: number; lib?: Partial<typeof LIB> }> = {
  casual: { strategy: 'old', noise: 1.5 },
  normal: { strategy: 'new', noise: 0.6 },
  sharp: { strategy: 'new', noise: 0, lib: { voteHitler: 200, nomHitler: 200 } },
};

/** Tunable weights for the belief-based Liberal strategy. */
export const LIB = {
  nomFas: 4, // nominate / special election: penalty per P(Fascist)
  nomHitler: 12, // in the zone: penalty per P(Hitler)
  nomSafe: 0.5, // in the zone: bonus for a confirmed non-Hitler
  voteBase: 2, // ja baseline
  voteTracker: 0.8, // ja bonus per failed election
  voteBad: 5, // ja penalty per excess P(government has a Fascist)
  voteHitler: 15, // in the zone: ja penalty per P(Hitler chancellor)
  invUncertain: 0.5, // investigate: bonus for uncertain suspects
  invKnown: -5, // investigate: already investigated
  exeHitler: 3, // execute: weight on P(Hitler)
  exeFas: 1, // execute: weight on P(Fascist)
  vetoFas: 4, // veto agree: penalty per P(Fascist) of the Chancellor
  vetoLiberal: -5, // veto agree: I passed a Liberal, so the Chancellor lied
};

/** Liberal JA score for the current government: block governments likelier to hold a Fascist than the table average. */
function libVoteScore(v: GameView, pF: number[], pH: number[], w: typeof LIB): number {
  const p = v.president;
  const c = v.nominee!;
  const others = v.players.filter((x) => x.alive && x.seat !== v.you).map((x) => pF[x.seat]);
  const avg = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
  const bad = 1 - (1 - pF[p]) * (1 - pF[c]);
  const baseline = 1 - (1 - avg) ** 2;
  return w.voteBase + w.voteTracker * v.tracker - w.voteBad * (bad - baseline) - (v.fascist >= 3 ? w.voteHitler * pH[c] : 0);
}

/** Overwrites the Liberal option scores with ones derived from the belief model. */
function scoreLiberal(d: Decision, v: GameView, m: Memory, w: typeof LIB): void {
  const { pFascist: pF, pHitler: pH } = beliefs(m, v);
  const zone = v.fascist >= 3;
  const target = (score: (s: number) => number) => {
    for (const o of Object.values(d.options)) if ('target' in o.action) o.score = score(o.action.target);
  };
  switch (d.kind) {
    case 'nominate':
      target((s) => -w.nomFas * pF[s] - (zone ? w.nomHitler * pH[s] + (pH[s] === 0 && v.tracker !== 2 ? w.nomSafe : 0) : 0));
      break;
    case 'specialElect':
      target((s) => -w.nomFas * pF[s]);
      break;
    case 'investigate':
      target((s) => (m.known.has(s) ? w.invKnown : pF[s] + w.invUncertain * pF[s] * (1 - pF[s])));
      break;
    case 'execute':
      target((s) => w.exeHitler * pH[s] + w.exeFas * pF[s]);
      break;
    case 'vote':
      d.options.ja.score = libVoteScore(v, pF, pH, w);
      break;
    case 'vetoResponse':
      d.options.agree.score = m.passed.some((x) => x.round === v.round && x.gave.includes('L')) ? w.vetoLiberal : 1 - w.vetoFas * pF[v.chancellor!];
      break;
  }
}

/** Tunable weights for the belief-based Fascist / Hitler strategy. */
export const FAS = {
  coverP: 0.55, // play cover cards once the table's P(Fascist) of me is above this
  proofP: 0.15, // Chancellor holding an L (provable F): cover once the table's P(Fascist) of me is above this
  loneAdd: 0.26, // both thresholds rise by this when the Fascist is alone with Hitler (5-6p): exposure is cheap
  playGap: 3, // card play: preferred option over the other
  vetoScore: 1, // cover (b) veto: between enact F (0) and enact L (playGap)
  voteTeam: 4, // ja when a teammate is in the government
  voteHitler: 20, // ja for Hitler as nominee in the zone
  voteJa: 2, // ja for a Liberal government that is not safe to block
  voteNein: 1.5, // nein margin for a Liberal government that is safe to block
  neinP: 0.8, // block (nein) only while the table's P(Fascist) of me is below this: a NEIN from a suspect costs more
  nomBig: 8, // zone: nominate a clean-looking Hitler
  nomHitler: 12, // zone: penalty per table P(Hitler) of Hitler
  nomTeam: -3, // teammate base: below believable Liberals, so Fascists nominate cover
  nomTeamP: 3, // teammate penalty per table P(Fascist)
  nomLib: 3, // believable Liberal base
  nomLibP: 2, // Liberal penalty per table P(Fascist)
  vetoMate: 3, // agree a teammate's veto
};

/** Overwrites the Fascist / Hitler option scores: cover plays, team votes, clean-looking nominations. */
function scoreFascist(d: Decision, v: GameView, m: Memory): void {
  const me = v.you!;
  const zone = v.fascist >= 3;
  const mate = (s: number) => s !== me && (v.players[s].role === 'fascist' || v.players[s].role === 'hitler');
  const team = (s: number) => s === me || mate(s);
  const set = (key: string, score: number) => {
    if (d.options[key]) d.options[key].score = score;
  };
  const clean = v.yourRole === 'hitler' && !zone; // Hitler stays clean until the zone
  if (clean && d.kind === 'presDiscard') {
    set('discard_F', FAS.playGap);
    set('discard_L', 0);
    return;
  }
  if (clean && (d.kind === 'chancEnact' || d.kind === 'proposeVeto')) {
    set('enact_L', FAS.playGap);
    set('enact_F', 0);
    set('veto', -10);
    return;
  }
  const { pFascist: pF, pHitler: pH } = beliefs(m, v, { observer: 'liberal' });
  const hitler = v.yourRole === 'hitler' ? me : v.players.findIndex((p) => p.role === 'hitler');
  const target = (score: (s: number) => number) => {
    for (const o of Object.values(d.options)) if ('target' in o.action) o.score = score(o.action.target);
  };
  const hasL = (v.hand ?? []).includes('L');
  const add = ROLE_COUNTS[v.players.length][1] < 2 ? FAS.loneAdd : 0;
  const exposed = pF[me] > FAS.coverP + add;
  const pick = (s: number) => (team(s) ? FAS.nomTeam - FAS.nomTeamP * pF[s] : FAS.nomLib - FAS.nomLibP * pF[s]);
  switch (d.kind) {
    case 'nominate':
      target((s) => (zone && s === hitler ? FAS.nomBig - FAS.nomHitler * pH[s] : pick(s)));
      break;
    case 'specialElect':
      target(pick);
      break;
    case 'investigate':
    case 'execute':
      target((s) => (team(s) ? -100 : -pF[s]));
      break;
    case 'vote': {
      const p = v.president;
      const c = v.nominee!;
      if (clean) {
        d.options.ja.score = libVoteScore(v, pF, pH, LIB); // Hitler votes like a Liberal until the zone
        break;
      }
      const safe = v.tracker < 2 && pF[me] < FAS.neinP + add; // block only while the table still sees me as clean
      d.options.ja.score = zone && c === hitler ? FAS.voteHitler : team(p) || team(c) ? FAS.voteTeam : safe ? -FAS.voteNein : FAS.voteJa;
      break;
    }
    case 'presDiscard': {
      const cover = (exposed || (v.players[v.chancellor!].role === 'hitler' && !zone && hasL)) && v.fascist < 5;
      set('discard_F', cover ? FAS.playGap : 0);
      set('discard_L', cover ? 0 : FAS.playGap);
      break;
    }
    case 'chancEnact':
    case 'proposeVeto': {
      const proof = !team(v.president) && hasL && pF[me] > FAS.proofP + add;
      const cover = (exposed || proof) && v.fascist < 5;
      set('enact_L', cover ? FAS.playGap : 0);
      set('enact_F', cover ? 0 : FAS.playGap);
      set('veto', cover && proof ? FAS.vetoScore : -10);
      break;
    }
    case 'vetoResponse':
      set('agree', mate(v.chancellor!) ? FAS.vetoMate : -3);
      break;
  }
}

const isFascistTeam = (v: GameView) => v.yourRole === 'fascist' || v.yourRole === 'hitler';

function goal(v: GameView): string {
  switch (v.yourRole) {
    case 'liberal':
      return 'You are a LIBERAL. You do not know anyone else\'s role. Win by enacting 5 Liberal policies or executing Hitler. Trust players with Liberal track records; distrust those tied to Fascist policies.';
    case 'fascist':
      return 'You are secretly a FASCIST. Win by enacting 6 Fascist policies, or by getting Hitler elected Chancellor once 3+ Fascist policies are on the board. Help your team while appearing Liberal; never expose Hitler.';
    case 'hitler':
      return 'You are secretly HITLER. Win with 6 Fascist policies or by being elected Chancellor after 3+ Fascist policies. Act like a trustworthy Liberal so people elect you.';
    default:
      return '';
  }
}

export function buildState(v: GameView, m: Memory, prof: PlayerProfile[], name: (s: number) => string) {
  const me = v.you!;
  const b = beliefs(m, v);
  return {
    you: { name: name(me), role: v.yourRole, goal: goal(v) },
    board: {
      liberalPolicies: `${v.liberal}/5`,
      fascistPolicies: `${v.fascist}/6`,
      failedElectionsInARow: `${v.tracker}/3 (at 3 the top policy is enacted at random)`,
      hitlerZone: v.fascist >= 3 ? 'YES: electing Hitler as Chancellor now wins for the Fascists' : 'not yet',
      vetoUnlocked: v.vetoUnlocked,
      drawPile: v.deckCount,
      nextFascistPower: v.powers[v.fascist] ?? 'none',
    },
    players: v.players
      .filter((p) => p.seat !== me)
      .map((p) => {
        const pr = prof[p.seat];
        return {
          name: name(p.seat),
          alive: p.alive,
          knownRole: p.role ?? 'unknown',
          read: [`likely Fascist ${Math.round(b.pFascist[p.seat] * 100)}%`, b.pHitler[p.seat] < 1e-6 ? 'confirmed not Hitler' : `likely Hitler ${Math.round(b.pHitler[p.seat] * 100)}%`].join(', '),
          suspicion: Number(pr.suspicion.toFixed(1)),
          record: `${pr.liberalAsPresident + pr.liberalAsChancellor} Liberal and ${pr.fascistAsPresident + pr.fascistAsChancellor} Fascist policies in governments they were part of; voted Ja on ${pr.jaOnFascistGovs} governments that enacted Fascist`,
          policiesPlaced: policyRecord(m, p.seat, name),
          evidence: pr.proof,
        };
      }),
    history: describeHistory(m, name),
    myRecord: policyRecord(m, me, name),
    myCards: v.hand ?? v.peek ?? undefined,
  };
}

function playerLine(v: GameView, pr: PlayerProfile, name: (s: number) => string): string {
  const role = v.players[pr.seat].role;
  const bits = [`${name(pr.seat)}: suspicion ${pr.suspicion.toFixed(1)}`];
  if (role) bits.push(`known ${role.toUpperCase()}`);
  if (pr.fascistAsChancellor + pr.fascistAsPresident) bits.push(`${pr.fascistAsChancellor + pr.fascistAsPresident} Fascist policies in their governments`);
  if (pr.liberalAsChancellor + pr.liberalAsPresident) bits.push(`${pr.liberalAsChancellor + pr.liberalAsPresident} Liberal`);
  if (pr.proof.length) bits.push(pr.proof.join('; '));
  return bits.join(', ');
}

/** How much this bot wants `seat` in power (positive) — the core of the built-in strategy. */
function trust(v: GameView, pr: PlayerProfile): number {
  const role = v.players[pr.seat].role;
  if (isFascistTeam(v)) {
    if (role === 'hitler') return v.fascist >= 3 ? 50 : 4;
    if (role === 'fascist') return 3;
    return 0.5 - pr.suspicion * 0.3; // a believable Liberal makes good cover
  }
  return -pr.suspicion;
}

export function buildDecision(v: GameView, legal: ActionBody[], m: Memory, name: (s: number) => string, opts: { strategy?: Strategy; lib?: Partial<typeof LIB> } = {}): Decision {
  const prof = profiles(m, v);
  const state = buildState(v, m, prof, name);
  const kind = legal[0].type;
  const fasc = isFascistTeam(v);
  const options: Record<string, Option> = {};
  let instructions = '';
  const targetOptions = (score: (pr: PlayerProfile) => number) => {
    for (const a of legal) {
      if (!('target' in a)) continue;
      const pr = prof[a.target];
      options[`p${a.target}`] = { action: a, description: playerLine(v, pr, name), score: score(pr) };
    }
  };

  switch (kind) {
    case 'nominate':
      instructions = fasc
        ? `You are President and secretly on the Fascist team. Nominate the Chancellor who best helps the Fascists while keeping you looking Liberal.${v.fascist >= 3 ? ' 3+ Fascist policies are enacted: if Hitler is nominated and elected, the Fascists win immediately.' : ''}`
        : `You are President and a Liberal. Nominate the player most likely to be Liberal (lowest suspicion, best record).${v.fascist >= 3 ? ' Careful: if Hitler gets elected Chancellor now, the Liberals lose instantly, so avoid anyone suspicious.' : ''}`;
      targetOptions((pr) => trust(v, pr));
      break;
    case 'specialElect':
      instructions = fasc
        ? 'Special election: choose the next President. Prefer a Fascist teammate, or a trusted player if that would look too obvious.'
        : 'Special election: choose the most trustworthy player as the next President.';
      targetOptions((pr) => trust(v, pr));
      break;
    case 'investigate':
      instructions = fasc
        ? 'Investigate a player\'s party. You are on the Fascist team: pick a Liberal, so you can claim whatever result helps your team.'
        : 'Investigate the player most likely to be Fascist and whose loyalty is still unknown.';
      targetOptions((pr) => (fasc ? (v.players[pr.seat].role ? -5 : 1) : pr.suspicion));
      break;
    case 'execute':
      instructions = fasc
        ? 'Execute a player. Never Hitler or a Fascist teammate. Kill the Liberal who is most dangerous to the Fascists (the most trusted Liberal).'
        : 'Execute the player most likely to be Hitler or a Fascist. Executing Hitler wins the game for the Liberals.';
      targetOptions((pr) => {
        const role = v.players[pr.seat].role;
        if (fasc) return role ? -100 : -pr.suspicion;
        return pr.suspicion;
      });
      break;
    case 'vote': {
      const pres = prof[v.president];
      const chan = prof[v.nominee!];
      const hitlerWin = fasc && v.fascist >= 3 && v.players[v.nominee!].role === 'hitler';
      const base = (trust(v, pres) + trust(v, chan)) / 2;
      const evidence = (pr: PlayerProfile) => {
        const f = pr.fascistAsPresident + pr.fascistAsChancellor;
        const l = pr.liberalAsPresident + pr.liberalAsChancellor;
        const role = v.players[pr.seat].role;
        return `${name(pr.seat)} (${role ? `known ${role}, ` : ''}suspicion ${pr.suspicion.toFixed(1)}, ${l} Liberal / ${f} Fascist policies in past governments${pr.proof.length ? `; ${pr.proof.join('; ')}` : ''})`;
      };
      const pressure =
        v.tracker === 2
          ? ' Two elections already failed in a row: if this one fails too, the top card is enacted at random, and it is usually Fascist (11 of 17 cards are Fascist). Only vote NEIN with strong evidence.'
          : v.tracker === 1
            ? ' One election already failed; repeated failures enact random, usually Fascist, policies.'
            : '';
      instructions =
        `Election: President ${evidence(pres)} has nominated Chancellor ${evidence(chan)}. ` +
        (fasc
          ? 'You are on the Fascist team. Vote JA for governments containing your teammates. For other governments usually vote JA too, so you look like a cooperative Liberal; vote NEIN only when a trusted Liberal pair would likely enact a Liberal policy and rejecting it will not look suspicious.'
          : 'You are a Liberal. In Secret Hitler most governments should be allowed to govern: vote JA by default. Vote NEIN only when the President or the Chancellor has real evidence against them (Fascist policies in their record, high suspicion, a Fascist investigation result).' +
            (v.fascist >= 3 ? ' 3+ Fascist policies are enacted: if the Chancellor is Hitler, the Liberals lose immediately, so be stricter about a suspicious Chancellor.' : '')) +
        pressure +
        (hitlerWin ? ' This Chancellor is Hitler and 3+ Fascist policies are enacted: voting JA wins the game for your team.' : '');
      options.ja = { action: { type: 'vote', ja: true }, description: `JA: let ${name(v.president)} and ${name(v.nominee!)} govern`, score: hitlerWin ? 100 : base + 1.2 + v.tracker * 0.8 };
      options.nein = { action: { type: 'vote', ja: false }, description: `NEIN: reject this government (election tracker goes to ${v.tracker + 1}/3)`, score: 0 };
      break;
    }
    case 'presDiscard': {
      const hand = v.hand ?? [];
      instructions = fasc
        ? `You are President holding ${hand.join(', ')} (L = Liberal, F = Fascist). Discard one; the Chancellor gets the other two. Fascists want Fascist policies, but passing two Fascists every time looks suspicious.`
        : `You are President holding ${hand.join(', ')} (L = Liberal, F = Fascist). Discard one; the Chancellor gets the other two. As a Liberal, discard a Fascist policy if you can.`;
      for (const c of ['L', 'F'] as const) {
        const i = hand.indexOf(c);
        if (i < 0) continue;
        options[`discard_${c}`] = {
          action: { type: 'presDiscard', index: i },
          description: c === 'L' ? 'Discard a Liberal policy' : 'Discard a Fascist policy',
          score: (c === 'F') !== fasc ? 2 : hand.filter((x) => x === 'L').length === 3 ? 1 : 0,
        };
      }
      break;
    }
    case 'chancEnact':
    case 'proposeVeto': {
      const hand = v.hand ?? [];
      instructions = fasc
        ? `You are Chancellor holding ${hand.join(', ')}. Enact one. Fascists want Fascist policies but must not get caught (the President knows what they gave you).`
        : `You are Chancellor holding ${hand.join(', ')}. Enact one. As a Liberal, enact a Liberal policy if you can${legal.some((a) => a.type === 'proposeVeto') ? ', or propose a veto if both are Fascist' : ''}.`;
      for (const c of ['L', 'F'] as const) {
        const i = hand.indexOf(c);
        if (i < 0) continue;
        options[`enact_${c}`] = { action: { type: 'chancEnact', index: i }, description: c === 'L' ? 'Enact the Liberal policy' : 'Enact the Fascist policy', score: (c === 'L') !== fasc ? 2 : 0 };
      }
      if (legal.some((a) => a.type === 'proposeVeto')) {
        options.veto = { action: { type: 'proposeVeto' }, description: 'Propose a veto: discard both if the President agrees', score: !fasc && hand.every((c) => c === 'F') ? 3 : -1 };
      }
      break;
    }
    case 'vetoResponse':
      instructions = fasc
        ? 'The Chancellor proposes a veto. Agreeing discards both policies and advances the election tracker.'
        : 'The Chancellor proposes a veto. Agree if you believe both policies are Fascist and the Chancellor is honest.';
      options.agree = { action: { type: 'vetoResponse', accept: true }, description: 'Agree to the veto', score: fasc ? -1 : 1 - prof[v.chancellor!].suspicion * 0.3 };
      options.refuse = { action: { type: 'vetoResponse', accept: false }, description: 'Refuse: the Chancellor must enact', score: 0 };
      break;
    default:
      for (const [i, a] of legal.entries()) options[`o${i}`] = { action: a, description: a.type, score: 0 };
  }
  const d: Decision = { kind, instructions, options, state };
  if ((opts.strategy ?? 'new') === 'new') {
    if (v.yourRole === 'liberal') scoreLiberal(d, v, m, opts.lib ? { ...LIB, ...opts.lib } : LIB);
    else if (fasc) scoreFascist(d, v, m);
  }
  return d;
}

/** Built-in strategy: best-scoring option, with a little noise so bots are not robotic. */
export function heuristicChoice(d: Decision, rand: Rand, noise = 0.6): string {
  let best = '';
  let bestScore = -Infinity;
  for (const [key, o] of Object.entries(d.options)) {
    const s = o.score + rand() * noise;
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return best;
}

/** Picks from a probability distribution: usually the top answer, sometimes a plausible alternative. */
export function sampleChoice(probabilities: Record<string, number>, rand: Rand, greedy = 0.8): string {
  const entries = Object.entries(probabilities).filter(([, p]) => p > 0);
  entries.sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  if (rand() < greedy) return entries[0][0];
  const total = entries.reduce((s, [, p]) => s + p * p, 0);
  let r = rand() * total;
  for (const [k, p] of entries) {
    r -= p * p;
    if (r <= 0) return k;
  }
  return entries[0][0];
}
