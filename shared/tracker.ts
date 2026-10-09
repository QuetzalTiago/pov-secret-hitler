// Per-seat game memory for bots. Built ONLY from that seat's own view and public events,
// so a bot never knows more than the human sitting in that chair would.
import type { GameEvent, Party, Policy } from './types';
import type { GameView } from './view';

export interface Election {
  round: number;
  president: number;
  nominee: number;
  votes: (boolean | null)[];
  passed: boolean;
}

export interface Government {
  round: number;
  president: number;
  chancellor: number;
  result: Policy | 'veto';
}

export interface Memory {
  me: number;
  n: number;
  elections: Election[];
  governments: Government[];
  chaos: Policy[];
  executions: { by: number; target: number }[];
  investigations: { by: number; target: number }[];
  /** What I handed over as President (my private knowledge). */
  passed: { round: number; to: number; gave: Policy[]; drew?: Policy[] }[];
  /** What I received as Chancellor. */
  received: { round: number; from: number; got: Policy[] }[];
  /** Party of players I investigated myself. */
  known: Map<number, Party>;
  private: { nomination: { round: number; president: number; target: number } | null; government: { round: number; president: number; chancellor: number } | null; round: number };
}

export function newMemory(me: number, n: number): Memory {
  return {
    me, n, elections: [], governments: [], chaos: [], executions: [], investigations: [], passed: [], received: [],
    known: new Map(), private: { nomination: null, government: null, round: 1 },
  };
}

/** Feed one batch of events plus the resulting view of the memory's owner. */
export function observe(m: Memory, view: GameView, events: GameEvent[]): void {
  const p = m.private;
  for (const e of events) {
    switch (e.k) {
      case 'nominated':
        p.nomination = { round: view.round, president: e.president, target: e.target };
        break;
      case 'votes': {
        if (!p.nomination) break;
        // Rounds come from the nomination: by the time later events arrive the presidency may have moved on.
        m.elections.push({ round: p.nomination.round, president: p.nomination.president, nominee: p.nomination.target, votes: e.votes.slice(), passed: e.passed });
        p.government = e.passed ? { round: p.nomination.round, president: p.nomination.president, chancellor: p.nomination.target } : null;
        p.nomination = null;
        break;
      }
      case 'enacted':
        if (e.chaos) m.chaos.push(e.policy);
        else if (p.government) {
          m.governments.push({ ...p.government, result: e.policy });
          p.government = null;
        }
        break;
      case 'vetoAnswer':
        if (e.accepted && p.government) {
          m.governments.push({ ...p.government, result: 'veto' });
          p.government = null;
        }
        break;
      case 'executed':
        m.executions.push({ by: e.by, target: e.target });
        break;
      case 'investigated':
        m.investigations.push({ by: e.by, target: e.target });
        break;
      default:
        break;
    }
  }
  for (const r of view.yourInvestigations) m.known.set(r.target, r.party);
}

/** Records my own hand when I act on it (called by the bot just before it moves). */
export function noteMyHand(m: Memory, view: GameView, discardIndex: number | null): void {
  if (!view.hand) return;
  if (view.phase === 'legPresident' && discardIndex !== null && view.chancellor !== null) {
    m.passed.push({ round: view.round, to: view.chancellor, gave: view.hand.filter((_, i) => i !== discardIndex), drew: view.hand.slice() });
  }
  if (view.phase === 'legChancellor' && !m.received.some((r) => r.round === view.round)) {
    m.received.push({ round: view.round, from: view.president, got: view.hand.slice() });
  }
}

export interface PlayerProfile {
  seat: number;
  suspicion: number; // higher = more likely Fascist, from this bot's point of view
  fascistAsPresident: number;
  fascistAsChancellor: number;
  liberalAsPresident: number;
  liberalAsChancellor: number;
  jaOnFascistGovs: number;
  proof: string[]; // hard evidence lines
}

/**
 * Suspicion from the perspective of an observer who does not know roles (what a Liberal would think).
 * Fascist bots use it to judge how suspicious THEY look and who the table trusts.
 */
export function profiles(m: Memory, view: GameView): PlayerProfile[] {
  const out: PlayerProfile[] = view.players.map((pl) => ({
    seat: pl.seat, suspicion: 0, fascistAsPresident: 0, fascistAsChancellor: 0, liberalAsPresident: 0,
    liberalAsChancellor: 0, jaOnFascistGovs: 0, proof: [],
  }));
  for (const g of m.governments) {
    if (g.result === 'F') {
      out[g.president].fascistAsPresident++;
      out[g.chancellor].fascistAsChancellor++;
      out[g.president].suspicion += 0.8;
      out[g.chancellor].suspicion += 1.0;
    } else if (g.result === 'L') {
      out[g.president].liberalAsPresident++;
      out[g.chancellor].liberalAsChancellor++;
      out[g.president].suspicion -= 0.6;
      out[g.chancellor].suspicion -= 0.7;
    }
    const election = [...m.elections].reverse().find((e) => e.president === g.president && e.nominee === g.chancellor && e.passed);
    if (election && g.result === 'F') {
      election.votes.forEach((v, s) => {
        if (v === true && s !== g.president && s !== g.chancellor) {
          out[s].jaOnFascistGovs++;
          out[s].suspicion += 0.25;
        }
      });
    }
  }
  // Hard evidence from my own hands.
  for (const p of m.passed) {
    const g = m.governments.find((x) => x.round === p.round && x.president === m.me);
    if (g && g.result === 'F' && p.gave.includes('L')) {
      out[p.to].suspicion += 5;
      out[p.to].proof.push(`I passed them a Liberal policy and they enacted Fascist (round ${p.round})`);
    }
  }
  for (const r of m.received) {
    if (r.got.every((c) => c === 'F')) {
      out[r.from].suspicion += 0.6;
      out[r.from].proof.push(`handed me two Fascist policies (round ${r.round})`);
    }
  }
  for (const [seat, party] of m.known) {
    out[seat].suspicion = party === 'fascist' ? 10 : -10;
    out[seat].proof.push(`I investigated them: ${party.toUpperCase()}`);
  }
  // Roles my view reveals (teammates for Fascists).
  for (const pl of view.players) {
    if (pl.role && pl.seat !== m.me) out[pl.seat].proof.push(`known ${pl.role}`);
  }
  return out;
}

/** Every government a player took part in and what card ended up on the board. */
export function policyRecord(m: Memory, seat: number, name: (s: number) => string): string[] {
  return m.governments
    .filter((g) => g.president === seat || g.chancellor === seat)
    .map((g) => {
      const asPres = g.president === seat;
      const partner = asPres ? `with Chancellor ${name(g.chancellor)}` : `with President ${name(g.president)}`;
      const what = g.result === 'veto' ? 'vetoed both policies' : `placed a ${g.result === 'L' ? 'LIBERAL' : 'FASCIST'} policy`;
      return `Round ${g.round}, as ${asPres ? 'President' : 'Chancellor'} ${partner}: ${what}`;
    });
}

export function describeHistory(m: Memory, name: (s: number) => string): string[] {
  const lines = m.governments.map((g) => `Round ${g.round}: President ${name(g.president)} + Chancellor ${name(g.chancellor)} -> ${g.result === 'veto' ? 'vetoed' : g.result === 'L' ? 'Liberal policy' : 'Fascist policy'}`);
  const failed = m.elections.filter((e) => !e.passed).slice(-4).map((e) => `Round ${e.round}: ${name(e.president)} nominated ${name(e.nominee)}, rejected`);
  return [...lines, ...failed, ...m.chaos.map((c) => `Chaos policy enacted: ${c === 'L' ? 'Liberal' : 'Fascist'}`)];
}
