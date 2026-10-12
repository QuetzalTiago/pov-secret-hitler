// Exact Bayesian role inference for bots: enumerates every role assignment consistent with what a seat
// knows (hard constraints), weights each by how likely the public history is under it, and normalises.
import { CHAOS_AT, FASCIST_POLICIES, HITLER_ZONE, LIBERAL_POLICIES, ROLE_COUNTS } from './rules';
import type { Memory } from './tracker';
import type { GameView } from './view';

/** A Fascist-team player (Hitler too) holding a choice discards L as President / enacts F as Chancellor. */
export const FASCIST_PLAYS_F = 0.85;
/** A Liberal holding a choice plays the F-favouring option anyway (misclick, bluff, bot noise). */
export const LIBERAL_ERROR = 0.01;
/** Weak signal: a Liberal votes JA on a government that went on to enact Fascist (Fascist team: 1). */
export const JA_ON_F_LIBERAL = 0.8;
/** Weak signal: a Fascist-team President nominates a Fascist-team Chancellor. */
export const NOMINATE_TEAMMATE = 1.3;
/** Weak signal: a Fascist-team President executes a Fascist-team player. */
export const EXECUTE_TEAMMATE = 0.2;

export interface Beliefs {
  /** P(seat is on the Fascist team, Hitler included). */
  pFascist: number[];
  /** P(seat is Hitler). */
  pHitler: number[];
}

interface Hard {
  teamReq: number; // seats that must be on the team
  teamForbid: number; // seats that must not be
  hitlerFixed: number; // -1 when unknown
  hitlerForbid: number; // seats that are not Hitler (private knowledge)
  impossible: boolean;
}

interface Soft {
  tabs: Float64Array; // per government: 2x2 table, index presTeam * 2 + chancTeam
  gp: Int32Array;
  gc: Int32Array;
  libVote: Float64Array; // per seat: factor applied when the seat is Liberal
  nomP: Int32Array;
  nomC: Int32Array;
  exeP: Int32Array;
  exeC: Int32Array;
  hitlerForbid: number; // public not-Hitler constraints (zone, executed)
}

const maskCache = new Map<string, number[]>();

/** All n-bit masks with exactly k bits set. */
function teamMasks(n: number, k: number): number[] {
  const key = `${n}:${k}`;
  let out = maskCache.get(key);
  if (!out) {
    out = [];
    for (let x = 0; x < 1 << n; x++) {
      let c = 0;
      for (let y = x; y; y &= y - 1) c++;
      if (c === k) out.push(x);
    }
    maskCache.set(key, out);
  }
  return out;
}

function choose(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let out = 1;
  for (let i = 0; i < r; i++) out = (out * (n - i)) / (i + 1);
  return out;
}

/** P(j Fascist cards among 3 drawn), j = 0..3, from a deck of poolF Fascist and poolL Liberal cards. */
function drawDist(poolF: number, poolL: number): number[] {
  const total = poolF + poolL;
  if (total >= 3) {
    const all = choose(total, 3);
    return [0, 1, 2, 3].map((j) => (choose(poolF, j) * choose(poolL, 3 - j)) / all);
  }
  // Too few cards left in the approximation: binomial on what is left, or the full deck if nothing is.
  const p = total === 0 ? FASCIST_POLICIES / (FASCIST_POLICIES + LIBERAL_POLICIES) : poolF / total;
  return [0, 1, 2, 3].map((j) => choose(3, j) * p ** j * (1 - p) ** (3 - j));
}

/** P(president passes [LL, FL, FF]) given draw distribution and president team (0 liberal, 1 fascist). */
function passDist(d: number[], team: number): number[] {
  const toward = team ? FASCIST_PLAYS_F : LIBERAL_ERROR; // probability of the F-favouring option
  return [
    d[0] + d[1] * (1 - toward),
    d[1] * toward + d[2] * (1 - toward),
    d[2] * toward + d[3],
  ];
}

/** P(chancellor of team c enacts F) given the 2 cards passed: 0 = LL, 1 = FL, 2 = FF. */
function enactF(passed: number, c: number): number {
  return passed === 0 ? 0 : passed === 2 ? 1 : c ? FASCIST_PLAYS_F : LIBERAL_ERROR;
}

interface Step {
  election: number; // index into m.elections
  gov: number; // index into m.governments, -1 when legislation is still in progress
  fAtElection: number;
  poolF: number;
  poolL: number;
}

/**
 * Walks the elections in order, tracking enacted policies and the election tracker, to recover which
 * policies were on the board at each passed election. Memory has no global order between chaos policies and
 * governments, so chaos is placed where the tracker reaches CHAOS_AT.
 */
function timeline(m: Memory): Step[] {
  const steps: Step[] = [];
  const used = new Set<number>();
  let f = 0;
  let l = 0;
  let fails = 0;
  let chaos = 0;
  const fail = (): void => {
    fails++;
    if (fails >= CHAOS_AT && chaos < m.chaos.length) {
      if (m.chaos[chaos++] === 'F') f++;
      else l++;
      fails = 0;
    }
  };
  m.elections.forEach((e, i) => {
    if (!e.passed) return fail();
    const gov = m.governments.findIndex((g, gi) => !used.has(gi) && g.round === e.round && g.president === e.president && g.chancellor === e.nominee);
    const step: Step = { election: i, gov, fAtElection: f, poolF: 0, poolL: 0 };
    if (gov >= 0) {
      used.add(gov);
      // Approximation: the pool is the whole deck minus enacted policies; discards and reshuffles are ignored.
      step.poolF = Math.max(0, FASCIST_POLICIES - f);
      step.poolL = Math.max(0, LIBERAL_POLICIES - l);
      const r = m.governments[gov].result;
      if (r === 'veto') fail();
      else {
        fails = 0;
        if (r === 'F') f++;
        else l++;
      }
    }
    steps.push(step);
  });
  return steps;
}

function buildSoft(m: Memory, self: boolean, steps: Step[]): Soft {
  const gp: number[] = [];
  const gc: number[] = [];
  const tabs: number[] = [];
  const libVote = new Float64Array(m.n).fill(1);
  let zone = 0;
  for (const s of steps) {
    const e = m.elections[s.election];
    if (s.fAtElection >= HITLER_ZONE) zone |= 1 << e.nominee;
    if (s.gov < 0) continue;
    const g = m.governments[s.gov];
    if (g.result === 'veto') continue;
    const d = drawDist(s.poolF, s.poolL);
    const pd = [passDist(d, 0), passDist(d, 1)];
    const t = [0, 0, 0, 0];
    for (let p = 0; p < 2; p++) {
      for (let c = 0; c < 2; c++) {
        let pf = 0;
        for (let h = 0; h < 3; h++) pf += pd[p][h] * enactF(h, c);
        t[p * 2 + c] = g.result === 'F' ? pf : 1 - pf;
      }
    }
    const passed = self && g.president === m.me ? m.passed.find((x) => x.round === g.round && x.gave.length === 2) : undefined;
    const received = self && g.chancellor === m.me ? m.received.find((x) => x.round === g.round && x.got.length === 2) : undefined;
    if (passed) {
      const h = passed.gave.filter((c) => c === 'F').length === 0 ? 0 : passed.gave.every((c) => c === 'F') ? 2 : 1;
      const q = [0, 1].map((c) => (g.result === 'F' ? enactF(h, c) : 1 - enactF(h, c)));
      // An observed result impossible under both teams is dropped rather than zeroing everything.
      const [q0, q1] = q[0] === 0 && q[1] === 0 ? [1, 1] : q;
      for (let p = 0; p < 2; p++) {
        t[p * 2] = q0;
        t[p * 2 + 1] = q1;
      }
    } else if (received) {
      const h = received.got.filter((c) => c === 'F').length;
      for (let p = 0; p < 2; p++) {
        t[p * 2] = pd[p][h];
        t[p * 2 + 1] = pd[p][h];
      }
    }
    gp.push(g.president);
    gc.push(g.chancellor);
    tabs.push(...t);
    if (g.result === 'F') {
      e.votes.forEach((v, seat) => {
        if (v === true && seat !== g.president && seat !== g.chancellor) libVote[seat] *= JA_ON_F_LIBERAL;
      });
    }
  }
  for (const x of m.executions) zone |= 1 << x.target;
  return {
    tabs: Float64Array.from(tabs),
    gp: Int32Array.from(gp),
    gc: Int32Array.from(gc),
    libVote,
    nomP: Int32Array.from(m.elections.map((e) => e.president)),
    nomC: Int32Array.from(m.elections.map((e) => e.nominee)),
    exeP: Int32Array.from(m.executions.map((x) => x.by)),
    exeC: Int32Array.from(m.executions.map((x) => x.target)),
    hitlerForbid: zone,
  };
}

function buildHard(m: Memory, v: GameView, self: boolean): Hard {
  const h: Hard = { teamReq: 0, teamForbid: 0, hitlerFixed: -1, hitlerForbid: 0, impossible: false };
  const fix = (seat: number, role: 'liberal' | 'fascist' | 'hitler'): void => {
    const bit = 1 << seat;
    if (role === 'liberal') h.teamForbid |= bit;
    else h.teamReq |= bit;
    if (role === 'fascist') h.hitlerForbid |= bit;
    if (role === 'hitler') {
      if (h.hitlerFixed >= 0 && h.hitlerFixed !== seat) h.impossible = true;
      h.hitlerFixed = seat;
    }
  };
  if (self) {
    if (v.yourRole) fix(m.me, v.yourRole);
    for (const [seat, party] of m.known) {
      if (party === 'fascist') h.teamReq |= 1 << seat;
      else h.teamForbid |= 1 << seat;
    }
  }
  if (self || v.phase === 'gameOver') {
    for (const p of v.players) if (p.role) fix(p.seat, p.role);
  }
  return h;
}

function run(n: number, k: number, hard: Hard, soft: Soft | null, hitlerForbidPublic: number): Beliefs | null {
  const pf = new Float64Array(n);
  const ph = new Float64Array(n);
  let total = 0;
  if (!hard.impossible) {
    const masks = teamMasks(n, k);
    const forbidH = hard.hitlerForbid | hitlerForbidPublic;
    for (let mi = 0; mi < masks.length; mi++) {
      const fas = masks[mi];
      for (let h = 0; h < n; h++) {
        if ((fas >> h) & 1) continue;
        if (hard.hitlerFixed >= 0 && hard.hitlerFixed !== h) continue;
        if ((forbidH >> h) & 1) continue;
        const team = fas | (1 << h);
        if ((team & hard.teamForbid) !== 0) continue;
        if ((team & hard.teamReq) !== hard.teamReq) continue;
        let w = 1;
        if (soft) {
          for (let g = 0; g < soft.gp.length; g++) {
            w *= soft.tabs[g * 4 + ((team >> soft.gp[g]) & 1) * 2 + ((team >> soft.gc[g]) & 1)];
          }
          for (let e = 0; e < soft.nomP.length; e++) {
            if ((team >> soft.nomP[e]) & (team >> soft.nomC[e]) & 1) w *= NOMINATE_TEAMMATE;
          }
          for (let e = 0; e < soft.exeP.length; e++) {
            if ((team >> soft.exeP[e]) & (team >> soft.exeC[e]) & 1) w *= EXECUTE_TEAMMATE;
          }
          for (let s = 0; s < n; s++) if (!((team >> s) & 1)) w *= soft.libVote[s];
        }
        if (w <= 0) continue;
        total += w;
        ph[h] += w;
        for (let s = 0; s < n; s++) if ((team >> s) & 1) pf[s] += w;
      }
    }
  }
  if (!(total > 0)) return null;
  return { pFascist: Array.from(pf, (x) => x / total), pHitler: Array.from(ph, (x) => x / total) };
}

/**
 * Posterior role beliefs from a seat's memory and view. Observer 'self' (default) uses everything the seat
 * knows; 'liberal' is a generic Liberal who knows no private info (roles only count once the game is over).
 */
export function beliefs(m: Memory, v: GameView, opts?: { observer?: 'self' | 'liberal' }): Beliefs {
  const n = m.n;
  const k = ROLE_COUNTS[n][1];
  const self = (opts?.observer ?? 'self') === 'self';
  const over = v.phase === 'gameOver';
  const hard = buildHard(m, v, self);
  const soft = buildSoft(m, self, timeline(m));
  // Once the game is over the roles are public and the zone/execution constraints no longer apply.
  const full = run(n, k, hard, soft, over ? 0 : soft.hitlerForbid);
  if (full) return full;
  return run(n, k, hard, null, 0) ?? {
    pFascist: new Array<number>(n).fill((k + 1) / n),
    pHitler: new Array<number>(n).fill(1 / n),
  };
}
