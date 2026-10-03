// Static rule tables for official Secret Hitler (5-10 players).
import type { Party, Power, Role } from './types';

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const LIBERAL_POLICIES = 6;
export const FASCIST_POLICIES = 11;
export const TOTAL_POLICIES = LIBERAL_POLICIES + FASCIST_POLICIES;
export const LIBERAL_WIN = 5;
export const FASCIST_WIN = 6;
export const VETO_AT = 5;
export const HITLER_ZONE = 3;
export const CHAOS_AT = 3;

// [liberals, fascists (not counting Hitler)]
export const ROLE_COUNTS: Record<number, [number, number]> = {
  5: [3, 1],
  6: [4, 1],
  7: [4, 2],
  8: [5, 2],
  9: [5, 3],
  10: [6, 3],
};

type Track = (Power | null)[];
// Power granted when the Nth fascist policy (1-based -> index N-1) is enacted.
export const FASCIST_TRACKS: Record<'small' | 'medium' | 'large', Track> = {
  small: [null, null, 'peek', 'execute', 'execute', null],
  medium: [null, 'investigate', 'special', 'execute', 'execute', null],
  large: ['investigate', 'investigate', 'special', 'execute', 'execute', null],
};

export function trackFor(playerCount: number): Track {
  if (playerCount <= 6) return FASCIST_TRACKS.small;
  if (playerCount <= 8) return FASCIST_TRACKS.medium;
  return FASCIST_TRACKS.large;
}

export function partyOf(role: Role): Party {
  return role === 'liberal' ? 'liberal' : 'fascist';
}

/** Hitler knows his fascists only in 5-6 player games. */
export function hitlerKnowsFascists(playerCount: number): boolean {
  return playerCount <= 6;
}

export function rolesFor(playerCount: number): Role[] {
  const counts = ROLE_COUNTS[playerCount];
  if (!counts) throw new Error(`Unsupported player count ${playerCount}`);
  const roles: Role[] = [];
  for (let i = 0; i < counts[0]; i++) roles.push('liberal');
  for (let i = 0; i < counts[1]; i++) roles.push('fascist');
  roles.push('hitler');
  return roles;
}
