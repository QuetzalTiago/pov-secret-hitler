// Bot decision making. Bots only see their own GameView (no cheating) plus their legal actions.
import type { ActionBody } from './types';
import type { GameView } from './view';

export type Rand = () => number;

function pick<T>(items: T[], rand: Rand): T {
  return items[Math.floor(rand() * items.length)];
}

/** Purely random legal choice (used for simulation and phase-timer fallbacks). */
export function randomAction(legal: ActionBody[], rand: Rand): ActionBody {
  return pick(legal, rand);
}

/** A light heuristic bot: plays for its party, but stays somewhat unpredictable. */
export function botAction(view: GameView, legal: ActionBody[], rand: Rand): ActionBody {
  if (legal.length === 0) throw new Error('bot has no legal action');
  const me = view.you!;
  const fascist = view.yourRole !== 'liberal';
  const friendly = (seat: number) => {
    if (seat === me) return true;
    const role = view.players[seat].role;
    if (role) return fascist ? role !== 'liberal' : role === 'liberal';
    const inv = view.yourInvestigations.find((i) => i.target === seat);
    if (inv) return fascist ? inv.party === 'fascist' : inv.party === 'liberal';
    return null;
  };
  const kind = legal[0].type;
  const want = fascist ? 'F' : 'L';

  switch (kind) {
    case 'nominate':
    case 'specialElect': {
      const friends = legal.filter((a) => 'target' in a && friendly(a.target) === true);
      if (friends.length && rand() < 0.7) return pick(friends, rand);
      const unknown = legal.filter((a) => 'target' in a && friendly(a.target) !== false);
      return pick(unknown.length ? unknown : legal, rand);
    }
    case 'execute':
    case 'investigate': {
      const enemies = legal.filter((a) => 'target' in a && friendly(a.target) === false);
      if (enemies.length && rand() < 0.8) return pick(enemies, rand);
      const notFriends = legal.filter((a) => 'target' in a && friendly(a.target) !== true);
      return pick(notFriends.length ? notFriends : legal, rand);
    }
    case 'vote': {
      const pres = friendly(view.president);
      const chan = view.nominee === null ? null : friendly(view.nominee);
      let p = 0.6;
      if (pres === true || chan === true) p += 0.25;
      if (pres === false || chan === false) p -= 0.4;
      if (view.tracker === 2) p += 0.2;
      if (fascist && view.fascist >= 3 && view.nominee !== null && view.players[view.nominee].role === 'hitler') p = 1;
      return { type: 'vote', ja: rand() < p };
    }
    case 'presDiscard': {
      const hand = view.hand ?? [];
      const bad = legal.filter((a) => a.type === 'presDiscard' && hand[a.index] !== want);
      return pick(bad.length && rand() < 0.85 ? bad : legal, rand);
    }
    case 'chancEnact': {
      const hand = view.hand ?? [];
      const good = legal.filter((a) => a.type === 'chancEnact' && hand[a.index] === want);
      if (good.length === 0 && legal.some((a) => a.type === 'proposeVeto') && rand() < 0.7) {
        return { type: 'proposeVeto' };
      }
      const enacts = legal.filter((a) => a.type === 'chancEnact');
      return pick(good.length && rand() < 0.85 ? good : enacts, rand);
    }
    case 'vetoResponse':
      return { type: 'vetoResponse', accept: rand() < (fascist ? 0.3 : 0.7) };
    default:
      return pick(legal, rand);
  }
}
