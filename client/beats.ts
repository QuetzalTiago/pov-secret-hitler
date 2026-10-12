// Pure timing model for big rule moments (kept DOM- and audio-free so tests can import it).
import { VETO_AT } from '../shared/rules';
import type { GameEvent } from '../shared/types';
import { ENACT_BANNER_DELAY_MS, ENACT_BANNER_MS } from './enact';
import { victoryDelay } from './victory';

export const VOTE_REVEAL_MS = 4500;
export const TRACKER_AFTER_VOTES_MS = 1200; // coin steps up mid-reveal, after the cards flip
export const TRACKER_AFTER_VETO_MS = 900; // coin steps up after the veto stamp
export const CHAOS_AFTER_TRACKER_MS = 1200; // with no vote reveal (veto), chaos starts this long after the coin reaches 3
export const CHAOS_STING_MS = 1400; // chaos sting -> the top policy leaves the deck (and the coin resets)
export const HITLER_REVEAL_AFTER_VOTES_MS = 2000; // the Chancellor's role card flips this long into the vote reveal
export const HITLER_REVEAL_MS = 2800; // the "X was Hitler" card is up this long before the victory overlay
export const VETO_UNLOCK_AFTER_BANNER_MS = 1200; // veto-unlock announcement this long after the Extrablatt ends

const BANNER_END_MS = ENACT_BANNER_DELAY_MS + ENACT_BANNER_MS;

export type Beat =
  | GameEvent // never a 'gameOver' (see victoryAt)
  | { k: 'chaos' } // chaos sting, before the chaos policy flies
  | { k: 'vetoTracker'; value: number } // replaces a 'tracker' value>0 that follows an accepted veto
  | { k: 'hitlerRevealed'; seat: number } // name and flip the elected Chancellor's role card
  | { k: 'vetoUnlocked' }; // the 5th Fascist policy unlocked the veto

export interface Timed { at: number; beat: Beat } // ms after the batch starts

export interface Schedule { beats: Timed[]; victoryAt: number | null; endsAt: number }

/** Turns one event batch into timed beats; `fascistBefore` is the Fascist policy count before the batch. */
export function scheduleBatch(events: readonly GameEvent[], ctx: { chancellor: number | null; fascistBefore: number }): Schedule {
  const beats: Timed[] = [];
  const hasGameOver = events.some((e) => e.k === 'gameOver');
  let t = 0;
  let votesAt: number | null = null;
  let revealEnd = 0;
  let vetoAt: number | null = null;
  let chaosEnactedAt: number | null = null;
  let fascists = ctx.fascistBefore;
  let victoryAt: number | null = null;
  const emit = (at: number, beat: Beat) => beats.push({ at, beat });

  events.forEach((e, i) => {
    if (e.k === 'gameOver') {
      if (e.reason === 'hitlerElected' && votesAt !== null && ctx.chancellor !== null) {
        const at = Math.max(t, votesAt + HITLER_REVEAL_AFTER_VOTES_MS);
        emit(at, { k: 'hitlerRevealed', seat: ctx.chancellor });
        victoryAt = at + HITLER_REVEAL_MS;
      } else {
        victoryAt = (chaosEnactedAt ?? t) + victoryDelay(e.reason);
      }
      return;
    }
    if (chaosEnactedAt !== null) t = Math.max(t, chaosEnactedAt + BANNER_END_MS);
    if (e.k === 'votes') {
      votesAt = t;
      revealEnd = t + VOTE_REVEAL_MS;
      emit(t, e);
    } else if (e.k === 'vetoAnswer') {
      if (e.accepted) vetoAt = t;
      emit(t, e);
    } else if (e.k === 'tracker' && e.value > 0) {
      if (votesAt !== null) {
        t = Math.max(t, votesAt + TRACKER_AFTER_VOTES_MS);
        emit(t, e);
      } else if (vetoAt !== null) {
        t = Math.max(t, vetoAt + TRACKER_AFTER_VETO_MS);
        emit(t, { k: 'vetoTracker', value: e.value });
      } else emit(t, e);
    } else if (e.k === 'tracker' && events.slice(i + 1).some((n) => n.k === 'enacted' && n.chaos)) {
      const chaosAt = votesAt !== null ? Math.max(t, revealEnd) : t + CHAOS_AFTER_TRACKER_MS;
      emit(chaosAt, { k: 'chaos' });
      t = chaosAt + CHAOS_STING_MS;
      emit(t, e);
    } else if (e.k === 'enacted') {
      emit(t, e);
      if (e.chaos) chaosEnactedAt = t;
      if (e.policy === 'F' && ++fascists === VETO_AT && !hasGameOver) emit(t + BANNER_END_MS + VETO_UNLOCK_AFTER_BANNER_MS, { k: 'vetoUnlocked' });
    } else emit(t, e);
  });

  beats.sort((a, b) => a.at - b.at); // stable: ties keep emission order
  let endsAt = beats.reduce((m, b) => Math.max(m, b.at), 0);
  if (victoryAt !== null) endsAt = Math.max(endsAt, victoryAt);
  return { beats, victoryAt, endsAt };
}

/** Time-ordered queue of beats from successive batches; time is passed in, no timers. */
export class BeatQueue {
  private items: Timed[] = [];
  private tail = 0;

  /** Queues a batch behind the previous one; returns its absolute start (add it to victoryAt). */
  push(s: Schedule, nowMs: number): number {
    const base = Math.max(nowMs, this.tail);
    let last = 0;
    for (const b of s.beats) {
      this.items.push({ at: base + b.at, beat: b.beat });
      last = Math.max(last, b.at);
    }
    this.tail = Math.max(this.tail, base + last);
    return base;
  }

  /** Removes and returns the beats due at nowMs, in time order. */
  due(nowMs: number): Beat[] {
    const out = this.items.filter((b) => b.at <= nowMs).sort((a, b) => a.at - b.at);
    this.items = this.items.filter((b) => b.at > nowMs);
    return out.map((b) => b.beat);
  }

  get pending(): boolean {
    return this.items.length > 0;
  }

  clear(): void {
    this.items = [];
    this.tail = 0;
  }
}
