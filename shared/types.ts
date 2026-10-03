// Core types shared by engine, server, client, bots and tests.

export type Party = 'liberal' | 'fascist';
export type Role = 'liberal' | 'fascist' | 'hitler';
export type Policy = 'L' | 'F';
export type Power = 'peek' | 'investigate' | 'special' | 'execute';

export type Phase =
  | 'night' // roles revealed, fascists see each other
  | 'nominate' // president picks a chancellor
  | 'vote' // everyone votes Ja/Nein
  | 'legPresident' // president discards 1 of 3
  | 'legChancellor' // chancellor enacts 1 of 2 (or proposes veto)
  | 'veto' // president answers a veto proposal
  | 'peek' // president looks at the top 3
  | 'investigate'
  | 'special'
  | 'execute'
  | 'gameOver';

export const PHASES: readonly Phase[] = [
  'night', 'nominate', 'vote', 'legPresident', 'legChancellor', 'veto',
  'peek', 'investigate', 'special', 'execute', 'gameOver',
];

export interface PlayerState {
  seat: number;
  name: string;
  role: Role;
  alive: boolean;
}

export interface Investigation {
  by: number;
  target: number;
  party: Party;
}

export type WinReason = 'liberalPolicies' | 'hitlerExecuted' | 'fascistPolicies' | 'hitlerElected';

export interface GameState {
  players: PlayerState[]; // index === seat
  phase: Phase;
  deck: Policy[]; // index 0 is the top
  discard: Policy[];
  hand: Policy[]; // cards in the current legislative session
  liberal: number;
  fascist: number;
  tracker: number; // failed elections in a row (0-2 at rest)
  president: number;
  nominee: number | null; // chancellor candidate during vote
  chancellor: number | null; // elected chancellor of the current government
  lastPresident: number | null; // term-limited
  lastChancellor: number | null; // term-limited
  specialReturn: number | null; // president who called a special election
  votes: (boolean | null)[];
  lastVotes: (boolean | null)[] | null; // revealed votes of the most recent election
  nightAcks: boolean[];
  vetoRefused: boolean;
  investigations: Investigation[];
  winner: Party | null;
  winReason: WinReason | null;
  rng: number; // uint32 RNG state
  round: number; // count of presidencies started
}

// Actions as submitted by a seat. The server stamps `seat`; clients never choose it.
export type ActionBody =
  | { type: 'ack' }
  | { type: 'nominate'; target: number }
  | { type: 'vote'; ja: boolean }
  | { type: 'presDiscard'; index: number }
  | { type: 'chancEnact'; index: number }
  | { type: 'proposeVeto' }
  | { type: 'vetoResponse'; accept: boolean }
  | { type: 'peekDone' }
  | { type: 'investigate'; target: number }
  | { type: 'specialElect'; target: number }
  | { type: 'execute'; target: number };

export type Action = ActionBody & { seat: number };

// Public events used to drive animations. Never contain secret info.
export type GameEvent =
  | { k: 'nightStart' }
  | { k: 'acked'; seat: number }
  | { k: 'newPresident'; seat: number; special: boolean }
  | { k: 'nominated'; president: number; target: number }
  | { k: 'voted'; seat: number }
  | { k: 'votes'; votes: (boolean | null)[]; passed: boolean }
  | { k: 'tracker'; value: number }
  | { k: 'drawn'; seat: number; count: number }
  | { k: 'presDiscarded'; seat: number }
  | { k: 'passedToChancellor'; from: number; to: number }
  | { k: 'chancDiscarded'; seat: number }
  | { k: 'enacted'; policy: Policy; chaos: boolean }
  | { k: 'reshuffled'; deck: number }
  | { k: 'power'; power: Power; president: number }
  | { k: 'peeked'; seat: number }
  | { k: 'investigated'; by: number; target: number }
  | { k: 'specialElected'; by: number; target: number }
  | { k: 'executed'; by: number; target: number }
  | { k: 'vetoProposed'; seat: number }
  | { k: 'vetoAnswer'; accepted: boolean }
  | { k: 'gameOver'; winner: Party; reason: WinReason };

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
