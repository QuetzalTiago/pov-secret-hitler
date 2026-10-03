import { aliveSeats, createGame, reduce } from '../shared/engine';
import type { ActionBody, GameState, Policy, Role } from '../shared/types';

export function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i}`);
}

/** New game past the night phase, with explicit roles, president and deck. */
export function setup(
  n: number,
  opts: { roles?: Role[]; president?: number; deck?: Policy[]; seed?: number } = {},
): GameState {
  let s = createGame(names(n), opts.seed ?? 42);
  if (opts.roles) s.players.forEach((p, i) => (p.role = opts.roles![i]));
  if (opts.president !== undefined) s.president = opts.president;
  if (opts.deck) s.deck = opts.deck.slice();
  for (let i = 0; i < n; i++) s = act(s, i, { type: 'ack' });
  return s;
}

/** Roles with Hitler at `hitler` and fascists at the given seats; everyone else liberal. */
export function roles(n: number, hitler: number, fascists: number[]): Role[] {
  return Array.from({ length: n }, (_, i) => (i === hitler ? 'hitler' : fascists.includes(i) ? 'fascist' : 'liberal'));
}

export function act(s: GameState, seat: number, body: ActionBody): GameState {
  return reduce(s, { ...body, seat } as never).state;
}

export function voteAll(s: GameState, ja: boolean | ((seat: number) => boolean)): GameState {
  for (const seat of aliveSeats(s)) s = act(s, seat, { type: 'vote', ja: typeof ja === 'function' ? ja(seat) : ja });
  return s;
}

/** Nominate and elect a government. */
export function elect(s: GameState, chancellor: number): GameState {
  s = act(s, s.president, { type: 'nominate', target: chancellor });
  return voteAll(s, true);
}

/** Nominate and fail an election. */
export function failVote(s: GameState, chancellor: number): GameState {
  s = act(s, s.president, { type: 'nominate', target: chancellor });
  return voteAll(s, false);
}

/** Full legislative session: president discards index, chancellor enacts index. */
export function legislate(s: GameState, presDiscard = 0, chancEnact = 0): GameState {
  s = act(s, s.president, { type: 'presDiscard', index: presDiscard });
  return act(s, s.chancellor!, { type: 'chancEnact', index: chancEnact });
}

/** First eligible chancellor that is not in `avoid`. */
export function someChancellor(s: GameState, avoid: number[] = []): number {
  for (const p of s.players) {
    if (!p.alive || p.seat === s.president || avoid.includes(p.seat)) continue;
    if (p.seat === s.lastChancellor) continue;
    if (aliveSeats(s).length > 5 && p.seat === s.lastPresident) continue;
    return p.seat;
  }
  throw new Error('no chancellor');
}
