// Per-player projection of the game state. This is the ONLY game data a client receives.
import { eligibleChancellors, pendingActors, vetoUnlocked } from './engine';
import { hitlerKnowsFascists, trackFor } from './rules';
import type { GameState, Party, Phase, Policy, Power, Role, WinReason } from './types';

export interface PlayerView {
  seat: number;
  name: string;
  alive: boolean;
  role: Role | null; // only when this viewer is allowed to know it
  hasVoted: boolean;
  acked: boolean;
}

export interface GameView {
  you: number | null; // null for a pure spectator
  yourRole: Role | null;
  phase: Phase;
  players: PlayerView[];
  liberal: number;
  fascist: number;
  tracker: number;
  deckCount: number;
  discardCount: number;
  president: number;
  nominee: number | null;
  chancellor: number | null;
  lastPresident: number | null;
  lastChancellor: number | null;
  eligible: number[]; // chancellor candidates (public)
  pending: number[]; // seats the game is waiting on (public)
  hand: Policy[] | null; // only for the seat currently holding cards
  peek: Policy[] | null; // only for the president during a peek
  vetoUnlocked: boolean;
  vetoRefused: boolean;
  lastVotes: (boolean | null)[] | null;
  investigated: number[]; // seats already investigated (public)
  yourInvestigations: { target: number; party: Party }[];
  powers: (Power | null)[];
  currentPower: Power | null;
  winner: Party | null;
  winReason: WinReason | null;
  round: number;
}

function knownRole(s: GameState, viewer: number | null, target: number): Role | null {
  const role = s.players[target].role;
  if (s.phase === 'gameOver') return role;
  if (viewer === null) return null;
  if (viewer === target) return role;
  const mine = s.players[viewer].role;
  if (mine === 'fascist' && role !== 'liberal') return role;
  if (mine === 'hitler' && role === 'fascist' && hitlerKnowsFascists(s.players.length)) return role;
  return null;
}

export function viewFor(s: GameState, viewer: number | null): GameView {
  const holder =
    s.phase === 'legPresident' ? s.president : s.phase === 'legChancellor' ? s.chancellor : null;
  const powerPhase: Power | null =
    s.phase === 'peek' || s.phase === 'investigate' || s.phase === 'special' || s.phase === 'execute'
      ? s.phase
      : null;
  return {
    you: viewer,
    yourRole: viewer === null ? null : s.players[viewer].role,
    phase: s.phase,
    players: s.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      alive: p.alive,
      role: knownRole(s, viewer, p.seat),
      hasVoted: s.phase === 'vote' && s.votes[p.seat] !== null,
      acked: s.nightAcks[p.seat],
    })),
    liberal: s.liberal,
    fascist: s.fascist,
    tracker: s.tracker,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    president: s.president,
    nominee: s.nominee,
    chancellor: s.chancellor,
    lastPresident: s.lastPresident,
    lastChancellor: s.lastChancellor,
    eligible: s.phase === 'nominate' ? eligibleChancellors(s) : [],
    pending: pendingActors(s),
    hand: viewer !== null && viewer === holder ? s.hand.slice() : null,
    peek: viewer !== null && s.phase === 'peek' && viewer === s.president ? s.deck.slice(0, 3) : null,
    vetoUnlocked: vetoUnlocked(s),
    vetoRefused: s.vetoRefused,
    lastVotes: s.lastVotes ? s.lastVotes.slice() : null,
    investigated: s.investigations.map((i) => i.target),
    yourInvestigations:
      viewer === null
        ? []
        : s.investigations.filter((i) => i.by === viewer).map((i) => ({ target: i.target, party: i.party })),
    powers: trackFor(s.players.length).slice(),
    currentPower: powerPhase,
    winner: s.winner,
    winReason: s.winReason,
    round: s.round,
  };
}

