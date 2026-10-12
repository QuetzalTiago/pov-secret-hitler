// Pure HUD model: everything the HUD displays, derived from the game view. No DOM, no three.
import type { RoomView } from '../shared/protocol';
import type { Power, Role } from '../shared/types';
import { actingSeats, type GameView } from '../shared/view';

export type Verb =
  | 'discard' | 'enact' | 'vote' | 'nominate' | 'shoot' | 'investigate' | 'elect' | 'peek' | 'role' | 'veto'
  | null;
export type Badge = 'president' | 'chancellor' | 'nominee' | 'termLimited' | 'voted' | 'acting';

export interface HudOpts {
  envelopeOpen: boolean; // the night role card is face up
  myVote: boolean | null; // this client's own vote, once cast
  termLimited: number[]; // seats that cannot be nominated Chancellor
}

export interface RosterEntry {
  seat: number;
  name: string;
  you: boolean;
  alive: boolean;
  bot: boolean;
  away: boolean;
  badges: Badge[];
  knownRole: Role | null;
}

export interface HudModel {
  status: {
    role: Role | null;
    roleLabel: string;
    alive: boolean;
    liberal: number;
    fascist: number;
    tracker: number;
    deck: number;
    discard: number;
    round: number;
    powers: (Power | null)[];
  };
  step: { index: number; labels: string[] } | null;
  action: { mine: boolean; title: string; detail: string; verb: Verb; waitingOn: string[] };
  roster: RosterEntry[];
}

const STEP_LABELS = ['Nominate', 'Vote', 'Legislate', 'Power'];
const ROLE_LABELS: Record<Role, string> = { liberal: 'Liberal', fascist: 'Fascist', hitler: 'Hitler' };

function stepIndex(phase: GameView['phase']): number | null {
  switch (phase) {
    case 'nominate':
      return 0;
    case 'vote':
      return 1;
    case 'legPresident':
    case 'legChancellor':
    case 'veto':
      return 2;
    case 'peek':
    case 'investigate':
    case 'special':
    case 'execute':
      return 3;
    default:
      return null;
  }
}

/**
 * Off-screen marker for a projected point (three's Vector3.project output; z > 1 is behind the camera).
 * Null when on screen; else the point pushed out to the ±margin rectangle with the angle of its direction.
 */
export function edgeMarker(
  ndc: { x: number; y: number; z: number },
  margin = 0.9,
): { x: number; y: number; angle: number } | null {
  const behind = ndc.z > 1;
  if (!behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) return null;
  // Behind the camera the projection is mirrored: negate so the marker points the way to turn.
  const x = behind ? -ndc.x : ndc.x;
  const y = behind ? -ndc.y : ndc.y;
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (m < 1e-6) return { x: margin, y: 0, angle: 0 }; // dead behind: no direction, pick one
  return { x: (x * margin) / m, y: (y * margin) / m, angle: Math.atan2(y, x) };
}

export function hudModel(v: GameView, room: RoomView, opts: HudOpts): HudModel {
  const me = room.you;
  const name = (seat: number | null) => (seat === null ? '?' : (v.players[seat]?.name ?? '?'));
  const mePlayer = v.players[me];
  const alive = mePlayer?.alive ?? true;
  const over = v.phase === 'gameOver';
  const mine = !over && (v.phase === 'night' ? !mePlayer?.acked : v.pending.includes(me));
  const waitingOn = over ? [] : v.pending.filter((s) => s !== me).map(name);
  const pres = name(v.president);
  const chanc = name(v.chancellor);

  let title = '';
  let detail = '';
  let verb: Verb = null;
  switch (v.phase) {
    case 'night':
      if (!mine) {
        title = 'Eyes closed';
        detail = `Waiting for ${v.pending.length} more…`;
      } else if (!opts.envelopeOpen) {
        title = 'Check your secret role';
        detail = 'Click your envelope to see it.';
        verb = 'role';
      } else {
        title = 'Memorise your role';
        detail = 'Click the card to close your eyes.';
        verb = 'role';
      }
      break;
    case 'nominate':
      if (mine) {
        const names = opts.termLimited.map(name).join(', ');
        title = 'Nominate a Chancellor';
        detail = 'Click a player at the table.' + (names ? ` Term-limited: ${names}.` : '');
        verb = 'nominate';
      } else {
        title = `President ${pres} is choosing`;
        detail = 'Waiting for a Chancellor nomination.';
      }
      break;
    case 'vote':
      if (mine && opts.myVote === null) {
        title = 'Vote on the government';
        detail = `President ${pres} · Chancellor ${name(v.nominee)}` + (v.nominee === me ? ' (you!)' : '');
        verb = 'vote';
      } else {
        title = 'Votes are coming in';
        detail = `${v.players.filter((p) => p.hasVoted).length} of ${v.players.filter((p) => p.alive).length} voted`;
      }
      break;
    case 'legPresident':
      if (mine) {
        title = 'Discard one policy';
        detail = `Click the card to throw away. The other two go to Chancellor ${chanc}.`;
        verb = 'discard';
      } else {
        title = `President ${pres} is discarding`;
        detail = 'One of three policies goes to the discard pile.';
      }
      break;
    case 'legChancellor':
      if (mine) {
        title = 'Enact one policy';
        detail =
          'Click the card to enact; the other is discarded.' +
          (v.vetoUnlocked && !v.vetoRefused ? ' Or stamp VETO.' : '');
        verb = 'enact';
      } else {
        title = `Chancellor ${chanc} is enacting`;
        detail = 'One of two policies becomes law.';
      }
      break;
    case 'veto':
      if (mine) {
        title = 'Accept the veto?';
        detail = `Chancellor ${chanc} wants to discard both. Slam JA! or NEIN.`;
        verb = 'veto';
      } else {
        title = `President ${pres} is considering the veto`;
      }
      break;
    case 'peek':
      if (mine) {
        title = 'Peek at the deck';
        detail = 'These are the next three policies. Click them to put them back.';
        verb = 'peek';
      } else {
        title = `President ${pres} is peeking`;
      }
      break;
    case 'investigate':
      if (mine) {
        title = 'Investigate a player';
        detail = 'Click a player to see their party membership.';
        verb = 'investigate';
      } else {
        title = `President ${pres} is investigating`;
      }
      break;
    case 'special':
      if (mine) {
        title = 'Choose the next President';
        detail = 'Click a player at the table.';
        verb = 'elect';
      } else {
        title = `President ${pres} is choosing the next President`;
      }
      break;
    case 'execute':
      if (mine) {
        title = 'Execute a player';
        detail = 'Aim the revolver and click your target.';
        verb = 'shoot';
      } else {
        title = `President ${pres} has the revolver`;
      }
      break;
    case 'gameOver':
      title = v.winner === 'liberal' ? 'The Liberals win' : 'The Fascists win';
      break;
  }
  if (!alive && !over) detail = 'You are dead: watch in silence. ' + detail;

  const index = stepIndex(v.phase);
  const acting = actingSeats(v);
  const roster = v.players.map((p): RosterEntry => {
    const seat = room.seats[p.seat];
    const badges: Badge[] = [];
    if (p.seat === v.president && v.phase !== 'night' && !over) badges.push('president');
    if (p.seat === v.chancellor && v.phase !== 'vote') badges.push('chancellor');
    if (v.phase === 'vote' && p.seat === v.nominee) badges.push('nominee');
    if (opts.termLimited.includes(p.seat)) badges.push('termLimited');
    if (v.phase === 'vote' && p.hasVoted) badges.push('voted');
    if (acting.includes(p.seat)) badges.push('acting');
    return {
      seat: p.seat,
      name: p.name,
      you: p.seat === me,
      alive: p.alive,
      bot: seat?.bot ?? false,
      away: seat ? !seat.connected && !seat.bot : false,
      badges,
      knownRole: p.role,
    };
  });

  return {
    status: {
      role: v.yourRole,
      roleLabel: v.yourRole ? ROLE_LABELS[v.yourRole] : '',
      alive,
      liberal: v.liberal,
      fascist: v.fascist,
      tracker: v.tracker,
      deck: v.deckCount,
      discard: v.discardCount,
      round: v.round,
      powers: v.powers,
    },
    step: index === null ? null : { index, labels: STEP_LABELS },
    action: { mine, title, detail, verb, waitingOn },
    roster,
  };
}
