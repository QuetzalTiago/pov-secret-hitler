import type { GameView } from '../shared/view';

/** Key of the turn the player `you` must act on now, or null when it isn't their turn
 *  (spectator, dead, not pending, gameOver). */
export function myTurnKey(v: GameView | null): string | null {
  if (!v || v.you === null || v.phase === 'gameOver') return null;
  if (!v.players.find((p) => p.seat === v.you)?.alive) return null;
  if (!v.pending.includes(v.you)) return null;
  return `${v.phase}:${v.round}:${v.vetoRefused}`;
}

/** Fires once per new turn key, however many room messages repeat the same turn. */
export class TurnCue {
  private last: string | null = null;

  /** True when a new turn just started for the local player. */
  update(v: GameView | null): boolean {
    const key = myTurnKey(v);
    if (key === null || key === this.last) return false;
    this.last = key;
    return true;
  }

  reset() {
    this.last = null;
  }
}
