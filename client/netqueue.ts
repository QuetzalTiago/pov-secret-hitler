// Pure rule for replaying the one act made while offline.
import type { RoomView } from '../shared/protocol';

export interface PendingAct {
  msg: string; // JSON of the ClientMsg
  phase: string;
  seat: number;
}

/** Replay only if the game still waits on the same seat in the same phase. */
export function shouldFlushAct(p: PendingAct, room: RoomView | null): boolean {
  return (
    room?.stage === 'game' &&
    !!room.game &&
    room.game.phase === p.phase &&
    room.you === p.seat &&
    room.game.pending.includes(p.seat)
  );
}
